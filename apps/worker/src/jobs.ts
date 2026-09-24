import type { Logger } from '@testrex/config';
import { tenantJobPayload, type TenantJobPayload } from '@testrex/contracts';
import { withOrg, type Database, type Transaction } from '@testrex/db';
import type { PgBoss } from 'pg-boss';
import type { z } from 'zod';

export const QUEUES = {
  /** Round-trip check that the queue and worker are functioning. */
  systemPing: 'system.ping',
} as const;

export interface JobDeps {
  logger: Logger;
  db: Database;
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
  deps: JobDeps,
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

/** Creates the queues and attaches their handlers. */
export async function registerJobs(boss: PgBoss, deps: JobDeps): Promise<void> {
  // System jobs are not tenant-scoped and must not touch tenant tables.
  await boss.createQueue(QUEUES.systemPing);
  await boss.work<object, PingResult>(QUEUES.systemPing, async ([job]) => {
    deps.logger.debug({ jobId: job?.id }, 'handling system.ping');
    return { pong: true, handledAt: new Date().toISOString() };
  });
}
