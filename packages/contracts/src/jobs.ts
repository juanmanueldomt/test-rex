import { z } from 'zod';

/** Every tenant job carries the organization it acts for; the worker scopes it with RLS. */
export const tenantJobPayload = z.object({
  organizationId: z.uuid(),
});
export type TenantJobPayload = z.infer<typeof tenantJobPayload>;

/** Queues the API sends to and the worker consumes. */
export const JOB_QUEUES = {
  /** Executes the automated items of a test run. */
  runExecute: 'runs.execute',
  /** Keeps a browser open for an interactive recording session. */
  recordingSession: 'recordings.session',
} as const;

/** Queue settings shared by the API (producer) and the worker (both create the queues). */
export const JOB_QUEUE_OPTIONS: Record<string, { expireInSeconds: number; retryLimit: number }> = {
  // A run must not be executed twice; stuck runs are cancelled by people.
  [JOB_QUEUES.runExecute]: { expireInSeconds: 2 * 60 * 60, retryLimit: 0 },
  [JOB_QUEUES.recordingSession]: { expireInSeconds: 40 * 60, retryLimit: 0 },
};

export const runJobPayload = tenantJobPayload.extend({ runId: z.uuid() });
export type RunJobPayload = z.infer<typeof runJobPayload>;

export const recordingJobPayload = tenantJobPayload.extend({ sessionId: z.uuid() });
export type RecordingJobPayload = z.infer<typeof recordingJobPayload>;
