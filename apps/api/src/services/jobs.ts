import type { Logger } from '@testrex/config';
import { JOB_QUEUE_OPTIONS } from '@testrex/contracts';
import { PgBoss } from 'pg-boss';

/** Hands work to the worker. Jobs must be sent after the transaction that created their data. */
export interface JobQueue {
  send(queue: string, payload: object): Promise<void>;
  close(): Promise<void>;
}

/**
 * pg-boss producer, started on first use so the API does not need the queue to serve requests.
 * It neither supervises nor schedules: the worker does that.
 */
export function pgBossQueue(connectionString: string, logger: Logger): JobQueue {
  let boss: Promise<PgBoss> | null = null;
  const created = new Set<string>();
  const start = () => {
    boss ??= (async () => {
      const instance = new PgBoss({ connectionString, supervise: false, schedule: false });
      instance.on('error', (error) => logger.error({ err: error }, 'job queue error'));
      await instance.start();
      return instance;
    })().catch((error: unknown) => {
      boss = null;
      throw error;
    });
    return boss;
  };
  return {
    async send(queue, payload) {
      const instance = await start();
      if (!created.has(queue)) {
        await instance.createQueue(queue, JOB_QUEUE_OPTIONS[queue] ?? {});
        created.add(queue);
      }
      await instance.send(queue, payload);
    },
    async close() {
      if (boss) await (await boss).stop({ graceful: false });
    },
  };
}

/** Records jobs instead of sending them (tests). */
export function memoryQueue(): JobQueue & { sent: { queue: string; payload: object }[] } {
  const sent: { queue: string; payload: object }[] = [];
  return {
    sent,
    async send(queue, payload) {
      sent.push({ queue, payload });
    },
    async close() {},
  };
}
