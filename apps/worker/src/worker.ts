import { createServer, type Server } from 'node:http';
import { redactConfig, type Logger, type WorkerConfig } from '@testrex/config';
import type { HealthResponse } from '@testrex/contracts';
import {
  createDb,
  getMigrationStatus,
  inspectRuntimeRole,
  pingDb,
  resolveMigrationsDir,
} from '@testrex/db';
import { PgBoss } from 'pg-boss';
import { registerJobs } from './jobs';

export interface StartWorkerOptions {
  config: WorkerConfig;
  logger: Logger;
  migrationsDir?: string;
  /** How often to re-check the schema while migrations are pending. */
  schemaPollMs?: number;
}

export interface RunningWorker {
  boss: PgBoss;
  health: Server;
  /** Resolves once the schema is current and job handlers are running. */
  started: Promise<void>;
  readiness(): Promise<{ ready: boolean; body: HealthResponse }>;
  close(): Promise<void>;
}

/**
 * Starts the health server immediately, waits until the database schema matches this build
 * (the API applies migrations), then starts pg-boss and the job handlers.
 */
export async function startWorker(options: StartWorkerOptions): Promise<RunningWorker> {
  const { config, logger } = options;
  logger.info({ config: redactConfig(config) }, 'starting testRex worker');

  const migrationsDir = options.migrationsDir ?? resolveMigrationsDir(import.meta.dirname);
  const handle = createDb(config.DATABASE_URL, {
    max: 2,
    onError: (error) => logger.warn({ err: error }, 'database connection lost'),
  });
  // The queue manages its own schema, so it connects as the schema owner.
  const boss = new PgBoss(config.DATABASE_MIGRATION_URL ?? config.DATABASE_URL);
  boss.on('error', (error) => logger.error({ err: error }, 'job queue error'));

  let bossStarted = false;
  let roleState: 'ok' | 'failing' | 'pending' = 'pending';
  let closed = false;
  let pollTimer: NodeJS.Timeout | undefined;

  async function readiness(): Promise<{ ready: boolean; body: HealthResponse }> {
    const database = await pingDb(handle.pool);
    const status = database
      ? await getMigrationStatus(handle.pool, migrationsDir).catch(() => undefined)
      : undefined;
    const checks = {
      database: database ? 'ok' : 'failing',
      migrations: status && status.pending.length === 0 ? 'ok' : 'pending',
      databaseRole: roleState,
      queue: bossStarted ? 'ok' : 'pending',
    } as const;
    const ready = Object.values(checks).every((check) => check === 'ok');
    return { ready, body: { status: ready ? 'ok' : 'unavailable', checks } };
  }

  const health = createServer((req, res) => {
    const send = (code: number, body: HealthResponse) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/healthz') return send(200, { status: 'ok' });
    if (req.url === '/readyz') {
      void readiness().then(({ ready, body }) => send(ready ? 200 : 503, body));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) =>
    health.listen(config.HEALTH_PORT, config.HEALTH_HOST, resolve),
  );

  const started = (async () => {
    const pollMs = options.schemaPollMs ?? 2000;
    for (;;) {
      if (closed) return;
      const status = await getMigrationStatus(handle.pool, migrationsDir).catch(() => undefined);
      if (status && status.pending.length === 0) break;
      logger.info({ pending: status?.pending }, 'waiting for database schema');
      await new Promise((resolve) => (pollTimer = setTimeout(resolve, pollMs)));
    }
    // Job handlers rely on Row-Level Security for tenant isolation.
    const role = await inspectRuntimeRole(handle.pool);
    roleState = role.bypassesRls ? 'failing' : 'ok';
    if (role.bypassesRls) {
      logger.error(
        { role: role.role },
        `DATABASE_URL connects as role "${role.role}", which bypasses Row-Level Security. Not processing jobs: use a dedicated application role (see deploy/.env.example).`,
      );
      return;
    }
    await boss.start();
    await registerJobs(boss, { logger, db: handle.db });
    bossStarted = true;
    logger.info('worker is processing jobs');
  })();

  return {
    boss,
    health,
    started,
    readiness,
    async close() {
      closed = true;
      clearTimeout(pollTimer);
      await new Promise<void>((resolve) => health.close(() => resolve()));
      if (bossStarted) await boss.stop({ graceful: true });
      await handle.close();
    },
  };
}
