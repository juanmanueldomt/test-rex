import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@testrex/config';
import { describe, expect, it } from 'vitest';
import { buildServer, type MigrationState, type ServerDeps } from './server';

const logger = createLogger({ level: 'silent' });

function deps(overrides: Partial<ServerDeps> = {}): ServerDeps {
  return {
    logger,
    version: { version: '1.2.3', commit: 'abc1234' },
    checkDatabase: async () => true,
    migrationState: (): MigrationState => ({ status: 'done' }),
    ...overrides,
  };
}

describe('health endpoints', () => {
  it('liveness and readiness report 200 when healthy', async () => {
    const app = await buildServer(deps());
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({
      status: 'ok',
      checks: { database: 'ok', migrations: 'ok', databaseRole: 'ok' },
    });
  });

  it('readiness is 503 while liveness stays 200 when the database is down', async () => {
    const app = await buildServer(deps({ checkDatabase: async () => false }));
    expect((await app.inject('/healthz')).statusCode).toBe(200);
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.database).toBe('failing');
  });

  it('readiness is 503 when a migration failed', async () => {
    const app = await buildServer(
      deps({ migrationState: () => ({ status: 'failed', migration: '0003_x' }) }),
    );
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.migrations).toBe('failing');
  });
});

describe('storage check', () => {
  it('is reported by readiness when configured', async () => {
    const app = await buildServer(deps({ storageState: async () => ({ state: 'ok' }) }));
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(200);
    expect(ready.json().checks.storage).toBe('ok');
  });

  it('makes readiness 503 with the reason while traffic is still served', async () => {
    const app = await buildServer(
      deps({
        storageState: async () => ({
          state: 'failing',
          error: 'S3 bucket files is not usable: NoSuchBucket',
        }),
      }),
    );
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(503);
    expect(ready.json()).toMatchObject({
      checks: { storage: 'failing' },
      errors: { storage: 'S3 bucket files is not usable: NoSuchBucket' },
    });
    expect((await app.inject('/api/version')).statusCode).toBe(200);
  });
});

describe('runtime role check', () => {
  it('is not ready and serves no traffic when the database role bypasses RLS', async () => {
    const app = await buildServer(deps({ runtimeRoleState: () => 'failing' }));
    const ready = await app.inject('/readyz');
    expect(ready.statusCode).toBe(503);
    expect(ready.json().checks.databaseRole).toBe('failing');
    expect((await app.inject('/api/version')).statusCode).toBe(503);
  });
});

describe('version endpoint', () => {
  it('returns the build version and commit', async () => {
    const app = await buildServer(deps());
    const res = await app.inject('/api/version');
    expect(res.json()).toEqual({ version: '1.2.3', commit: 'abc1234' });
  });
});

describe('traffic gating', () => {
  it('rejects non-health requests until migrations are done', async () => {
    const app = await buildServer(deps({ migrationState: () => ({ status: 'pending' }) }));
    expect((await app.inject('/api/version')).statusCode).toBe(503);
    expect((await app.inject('/healthz')).statusCode).toBe(200);
  });
});

describe('web app serving', () => {
  const webDistDir = mkdtempSync(join(tmpdir(), 'testrex-web-'));
  writeFileSync(join(webDistDir, 'index.html'), '<!doctype html><title>testRex</title>');

  it('serves index.html at / and for client-side routes', async () => {
    const app = await buildServer(deps({ webDistDir }));
    for (const url of ['/', '/o/acme/a/CHK']) {
      const res = await app.inject(url);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<title>testRex</title>');
    }
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const app = await buildServer(deps({ webDistDir }));
    const res = await app.inject('/api/nope');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: 'NOT_FOUND', message: 'Not found.' });
  });
});
