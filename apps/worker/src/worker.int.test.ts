import { createLogger, loadConfig, workerEnvSchema } from '@testrex/config';
import { migrate } from '@testrex/db';
import {
  createTestDatabase,
  startPostgres,
  writeMigrationsDir,
  type TestDatabase,
} from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES, type PingResult } from './jobs';
import { startWorker } from './worker';

let container: StartedPostgreSqlContainer;
const logger = createLogger({ level: 'silent' });

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await container?.stop();
});

function config(db: TestDatabase, overrides: Record<string, string> = {}) {
  const loaded = loadConfig(workerEnvSchema, {
    APP_SECRET: 'x'.repeat(40),
    DATABASE_URL: db.appUrl,
    DATABASE_MIGRATION_URL: db.ownerUrl,
    ...overrides,
    HEALTH_HOST: '127.0.0.1',
  });
  // Port 0 lets the OS pick a free port.
  return { ...loaded, HEALTH_PORT: 0 };
}

async function waitFor<T>(fn: () => Promise<T | undefined>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('worker', () => {
  it('reports not ready while migrations are pending, then processes jobs', async () => {
    const migrationsDir = writeMigrationsDir({
      '0000_pending': 'CREATE TABLE pending_t (id int);',
    });
    const db = await createTestDatabase(container, { migrate: false });
    const worker = await startWorker({
      config: config(db),
      logger,
      migrationsDir,
      schemaPollMs: 100,
    });
    try {
      const before = await worker.readiness();
      expect(before.ready).toBe(false);
      expect(before.body.checks?.migrations).toBe('pending');
      const address = worker.health.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(503);

      await migrate({ connectionString: db.ownerUrl, migrationsDir });
      await worker.started;
      expect((await worker.readiness()).ready).toBe(true);

      const jobId = await worker.boss.send(QUEUES.systemPing, {});
      expect(jobId).toBeTruthy();
      const job = await waitFor(async () => {
        const [found] = await worker.boss.findJobs<object>(QUEUES.systemPing, { id: jobId! });
        return found?.state === 'completed' ? found : undefined;
      });
      expect((job.output as PingResult).pong).toBe(true);
    } finally {
      await worker.close();
    }
  });

  it('serves health endpoints over HTTP with the shipped schema', async () => {
    const db = await createTestDatabase(container);
    const worker = await startWorker({ config: config(db), logger });
    try {
      await worker.started;
      const address = worker.health.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      expect((await fetch(`http://127.0.0.1:${port}/healthz`)).status).toBe(200);
      expect((await fetch(`http://127.0.0.1:${port}/readyz`)).status).toBe(200);
    } finally {
      await worker.close();
    }
  });

  it('does not process jobs when DATABASE_URL bypasses Row-Level Security', async () => {
    const db = await createTestDatabase(container);
    const worker = await startWorker({ config: config(db, { DATABASE_URL: db.superUrl }), logger });
    try {
      await worker.started;
      const { ready, body } = await worker.readiness();
      expect(ready).toBe(false);
      expect(body.checks?.databaseRole).toBe('failing');
      expect(body.checks?.queue).toBe('pending');
    } finally {
      await worker.close();
    }
  });
});
