import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import {
  assertValidKey,
  PROBE_PREFIX,
  StorageNotFoundError,
  type PutOptions,
  type StorageAdapter,
} from './adapter';

export interface S3StorageOptions {
  bucket: string;
  region: string;
  /** For S3-compatible services (MinIO, R2, ...); omit for AWS. */
  endpoint?: string;
  /** Required by most S3-compatible services (`endpoint/bucket/key` URLs). */
  forcePathStyle?: boolean;
  /** Omit to use the default AWS credential chain (environment, instance role, ...). */
  credentials?: { accessKeyId: string; secretAccessKey: string };
}

/** Stores objects in an S3-compatible bucket; nothing touches the local disk. */
export class S3Storage implements StorageAdapter {
  readonly driver = 's3' as const;
  private readonly client: S3Client;

  constructor(private readonly options: S3StorageOptions) {
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: options.credentials,
    });
  }

  private objectKey(key: string): string {
    assertValidKey(key);
    return key;
  }

  async put(key: string, body: Readable, options: PutOptions): Promise<void> {
    // Multipart upload streams bodies of unknown length without buffering them on disk.
    const upload = new Upload({
      client: this.client,
      params: {
        Bucket: this.options.bucket,
        Key: this.objectKey(key),
        Body: body,
        ContentType: options.contentType,
      },
    });
    await upload.done();
  }

  async get(key: string): Promise<Readable> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: this.objectKey(key) }),
      );
      if (!(result.Body instanceof Readable)) throw new Error('Unexpected S3 response body');
      return result.Body;
    } catch (error) {
      if (error instanceof NoSuchKey) throw new StorageNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.options.bucket, Key: this.objectKey(key) }),
    );
  }

  async check(): Promise<void> {
    const key = `${PROBE_PREFIX}/${randomBytes(8).toString('hex')}`;
    const content = `testrex-probe-${Date.now()}`;
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: this.objectKey(key),
          Body: content,
          ContentType: 'text/plain',
        }),
      );
      const body = await this.get(key);
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
      if (Buffer.concat(chunks).toString('utf8') !== content) throw new Error('probe mismatch');
      await this.delete(key);
    } catch (error) {
      const reason =
        error instanceof S3ServiceException
          ? `${error.name}${error.message && error.message !== error.name ? `: ${error.message}` : ''}`
          : error instanceof Error
            ? error.message
            : String(error);
      throw new Error(`S3 bucket ${this.options.bucket} is not usable: ${reason}`, {
        cause: error,
      });
    }
  }
}
