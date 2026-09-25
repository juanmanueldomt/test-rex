import { Readable } from 'node:stream';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageNotFoundError } from './adapter';
import { S3Storage, type S3StorageOptions } from './s3';

const ADMIN = { accessKeyId: 'admin-access', secretAccessKey: 'admin-secret-key' };
const ACCESS_KEY = 'testrex-access';
const SECRET_KEY = 'testrex-secret-key';
let server: StartedTestContainer;
let options: S3StorageOptions;

// MinIO no longer publishes public container images, so the S3-compatible SeaweedFS server
// stands in. Credentials are configured so that signature checks are real, and testRex's
// identity may only use its own bucket (least privilege, as in production).
const S3_CONFIG = JSON.stringify({
  identities: [
    {
      name: 'admin',
      credentials: [{ accessKey: ADMIN.accessKeyId, secretKey: ADMIN.secretAccessKey }],
      actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
    },
    {
      name: 'testrex',
      credentials: [{ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }],
      actions: ['Read:attachments', 'Write:attachments', 'List:attachments'],
    },
  ],
});

beforeAll(async () => {
  server = await new GenericContainer('chrislusf/seaweedfs:latest')
    .withCopyContentToContainer([{ content: S3_CONFIG, target: '/etc/seaweedfs/s3.json' }])
    .withCommand(['server', '-dir=/data', '-s3', '-s3.config=/etc/seaweedfs/s3.json'])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forListeningPorts())
    .start();
  options = {
    bucket: 'attachments',
    region: 'us-east-1',
    endpoint: `http://${server.getHost()}:${server.getMappedPort(8333)}`,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
  };
  // The S3 gateway accepts connections before its filer is ready; retry until it answers.
  const client = new S3Client({ ...options, credentials: ADMIN });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await client.send(new CreateBucketCommand({ Bucket: options.bucket }));
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  client.destroy();
});

afterAll(async () => {
  await server?.stop();
});

async function bytes(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe('S3Storage against an S3-compatible server', () => {
  it('puts (streaming, unknown length), gets and deletes objects', async () => {
    const storage = new S3Storage(options);
    const key = 'org/o1/attachments/a1';
    // Larger than one multipart part (5 MB) to exercise the multipart path.
    const big = Buffer.alloc(6 * 1024 * 1024, 7);
    async function* chunks() {
      for (let offset = 0; offset < big.length; offset += 256 * 1024) {
        yield big.subarray(offset, offset + 256 * 1024);
      }
    }
    await storage.put(key, Readable.from(chunks()), { contentType: 'application/octet-stream' });
    expect((await bytes(await storage.get(key))).equals(big)).toBe(true);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it('check() succeeds with a usable bucket', async () => {
    await expect(new S3Storage(options).check()).resolves.toBeUndefined();
  });

  it('check() names the problem for a missing bucket or wrong credentials', async () => {
    await expect(new S3Storage({ ...options, bucket: 'missing-bucket' }).check()).rejects.toThrow(
      /S3 bucket missing-bucket is not usable: (NoSuchBucket|AccessDenied)/,
    );
    await expect(
      new S3Storage({
        ...options,
        credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: 'wrong' },
      }).check(),
    ).rejects.toThrow(/S3 bucket attachments is not usable: (SignatureDoesNotMatch|AccessDenied)/);
  });
});
