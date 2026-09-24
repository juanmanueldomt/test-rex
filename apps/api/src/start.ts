import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { redactConfig, type ApiConfig, type Logger } from '@testrex/config';
import {
  createDb,
  getMigrationStatus,
  inspectRuntimeRole,
  migrate,
  MigrationError,
  pingDb,
  resolveMigrationsDir,
} from '@testrex/db';
import type { FastifyInstance } from 'fastify';
import { createApiServices, registerApi } from './api';
import { buildServer, type CheckState, type MigrationState } from './server';
import type { Mailer } from './services/mailer';
import { appVersion } from './version';

export interface StartOptions {
  config: ApiConfig;
  logger: Logger;
  migrationsDir?: string;
  /** How often to re-check the schema while waiting for manual migrations. */
  migrationPollMs?: number;
  /** Initial delay before retrying migrations when the database is unreachable. */
  migrationRetryMs?: number;
  /** Overrides the SMTP mailer (tests). */
  mailer?: Mailer;
}

export interface RunningApi {
  app: FastifyInstance;
  /** Resolves once migrations have been applied or have failed. */
  migrated: Promise<MigrationState>;
  /** Resolves once the runtime database role has been checked (after migrations). */
  roleChecked: Promise<CheckState>;
  close(): Promise<void>;
}

function defaultWebDistDir(): string | undefined {
  const candidates = [
    resolve(import.meta.dirname, '../web'), // container image layout
    resolve(import.meta.dirname, '../../web/dist'), // monorepo (src/ or dist/)
  ];
  return candidates.find((dir) => existsSync(dir));
}

/**
 * Starts listening immediately (so liveness works during upgrades), then brings the schema
 * up to date. Until then readiness reports 503 and only health routes are served.
 */
export async function startApi(options: StartOptions): Promise<RunningApi> {
  const { config, logger } = options;
  logger.info({ config: redactConfig(config), version: appVersion }, 'starting testRex API');

  const migrationsDir = options.migrationsDir ?? resolveMigrationsDir(import.meta.dirname);
  const handle = createDb(config.DATABASE_URL, {
    onError: (error) => logger.warn({ err: error }, 'database connection lost'),
  });
  let state: MigrationState = { status: 'pending' };
  let roleState: CheckState = 'pending';
  let pollTimer: NodeJS.Timeout | undefined;

  const app = await buildServer({
    logger,
    version: appVersion,
    checkDatabase: () => pingDb(handle.pool),
    migrationState: () => state,
    runtimeRoleState: () => roleState,
    webDistDir: config.WEB_DIST_DIR ?? defaultWebDistDir(),
    registerRoutes: (app) =>
      registerApi(
        app,
        createApiServices({ config, logger, db: handle.db, mailer: options.mailer }),
      ),
  });
  await app.listen({ host: config.HOST, port: config.PORT });

  if (!config.DATABASE_MIGRATION_URL) {
    logger.warn(
      'DATABASE_MIGRATION_URL is not set: migrations run with DATABASE_URL, so the runtime role owns the schema and the audit log is not append-only at the database level',
    );
  }

  let closed = false;
  const sleep = (ms: number) =>
    new Promise<void>((resolveSleep) => (pollTimer = setTimeout(resolveSleep, ms)));

  const migrated = (async (): Promise<MigrationState> => {
    if (config.AUTO_MIGRATE) {
      // Connection problems (database still starting or restarting) are retried; a failing
      // migration is permanent until an operator intervenes.
      let retryMs = options.migrationRetryMs ?? 1000;
      while (!closed) {
        try {
          const { applied } = await migrate({
            connectionString: config.DATABASE_MIGRATION_URL ?? config.DATABASE_URL,
            migrationsDir,
            onApplied: (tag) => logger.info({ migration: tag }, 'applied migration'),
          });
          logger.info({ count: applied.length }, 'database schema is up to date');
          state = { status: 'done' };
          break;
        } catch (error) {
          if (error instanceof MigrationError) {
            logger.error(
              { err: error, migration: error.migration },
              `database migration failed: ${error.migration}`,
            );
            state = { status: 'failed', migration: error.migration };
            break;
          }
          logger.warn(
            { err: error, retryInMs: retryMs },
            'database not reachable, retrying migrations',
          );
          await sleep(retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        }
      }
      return state;
    }
    // AUTO_MIGRATE=false: wait until an operator runs `testrex migrate`.
    const pollMs = options.migrationPollMs ?? 5000;
    return new Promise<MigrationState>((resolveState) => {
      const check = async () => {
        const status = await getMigrationStatus(handle.pool, migrationsDir).catch(() => undefined);
        if (status && status.pending.length === 0) {
          state = { status: 'done' };
          logger.info('database schema is up to date');
          return resolveState(state);
        }
        if (status) logger.warn({ pending: status.pending }, 'waiting for pending migrations');
        pollTimer = setTimeout(check, pollMs);
      };
      void check();
    });
  })();

  // Tenant isolation relies on Row-Level Security, which superusers and BYPASSRLS roles skip.
  const roleChecked = migrated.then(async (migration): Promise<CheckState> => {
    if (migration.status !== 'done') return roleState;
    while (!closed) {
      try {
        const info = await inspectRuntimeRole(handle.pool);
        roleState = info.bypassesRls ? 'failing' : 'ok';
        if (info.bypassesRls) {
          logger.error(
            { role: info.role },
            `DATABASE_URL connects as role "${info.role}", which bypasses Row-Level Security (superuser or BYPASSRLS). Refusing to serve traffic: use a dedicated application role (see deploy/.env.example).`,
          );
        }
        return roleState;
      } catch {
        await sleep(options.migrationRetryMs ?? 1000);
      }
    }
    return roleState;
  });

  return {
    app,
    migrated,
    roleChecked,
    async close() {
      closed = true;
      clearTimeout(pollTimer);
      await app.close();
      await handle.close();
    },
  };
}
