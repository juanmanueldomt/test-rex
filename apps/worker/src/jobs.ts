import type { Logger } from '@testrex/config';
import {
  JOB_QUEUE_OPTIONS,
  JOB_QUEUES,
  recordingJobPayload,
  runJobPayload,
  tenantJobPayload,
  type TenantJobPayload,
} from '@testrex/contracts';
import { schema, withOrg, type Database, type Transaction } from '@testrex/db';
import type { StorageAdapter } from '@testrex/storage';
import { and, inArray, isNull, lt } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import type { z } from 'zod';
import { executeRun, type InOrg, type LaunchBrowser } from './execution/run-executor';
import { runRecordingSession } from './recording/recorder';

export const QUEUES = {
  /** Round-trip check that the queue and worker are functioning. */
  systemPing: 'system.ping',
  /** Hourly system job: enqueues attachments.purgePending for every organization. */
  purgePendingSchedule: 'attachments.purgePendingSchedule',
  /** Tenant job: removes uploads never attached to a scenario. */
  purgePending: 'attachments.purgePending',
} as const;

/** Uploads not claimed by a scenario within this time are discarded. */
export const PENDING_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const PURGE_BATCH = 500;

export interface JobDeps {
  logger: Logger;
  db: Database;
  storage: StorageAdapter;
  /** Starts a browser for runs and recordings. */
  launch: LaunchBrowser;
  now?: () => Date;
}

export interface PingResult {
  pong: true;
  handledAt: string;
}

export interface TenantJob<P extends TenantJobPayload, R> {
  queue: string;
  /** Must extend tenantJobPayload, so every job names the organization it acts for. */
  payload: z.ZodType<P>;
  run(context: { tx: Transaction; payload: P; logger: Logger }): Promise<R>;
}

/** Declares a job whose handler only ever sees one organization's data. */
export function defineTenantJob<P extends TenantJobPayload, R>(
  job: TenantJob<P, R>,
): TenantJob<P, R> {
  return job;
}

/**
 * Validates the payload (a missing or malformed organizationId fails the job) and runs the
 * handler inside that organization's Row-Level Security scope.
 */
export async function registerTenantJob<P extends TenantJobPayload, R>(
  boss: PgBoss,
  deps: Pick<JobDeps, 'logger' | 'db'>,
  job: TenantJob<P, R>,
): Promise<void> {
  await boss.createQueue(job.queue);
  await boss.work<unknown, R>(job.queue, async ([received]) => {
    tenantJobPayload.parse(received?.data);
    const payload = job.payload.parse(received?.data);
    const logger = deps.logger.child({
      queue: job.queue,
      jobId: received?.id,
      organizationId: payload.organizationId,
    });
    return withOrg(deps.db, payload.organizationId, (tx) => job.run({ tx, payload, logger }));
  });
}

/**
 * A tenant job that runs for minutes (browsers): instead of one transaction for the whole job,
 * the handler gets `inOrg`, which opens a short transaction scoped to the job's organization
 * for each database touch, so progress is visible and nothing stays locked.
 */
export interface TenantTask<P extends TenantJobPayload, R> {
  queue: string;
  payload: z.ZodType<P>;
  /** Jobs of this queue a worker runs at the same time. */
  concurrency: number;
  run(context: { inOrg: InOrg; payload: P; logger: Logger }): Promise<R>;
}

export async function registerTenantTask<P extends TenantJobPayload, R>(
  boss: PgBoss,
  deps: Pick<JobDeps, 'logger' | 'db'>,
  task: TenantTask<P, R>,
): Promise<void> {
  await boss.createQueue(task.queue, JOB_QUEUE_OPTIONS[task.queue] ?? {});
  await boss.work<unknown, R>(
    task.queue,
    { localConcurrency: task.concurrency, batchSize: 1 },
    async ([received]) => {
      tenantJobPayload.parse(received?.data);
      const payload = task.payload.parse(received?.data);
      const logger = deps.logger.child({
        queue: task.queue,
        jobId: received?.id,
        organizationId: payload.organizationId,
      });
      const inOrg: InOrg = (fn) => withOrg(deps.db, payload.organizationId, fn);
      return task.run({ inOrg, payload, logger });
    },
  );
}

/** Executes the automated items of a test run with Playwright. */
export function runExecuteTask(deps: Pick<JobDeps, 'storage' | 'launch' | 'now'>) {
  return {
    queue: JOB_QUEUES.runExecute,
    payload: runJobPayload,
    concurrency: 1,
    run: ({ inOrg, payload, logger }) =>
      executeRun(
        { logger, storage: deps.storage, launch: deps.launch, now: deps.now },
        inOrg,
        payload,
      ),
  } satisfies TenantTask<z.infer<typeof runJobPayload>, { executed: number }>;
}

/** Keeps a browser open for an interactive recording session. */
export function recordingTask(deps: Pick<JobDeps, 'launch'>) {
  return {
    queue: JOB_QUEUES.recordingSession,
    payload: recordingJobPayload,
    concurrency: 2,
    run: ({ inOrg, payload, logger }) =>
      runRecordingSession({ logger, launch: () => deps.launch('chromium') }, inOrg, payload),
  } satisfies TenantTask<z.infer<typeof recordingJobPayload>, unknown>;
}

/**
 * Deletes one organization's pending uploads (scenario_id NULL) older than 24 hours: first
 * the stored objects, then the rows. Rows are locked so a scenario cannot claim an upload
 * while it is being removed.
 */
export function purgePendingUploadsJob(
  storage: StorageAdapter,
  now: () => Date = () => new Date(),
) {
  return defineTenantJob({
    queue: QUEUES.purgePending,
    payload: tenantJobPayload,
    async run({ tx, logger }) {
      const cutoff = new Date(now().getTime() - PENDING_UPLOAD_TTL_MS);
      const rows = await tx
        .select({ id: schema.attachments.id, storageKey: schema.attachments.storageKey })
        .from(schema.attachments)
        .where(and(isNull(schema.attachments.scenarioId), lt(schema.attachments.createdAt, cutoff)))
        .limit(PURGE_BATCH)
        .for('update', { skipLocked: true });
      for (const row of rows) await storage.delete(row.storageKey);
      if (rows.length) {
        await tx.delete(schema.attachments).where(
          inArray(
            schema.attachments.id,
            rows.map((row) => row.id),
          ),
        );
        logger.info({ purged: rows.length }, 'removed abandoned uploads');
      }
      return { purged: rows.length };
    },
  });
}

/** Enqueues the pending-upload purge for every organization (organizations are global). */
export async function fanOutPurgePending(boss: PgBoss, db: Database): Promise<number> {
  const organizations = await db.select({ id: schema.organizations.id }).from(schema.organizations);
  for (const organization of organizations) {
    await boss.send(QUEUES.purgePending, {
      organizationId: organization.id,
    } satisfies TenantJobPayload);
  }
  return organizations.length;
}

/** Creates the queues and attaches their handlers. */
export async function registerJobs(boss: PgBoss, deps: JobDeps): Promise<void> {
  // System jobs are not tenant-scoped and must not touch tenant tables.
  await boss.createQueue(QUEUES.systemPing);
  await boss.work<object, PingResult>(QUEUES.systemPing, async ([job]) => {
    deps.logger.debug({ jobId: job?.id }, 'handling system.ping');
    return { pong: true, handledAt: new Date().toISOString() };
  });

  await registerTenantJob(boss, deps, purgePendingUploadsJob(deps.storage, deps.now));
  await registerTenantTask(boss, deps, runExecuteTask(deps));
  await registerTenantTask(boss, deps, recordingTask(deps));
  await boss.createQueue(QUEUES.purgePendingSchedule);
  await boss.work(QUEUES.purgePendingSchedule, async () => ({
    organizations: await fanOutPurgePending(boss, deps.db),
  }));
  await boss.schedule(QUEUES.purgePendingSchedule, '0 * * * *');
}
