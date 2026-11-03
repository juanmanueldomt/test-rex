import {
  createRunSchema,
  JOB_QUEUES,
  junitXml,
  manualResultSchema,
  reportQuerySchema,
  rerunSchema,
  runListQuerySchema,
  type RunJobPayload,
} from '@testrex/contracts';
import { schema } from '@testrex/db';
import { StorageNotFoundError } from '@testrex/storage';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { notFound, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import type { ApiServices } from '../services/index';
import { globalReport } from '../services/reports';
import {
  cancelRun,
  completeRun,
  createRun,
  findItem,
  findRun,
  itemDetail,
  listRuns,
  recordManualResult,
  rerunSelection,
  runKey,
  runReport,
  runView,
  type RunRow,
  type UrlScope,
} from '../services/runs';
import { scenarioContext } from './scenarios';

const APP_PATH = '/api/orgs/:orgSlug/apps/:appKey';
export const RUNS_PATH = `${APP_PATH}/runs`;
type RunRequest = FastifyRequest<{ Params: { runKey: string } }>;
type ItemRequest = FastifyRequest<{ Params: { runKey: string; itemId: string } }>;
type ArtifactRequest = FastifyRequest<{ Params: { runKey: string; artifactId: string } }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'video/webm']);

function urlScope(req: FastifyRequest): UrlScope {
  return { orgSlug: req.org!.slug, appKey: req.application!.key };
}

function download(reply: FastifyReply, fileName: string, contentType: string, body: string) {
  return reply
    .header('content-type', contentType)
    .header('content-disposition', `attachment; filename="${fileName}"`)
    .header('x-content-type-options', 'nosniff')
    .send(body);
}

export async function runRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const execute = [guards.app, guards.appPermission('execution.write'), guards.writableApp];
  const RUN = `${RUNS_PATH}/:runKey`;

  /** Hands a run with automated items to the worker (after its transaction committed). */
  async function dispatch(req: FastifyRequest, run: RunRow, queued: boolean) {
    if (!queued) return;
    await services.jobs.send(JOB_QUEUES.runExecute, {
      organizationId: req.org!.id,
      runId: run.id,
    } satisfies RunJobPayload);
  }

  app.get(RUNS_PATH, { preHandler: read }, async (req) => {
    const query = parse(runListQuerySchema, req.query);
    return inOrg(services, req, (tx) => listRuns(tx, req.application!, query, services.now()));
  });

  app.post(RUNS_PATH, { preHandler: execute }, async (req, reply) => {
    const input = parse(createRunSchema, req.body);
    const ctx = scenarioContext(services, req);
    const created = await inOrg(services, req, (tx) => createRun(tx, ctx, input));
    await dispatch(req, created.run, created.queued);
    const view = await inOrg(services, req, (tx) =>
      runView(tx, ctx.app, created.run, services.now()),
    );
    return reply.code(201).send(view);
  });

  app.get(RUN, { preHandler: read }, async (req: RunRequest) =>
    inOrg(services, req, async (tx) => {
      const run = await findRun(tx, req.application!, req.params.runKey);
      return runView(tx, req.application!, run, services.now());
    }),
  );

  app.get(`${RUN}/items/:itemId`, { preHandler: read }, async (req: ItemRequest) =>
    inOrg(services, req, async (tx) => {
      const run = await findRun(tx, req.application!, req.params.runKey);
      const item = await findItem(tx, run, req.params.itemId);
      return itemDetail(tx, req.application!, urlScope(req), run, item);
    }),
  );

  /** A tester's result for a manual item. */
  app.put(`${RUN}/items/:itemId/result`, { preHandler: execute }, async (req: ItemRequest) => {
    const input = parse(manualResultSchema, req.body);
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const run = await findRun(tx, ctx.app, req.params.runKey, { forUpdate: true });
      const item = await findItem(tx, run, req.params.itemId, { forUpdate: true });
      await recordManualResult(tx, ctx, run, item, input);
      const updated = await findItem(tx, run, item.id);
      return itemDetail(tx, ctx.app, urlScope(req), run, updated);
    });
  });

  app.post(`${RUN}/cancel`, { preHandler: execute }, async (req: RunRequest) => {
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const run = await findRun(tx, ctx.app, req.params.runKey, { forUpdate: true });
      await cancelRun(tx, ctx, run);
      return runView(tx, ctx.app, await findRun(tx, ctx.app, req.params.runKey), services.now());
    });
  });

  app.post(`${RUN}/complete`, { preHandler: execute }, async (req: RunRequest) => {
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const run = await findRun(tx, ctx.app, req.params.runKey, { forUpdate: true });
      await completeRun(tx, ctx, run);
      return runView(tx, ctx.app, await findRun(tx, ctx.app, req.params.runKey), services.now());
    });
  });

  /** A new run with the same test cases (all, or only failed and blocked ones). */
  app.post(`${RUN}/rerun`, { preHandler: execute }, async (req: RunRequest, reply) => {
    const { scope } = parse(rerunSchema, req.body);
    const ctx = scenarioContext(services, req);
    const created = await inOrg(services, req, async (tx) => {
      const source = await findRun(tx, ctx.app, req.params.runKey);
      const testCaseIds = await rerunSelection(tx, source, scope);
      return createRun(tx, ctx, {
        title: `Re-run of ${runKey(ctx.app, source)}${scope === 'failed' ? ' (failed)' : ''}`,
        scenarioIds: [],
        testCaseIds,
        modes: ['automated', 'manual'],
        baseUrl: source.baseUrl ?? undefined,
        browser: source.browser,
      });
    });
    await dispatch(req, created.run, created.queued);
    const view = await inOrg(services, req, (tx) =>
      runView(tx, ctx.app, created.run, services.now()),
    );
    return reply.code(201).send(view);
  });

  app.get(`${RUN}/report.json`, { preHandler: read }, async (req: RunRequest, reply) => {
    const report = await inOrg(services, req, async (tx) => {
      const run = await findRun(tx, req.application!, req.params.runKey);
      return runReport(tx, req.application!, urlScope(req), run, services.now());
    });
    return download(
      reply,
      `${report.key.toLowerCase()}-report.json`,
      'application/json; charset=utf-8',
      JSON.stringify(report, null, 2),
    );
  });

  app.get(`${RUN}/junit.xml`, { preHandler: read }, async (req: RunRequest, reply) => {
    const report = await inOrg(services, req, async (tx) => {
      const run = await findRun(tx, req.application!, req.params.runKey);
      return runReport(tx, req.application!, urlScope(req), run, services.now());
    });
    return download(
      reply,
      `${report.key.toLowerCase()}-junit.xml`,
      'application/xml; charset=utf-8',
      junitXml(report),
    );
  });

  /** Screenshots, traces and videos, checked against the run and application. */
  app.get(
    `${RUN}/artifacts/:artifactId`,
    { preHandler: read },
    async (req: ArtifactRequest, reply) => {
      if (!UUID.test(req.params.artifactId)) throw notFound();
      const artifact = await inOrg(services, req, async (tx) => {
        const run = await findRun(tx, req.application!, req.params.runKey);
        const [row] = await tx
          .select()
          .from(schema.runArtifacts)
          .where(
            and(
              eq(schema.runArtifacts.id, req.params.artifactId),
              eq(schema.runArtifacts.runId, run.id),
              eq(schema.runArtifacts.applicationId, req.application!.id),
            ),
          );
        if (!row) throw notFound();
        return { row, run };
      });
      let body;
      try {
        body = await services.storage.get(artifact.row.storageKey);
      } catch (error) {
        if (error instanceof StorageNotFoundError) throw notFound();
        throw error;
      }
      const extension =
        artifact.row.kind === 'trace' ? 'zip' : artifact.row.kind === 'video' ? 'webm' : 'png';
      const fileName = `${runKey(req.application!, artifact.run)}-${artifact.row.kind}-${artifact.row.id.slice(-8)}.${extension}`;
      const inline = INLINE_TYPES.has(artifact.row.contentType);
      return reply
        .header('content-type', artifact.row.contentType)
        .header('content-length', artifact.row.sizeBytes)
        .header(
          'content-disposition',
          `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`,
        )
        .header('x-content-type-options', 'nosniff')
        .header('content-security-policy', 'sandbox')
        .header('cache-control', 'private, max-age=31536000, immutable')
        .send(body);
    },
  );

  // ---- Global report ------------------------------------------------------------------------

  app.get(`${APP_PATH}/reports/overview`, { preHandler: read }, async (req) => {
    const { days } = parse(reportQuerySchema, req.query);
    return inOrg(services, req, (tx) => globalReport(tx, req.application!, days, services.now()));
  });
}
