import type { StorageAdapter } from './adapter';
import { LocalStorage } from './local';
import { S3Storage } from './s3';

export * from './adapter';
export { LocalStorage } from './local';
export { S3Storage, type S3StorageOptions } from './s3';

/** The storage settings of the API and worker configuration. */
export interface StorageConfig {
  STORAGE_DRIVER: 'local' | 's3';
  STORAGE_DIR: string;
  S3_BUCKET?: string;
  S3_REGION: string;
  S3_ENDPOINT?: string;
  S3_FORCE_PATH_STYLE: boolean;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}

export function createStorage(config: StorageConfig): StorageAdapter {
  if (config.STORAGE_DRIVER === 'local') return new LocalStorage(config.STORAGE_DIR);
  if (!config.S3_BUCKET) throw new Error('S3_BUCKET is required when STORAGE_DRIVER=s3');
  return new S3Storage({
    bucket: config.S3_BUCKET,
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
    credentials:
      config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY }
        : undefined,
  });
}
