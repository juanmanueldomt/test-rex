import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  apiEnvSchema,
  ConfigError,
  createLogger,
  loadConfig,
  redactConfig,
  workerEnvSchema,
} from './index';

const SECRET = 'super-secret-value-that-is-long-enough-123';
const DB_PASSWORD = 'db-pa55word';
const validEnv = {
  APP_SECRET: SECRET,
  DATABASE_URL: `postgres://testrex:${DB_PASSWORD}@db:5432/testrex`,
};

function loadError(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(apiEnvSchema, env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('expected loadConfig to fail');
}

describe('loadConfig', () => {
  it('applies defaults for a minimal valid environment', () => {
    const config = loadConfig(apiEnvSchema, validEnv);
    expect(config).toMatchObject({ PORT: 8080, HOST: '0.0.0.0', AUTO_MIGRATE: true });
  });

  it('reports a missing APP_SECRET by name', () => {
    const error = loadError({ DATABASE_URL: validEnv.DATABASE_URL });
    expect(error.issues).toEqual([{ key: 'APP_SECRET', message: 'is required' }]);
    expect(error.message).toContain('APP_SECRET');
  });

  it('treats empty strings as unset', () => {
    const error = loadError({ ...validEnv, APP_SECRET: '' });
    expect(error.issues.map((i) => i.key)).toEqual(['APP_SECRET']);
  });

  it('reports every invalid key at once', () => {
    const error = loadError({ ...validEnv, DATABASE_URL: 'mysql://nope', PORT: 'abc' });
    const keys = error.issues.map((i) => i.key).sort();
    expect(keys).toEqual(['DATABASE_URL', 'PORT']);
    expect(error.message).toContain('DATABASE_URL');
    expect(error.message).toContain('PORT');
  });

  it('parses boolean flags', () => {
    expect(loadConfig(apiEnvSchema, { ...validEnv, AUTO_MIGRATE: 'false' }).AUTO_MIGRATE).toBe(
      false,
    );
  });
});

describe('storage settings', () => {
  it('default to a local directory and a 25 MB attachment limit', () => {
    for (const schema of [apiEnvSchema, workerEnvSchema]) {
      expect(loadConfig(schema, validEnv)).toMatchObject({
        STORAGE_DRIVER: 'local',
        STORAGE_DIR: 'data/storage',
        S3_REGION: 'us-east-1',
        S3_FORCE_PATH_STYLE: false,
      });
    }
    expect(loadConfig(apiEnvSchema, validEnv).ATTACHMENT_MAX_BYTES).toBe(26_214_400);
  });

  it('parses an S3-compatible configuration', () => {
    const config = loadConfig(apiEnvSchema, {
      ...validEnv,
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'files',
      S3_ENDPOINT: 'http://minio:9000',
      S3_FORCE_PATH_STYLE: 'true',
      S3_ACCESS_KEY_ID: 'key',
      S3_SECRET_ACCESS_KEY: 's3-secret-value',
      ATTACHMENT_MAX_BYTES: '1048576',
    });
    expect(config).toMatchObject({
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'files',
      S3_FORCE_PATH_STYLE: true,
      ATTACHMENT_MAX_BYTES: 1_048_576,
    });
  });

  it('requires a bucket for S3 and both keys or neither', () => {
    expect(loadError({ ...validEnv, STORAGE_DRIVER: 's3' }).issues).toEqual([
      { key: 'S3_BUCKET', message: 'is required' },
    ]);
    expect(
      loadError({ ...validEnv, STORAGE_DRIVER: 's3', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'k' })
        .issues,
    ).toEqual([{ key: 'S3_SECRET_ACCESS_KEY', message: 'is required' }]);
    expect(loadError({ ...validEnv, STORAGE_DRIVER: 'ftp' }).issues.map((i) => i.key)).toEqual([
      'STORAGE_DRIVER',
    ]);
    expect(loadError({ ...validEnv, ATTACHMENT_MAX_BYTES: 'lots' }).issues).toEqual([
      { key: 'ATTACHMENT_MAX_BYTES', message: 'must be a number of bytes' },
    ]);
  });

  it('redacts S3 credentials', () => {
    const safe = redactConfig(
      loadConfig(apiEnvSchema, {
        ...validEnv,
        STORAGE_DRIVER: 's3',
        S3_BUCKET: 'files',
        S3_ACCESS_KEY_ID: 'AKIAEXAMPLEKEY',
        S3_SECRET_ACCESS_KEY: 's3-secret-value',
      }),
    );
    expect(JSON.stringify(safe)).not.toContain('s3-secret-value');
    expect(JSON.stringify(safe)).not.toContain('AKIAEXAMPLEKEY');
    expect(safe.S3_BUCKET).toBe('files');
  });
});

describe('secret redaction', () => {
  it('redactConfig hides secrets but keeps non-secret connection details', () => {
    const safe = redactConfig(loadConfig(apiEnvSchema, validEnv));
    const text = JSON.stringify(safe);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(DB_PASSWORD);
    expect(safe.DATABASE_URL).toContain('db:5432/testrex');
  });

  it('logger never writes secret values, even if the raw config is logged', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk, _enc, done) {
        lines.push(chunk.toString());
        done();
      },
    });
    const logger = createLogger({ destination });
    const config = loadConfig(apiEnvSchema, validEnv);

    logger.info({ config: redactConfig(config) }, 'configuration loaded');
    logger.info({ config }, 'raw config logged by mistake');
    logger.info({ user: { password: 'hunter2hunter2' } }, 'nested password');

    const output = lines.join('');
    expect(lines).toHaveLength(3);
    expect(output).not.toContain(SECRET);
    expect(output).not.toContain(DB_PASSWORD);
    expect(output).not.toContain('hunter2hunter2');
  });
});
