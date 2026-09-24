import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { apiEnvSchema, ConfigError, createLogger, loadConfig, redactConfig } from './index';

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
