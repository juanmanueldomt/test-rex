import { createLogger, loadConfig, workerEnvSchema } from '@testrex/config';
import { tenantJobPayload } from '@testrex/contracts';
import { createDb, schema, type DbHandle } from '@testrex/db';
import { createTestDatabase, startPostgres, type TestDatabase } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineTenantJob, registerTenantJob } from './jobs';
import { startWorker, type RunningWorker } from './worker';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let worker: RunningWorker;
let handle: DbHandle;
const logger = createLogger({ level: 'silent' });
const orgA = schema.newId();
const orgB = schema.newId();

// A deliberately careless job: it reads applications without any organization filter.
const listApplications = defineTenantJob({
  queue: 'test.list-applications',
  payload: tenantJobPayload.extend({ note: z.string().optional() }),
  async run({ tx }) {
    const rows = await tx.select({ key: schema.applications.key }).from(schema.applications);
    return { keys: rows.map((row) => row.key).sort() };
  },
});

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  const admin = new pg.Pool({ connectionString: database.superUrl });
  await admin.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acme', 'acme'), ($2, 'Beta', 'beta')`,
    [orgA, orgB],
  );
  await admin.query(
    `INSERT INTO applications (id, organization_id, name, key)
     VALUES ($1, $3, 'Checkout', 'CHK'), ($2, $4, 'Billing', 'BIL'), ($5, $4, 'Search', 'SRC')`,
    [schema.newId(), schema.newId(), orgA, orgB, schema.newId()],
  );
  await admin.end();

  const config = loadConfig(workerEnvSchema, {
    APP_SECRET: 'x'.repeat(40),
    DATABASE_URL: database.appUrl,
    DATABASE_MIGRATION_URL: database.ownerUrl,
    HEALTH_HOST: '127.0.0.1',
  });
  worker = await startWorker({ config: { ...config, HEALTH_PORT: 0 }, logger });
  await worker.started;
  handle = createDb(database.appUrl);
  await registerTenantJob(worker.boss, { logger, db: handle.db }, listApplications);
});

afterAll(async () => {
  await worker?.close();
  await handle?.close();
  await container?.stop();
});

async function finished(queue: string, id: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [job] = await worker.boss.findJobs(queue, { id });
    if (job && ['completed', 'failed'].includes(job.state)) return job;
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

describe('tenant jobs', () => {
  it('only see the data of the organization named in the payload', async () => {
    const idA = await worker.boss.send(listApplications.queue, { organizationId: orgA });
    const idB = await worker.boss.send(listApplications.queue, { organizationId: orgB });
    const jobA = await finished(listApplications.queue, idA!);
    const jobB = await finished(listApplications.queue, idB!);
    expect(jobA.state).toBe('completed');
    expect(jobA.output).toEqual({ keys: ['CHK'] });
    expect(jobB.output).toEqual({ keys: ['BIL', 'SRC'] });
  });

  it('fail when the payload has no organization', async () => {
    const id = await worker.boss.send(
      listApplications.queue,
      { note: 'no org' },
      { retryLimit: 0 },
    );
    const job = await finished(listApplications.queue, id!);
    expect(job.state).toBe('failed');
  });
});
