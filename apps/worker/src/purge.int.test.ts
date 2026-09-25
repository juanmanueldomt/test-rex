import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createLogger, loadConfig, workerEnvSchema } from '@testrex/config';
import { schema } from '@testrex/db';
import { createTestDatabase, startPostgres, type TestDatabase } from '@testrex/db/testing';
import { attachmentStorageKey, LocalStorage, StorageNotFoundError } from '@testrex/storage';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QUEUES } from './jobs';
import { startWorker, type RunningWorker } from './worker';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let worker: RunningWorker;
let admin: pg.Pool;
let storageDir: string;
let storage: LocalStorage;
const logger = createLogger({ level: 'silent' });
const HOUR = 60 * 60 * 1000;

const orgA = schema.newId();
const orgB = schema.newId();
const appA = schema.newId();
const appB = schema.newId();
const scenarioA = schema.newId();

async function addAttachment(
  organizationId: string,
  applicationId: string,
  ageMs: number,
  scenarioId: string | null = null,
) {
  const id = schema.newId();
  const key = attachmentStorageKey(organizationId, id);
  await storage.put(key, Readable.from(['bytes']), { contentType: 'text/plain' });
  await admin.query(
    `INSERT INTO attachments (id, organization_id, application_id, scenario_id, storage_key,
                              file_name, content_type, size_bytes, sha256, created_at)
     VALUES ($1, $2, $3, $4, $5, 'f.txt', 'text/plain', 5, 'x', $6)`,
    [id, organizationId, applicationId, scenarioId, key, new Date(Date.now() - ageMs)],
  );
  return { id, key };
}

async function exists(key: string): Promise<boolean> {
  try {
    (await storage.get(key)).destroy();
    return true;
  } catch (error) {
    if (error instanceof StorageNotFoundError) return false;
    throw error;
  }
}

async function remainingIds(): Promise<string[]> {
  return (await admin.query('SELECT id FROM attachments')).rows.map((row) => row.id);
}

async function finished(queue: string, id: string) {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const [job] = await worker.boss.findJobs(queue, { id });
    if (job && ['completed', 'failed'].includes(job.state)) return job;
    if (Date.now() > deadline) throw new Error(`job ${id} did not finish`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function until(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 20_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 200));
  }
}

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  admin = new pg.Pool({ connectionString: database.superUrl });
  storageDir = mkdtempSync(join(tmpdir(), 'testrex-worker-storage-'));
  storage = new LocalStorage(storageDir);
  await admin.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acme', 'acme'), ($2, 'Beta', 'beta')`,
    [orgA, orgB],
  );
  await admin.query(
    `INSERT INTO applications (id, organization_id, name, key)
     VALUES ($1, $3, 'Checkout', 'CHK'), ($2, $4, 'Billing', 'BIL')`,
    [appA, appB, orgA, orgB],
  );
  await admin.query(
    `INSERT INTO scenarios (id, organization_id, application_id, number, title,
                            current_revision, current_revision_id)
     VALUES ($1, $2, $3, 1, 'Claimed', 1, $4)`,
    [scenarioA, orgA, appA, schema.newId()],
  );
  const config = loadConfig(workerEnvSchema, {
    APP_SECRET: 'x'.repeat(40),
    DATABASE_URL: database.appUrl,
    DATABASE_MIGRATION_URL: database.ownerUrl,
    HEALTH_HOST: '127.0.0.1',
    STORAGE_DIR: storageDir,
  });
  worker = await startWorker({ config: { ...config, HEALTH_PORT: 0 }, logger });
  await worker.started;
});

afterAll(async () => {
  await worker?.close();
  await admin?.end();
  await container?.stop();
  rmSync(storageDir, { recursive: true, force: true });
});

describe('attachments.purgePending', () => {
  it('removes old pending uploads of the organization, keeping recent and claimed ones', async () => {
    const old = await addAttachment(orgA, appA, 25 * HOUR);
    const recent = await addAttachment(orgA, appA, 1 * HOUR);
    const claimed = await addAttachment(orgA, appA, 25 * HOUR, scenarioA);
    const otherOrg = await addAttachment(orgB, appB, 25 * HOUR);

    const id = await worker.boss.send(QUEUES.purgePending, { organizationId: orgA });
    const job = await finished(QUEUES.purgePending, id!);
    expect(job.state).toBe('completed');
    expect(job.output).toEqual({ purged: 1 });

    const remaining = await remainingIds();
    expect(remaining).not.toContain(old.id);
    expect(remaining).toEqual(expect.arrayContaining([recent.id, claimed.id, otherOrg.id]));
    expect(await exists(old.key)).toBe(false);
    expect(await exists(recent.key)).toBe(true);
    expect(await exists(claimed.key)).toBe(true);
    // Another organization's upload is out of this job's reach (RLS).
    expect(await exists(otherOrg.key)).toBe(true);
  });

  it('the hourly schedule fans out one purge per organization', async () => {
    const schedules = await worker.boss.getSchedules();
    expect(schedules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: QUEUES.purgePendingSchedule, cron: '0 * * * *' }),
      ]),
    );
    const stale = await addAttachment(orgB, appB, 30 * HOUR);
    const id = await worker.boss.send(QUEUES.purgePendingSchedule, {});
    const job = await finished(QUEUES.purgePendingSchedule, id!);
    expect(job.output).toEqual({ organizations: 2 });
    await until(async () => !(await remainingIds()).includes(stale.id));
    expect(await exists(stale.key)).toBe(false);
  });
});
