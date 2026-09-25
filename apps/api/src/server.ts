import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { Logger } from '@testrex/config';
import type { HealthResponse, VersionResponse } from '@testrex/contracts';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';

export type MigrationState =
  { status: 'pending' } | { status: 'done' } | { status: 'failed'; migration: string };

export type CheckState = 'ok' | 'failing' | 'pending';

export interface ServerDeps {
  logger: Logger;
  version: VersionResponse;
  checkDatabase: () => Promise<boolean>;
  migrationState: () => MigrationState;
  /** Whether the runtime database role is subject to Row-Level Security. */
  runtimeRoleState?: () => CheckState;
  /** Whether attachment storage is writable; reported by readiness when provided. */
  storageState?: () => Promise<{ state: CheckState; error?: string }>;
  /** Registers application routes (auth, organizations, ...). Omitted in health-only tests. */
  registerRoutes?: (app: FastifyInstance) => Promise<void>;
  /** Directory with the built web app; the API runs without it when absent. */
  webDistDir?: string;
}

const HEALTH_ROUTES = new Set(['/healthz', '/readyz']);

export async function buildServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: deps.logger as FastifyBaseLogger,
    trustProxy: true,
  });

  app.get('/healthz', { logLevel: 'silent' }, async (): Promise<HealthResponse> => ({
    status: 'ok',
  }));

  app.get('/readyz', { logLevel: 'silent' }, async (_req, reply): Promise<HealthResponse> => {
    const database = (await deps.checkDatabase()) ? 'ok' : 'failing';
    const state = deps.migrationState();
    const migrations =
      state.status === 'done' ? 'ok' : state.status === 'failed' ? 'failing' : 'pending';
    const databaseRole = deps.runtimeRoleState?.() ?? 'ok';
    const checks: Record<string, CheckState> = { database, migrations, databaseRole };
    const errors: Record<string, string> = {};
    if (deps.storageState) {
      const storage = await deps.storageState();
      checks.storage = storage.state;
      if (storage.error) errors.storage = storage.error;
    }
    const ready = Object.values(checks).every((check) => check === 'ok');
    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ok' : 'unavailable',
      checks,
      ...(Object.keys(errors).length ? { errors } : {}),
    };
  });

  // Nothing but health checks is served until the schema is up to date and the runtime
  // database role is known to enforce tenant isolation.
  app.addHook('onRequest', async (req, reply) => {
    if (HEALTH_ROUTES.has(req.url.split('?')[0]!)) return;
    const roleOk = (deps.runtimeRoleState?.() ?? 'ok') === 'ok';
    if (deps.migrationState().status !== 'done' || !roleOk) {
      await reply
        .code(503)
        .send({ code: 'UNAVAILABLE', message: 'testRex is starting. Please retry shortly.' });
    }
  });

  app.get('/api/version', async (): Promise<VersionResponse> => deps.version);
  await deps.registerRoutes?.(app);

  const webDistDir = deps.webDistDir;
  const hasWeb = webDistDir !== undefined && existsSync(join(webDistDir, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDistDir, wildcard: false });
  } else {
    deps.logger.warn({ webDistDir }, 'web app build not found; serving API only');
  }

  app.setNotFoundHandler(async (req, reply) => {
    const isApi = req.url.startsWith('/api/') || req.url === '/api';
    const wantsPage = req.method === 'GET' && !isApi && hasWeb;
    // Client-side routes (e.g. /o/acme/a/CHK) are resolved by the SPA.
    if (wantsPage) return reply.type('text/html').sendFile('index.html');
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'Not found.' });
  });

  return app;
}
