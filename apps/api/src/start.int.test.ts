import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { apiEnvSchema, createLogger, loadConfig } from '@testrex/config';
import { migrate } from '@testrex/db';
import {
  createTestDatabase,
  startPostgres,
  writeMigrationsDir,
  type TestDatabase,
} from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi, type RunningApi } from './start';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await container?.stop();
});

function captureLogger() {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { logger: createLogger({ level: 'info', destination }), lines };
}

const storageDir = mkdtempSync(join(tmpdir(), 'testrex-start-storage-'));

function config(db: TestDatabase, overrides: Record<string, string> = {}) {
  const loaded = loadConfig(apiEnvSchema, {
    APP_SECRET: 'x'.repeat(40),
    STORAGE_DIR: storageDir,
    DATABASE_URL: db.appUrl,
    DATABASE_MIGRATION_URL: db.ownerUrl,
    HOST: '127.0.0.1',
    ...overrides,
  });
  // Port 0 lets the OS pick a free port; not a valid operator setting.
  return { ...loaded, PORT: 0 };
}

async function withApi(
  options: Parameters<typeof startApi>[0],
  fn: (api: RunningApi) => Promise<void>,
) {
  const api = await startApi(options);
  try {
    await fn(api);
  } finally {
    await api.close();
  }
}

describe('startApi', () => {
  it('applies migrations as the owner and serves as the RLS-bound runtime role', async () => {
    const db = await createTestDatabase(container, { migrate: false });
    const { logger } = captureLogger();
    await withApi({ config: config(db), logger }, async (api) => {
      expect(await api.migrated).toEqual({ status: 'done' });
      expect(await api.roleChecked).toBe('ok');
      const ready = await api.app.inject('/readyz');
      expect(ready.statusCode).toBe(200);
      expect(ready.json().checks.storage).toBe('ok');
    });
  });

  it('is not ready while the storage directory is not writable, naming the reason', async () => {
    const db = await createTestDatabase(container);
    const notADirectory = join(storageDir, 'occupied-by-a-file');
    writeFileSync(notADirectory, 'x');
    const { logger, lines } = captureLogger();
    await withApi({ config: config(db, { STORAGE_DIR: notADirectory }), logger }, async (api) => {
      await api.roleChecked;
      const ready = await api.app.inject('/readyz');
      expect(ready.statusCode).toBe(503);
      expect(ready.json()).toMatchObject({
        status: 'unavailable',
        checks: { database: 'ok', migrations: 'ok', databaseRole: 'ok', storage: 'failing' },
        errors: { storage: expect.stringMatching(/occupied-by-a-file is not writable/) },
      });
      expect(lines.join('')).toMatch(/attachment storage: Storage directory/);
    });
  });

  it('refuses to serve when DATABASE_URL bypasses Row-Level Security', async () => {
    const db = await createTestDatabase(container);
    const { logger, lines } = captureLogger();
    await withApi({ config: config(db, { DATABASE_URL: db.superUrl }), logger }, async (api) => {
      expect(await api.roleChecked).toBe('failing');
      const ready = await api.app.inject('/readyz');
      expect(ready.statusCode).toBe(503);
      expect(ready.json().checks.databaseRole).toBe('failing');
      expect(lines.join('')).toContain('bypasses Row-Level Security');
    });
  });

  it('keeps readiness at 503 and logs the migration name when a migration fails', async () => {
    const db = await createTestDatabase(container, { migrate: false });
    const { logger, lines } = captureLogger();
    const migrationsDir = writeMigrationsDir({
      '0000_fine': 'SELECT 1;',
      '0001_broken': 'SELEC 1;',
    });
    await withApi({ config: config(db), logger, migrationsDir }, async (api) => {
      expect(await api.migrated).toEqual({ status: 'failed', migration: '0001_broken' });
      expect((await api.app.inject('/readyz')).statusCode).toBe(503);
      expect((await api.app.inject('/healthz')).statusCode).toBe(200);
      expect(lines.join('')).toContain('0001_broken');
    });
  });

  it('keeps retrying (not failed) while the database is unreachable', async () => {
    const db = await createTestDatabase(container, { migrate: false });
    const { logger, lines } = captureLogger();
    const unreachable = 'postgres://u:p@127.0.0.1:1/none';
    await withApi(
      {
        config: config(db, { DATABASE_URL: unreachable, DATABASE_MIGRATION_URL: unreachable }),
        logger,
        migrationRetryMs: 50,
      },
      async (api) => {
        await new Promise((r) => setTimeout(r, 400));
        const ready = await api.app.inject('/readyz');
        expect(ready.statusCode).toBe(503);
        expect(ready.json().checks.migrations).toBe('pending');
        const retries = lines.filter((l) => l.includes('retrying migrations')).length;
        expect(retries).toBeGreaterThanOrEqual(2);
      },
    );
  });

  it('with AUTO_MIGRATE=false waits for an operator to migrate', async () => {
    const db = await createTestDatabase(container, { migrate: false });
    const { logger } = captureLogger();
    const migrationsDir = writeMigrationsDir({
      '0000_manual': 'CREATE TABLE manual_step (id int);',
    });
    await withApi(
      {
        config: config(db, { AUTO_MIGRATE: 'false' }),
        logger,
        migrationsDir,
        migrationPollMs: 100,
      },
      async (api) => {
        expect((await api.app.inject('/readyz')).statusCode).toBe(503);
        await migrate({ connectionString: db.ownerUrl, migrationsDir });
        expect(await api.migrated).toEqual({ status: 'done' });
        expect(await api.roleChecked).toBe('ok');
        expect((await api.app.inject('/readyz')).statusCode).toBe(200);
      },
    );
  });
});
