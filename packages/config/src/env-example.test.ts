import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apiEnvSchema, loadConfig, workerEnvSchema } from './index';

const examplePath = resolve(import.meta.dirname, '../../../deploy/.env.example');
const exampleText = readFileSync(examplePath, 'utf8');

function parseEnvFile(text: string): Record<string, string> {
  return Object.fromEntries(
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

describe('deploy/.env.example', () => {
  it('parses with the api and worker schemas once secrets are filled in', () => {
    const env = parseEnvFile(exampleText);
    env.APP_SECRET = 'x'.repeat(48);
    // docker-compose.yml builds the connection URLs from the POSTGRES_* values.
    env.DATABASE_URL = `postgres://testrex_app:${env.POSTGRES_PASSWORD}@postgres:5432/${env.POSTGRES_DB}`;
    env.DATABASE_MIGRATION_URL = `postgres://testrex_owner:${env.POSTGRES_PASSWORD}@postgres:5432/${env.POSTGRES_DB}`;

    expect(() => loadConfig(apiEnvSchema, env)).not.toThrow();
    expect(() => loadConfig(workerEnvSchema, env)).not.toThrow();
  });

  it('documents every operator-facing setting', () => {
    // Settings fixed by the container images are not operator-facing.
    const internal = new Set([
      'NODE_ENV',
      'HOST',
      'PORT',
      'WEB_DIST_DIR',
      'HEALTH_HOST',
      'HEALTH_PORT',
    ]);
    const keys = new Set([...apiEnvSchema.keyof().options, ...workerEnvSchema.keyof().options]);
    const undocumented = [...keys].filter(
      (key) => !internal.has(key) && !exampleText.includes(key),
    );
    expect(undocumented).toEqual([]);
  });
});
