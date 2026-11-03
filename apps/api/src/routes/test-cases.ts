import {
  createTestCaseSchema,
  restoreVersionSchema,
  specFileName,
  testCaseListQuerySchema,
  updateTestCaseSchema,
  type PlaywrightCode,
} from '@testrex/contracts';
import { schema } from '@testrex/db';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit } from '../services/audit';
import { playwrightCodeFor, testCasesOfScenario } from '../services/automation';
import type { ApiServices } from '../services/index';
import { findScenario, resolveTags, scenarioLabel } from '../services/scenarios';
import {
  assertBaseVersion,
  assertTestCaseNotDeleted,
  createTestCase,
  findTestCase,
  findVersion,
  linkedScenarioIds,
  linkedTagIds,
  listTestCases,
  requireDataset,
  requireScenarioLinks,
  saveTestCaseState,
  stateOf,
  testCaseKey,
  testCaseLabel,
  testCaseView,
  versionSummaries,
  versionView,
} from '../services/test-cases';
import { SCENARIOS_PATH, scenarioContext, type ScenarioParams } from './scenarios';

export const TEST_CASES_PATH = '/api/orgs/:orgSlug/apps/:appKey/test-cases';
type KeyRequest = FastifyRequest<{ Params: { testCaseKey: string } }>;
type VersionRequest = FastifyRequest<{ Params: { testCaseKey: string; number: string } }>;

export async function testCaseRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const write = [guards.app, guards.appPermission('testcase.write'), guards.writableApp];
  const ITEM = `${TEST_CASES_PATH}/:testCaseKey`;

  app.get(TEST_CASES_PATH, { preHandler: read }, async (req) => {
    const query = parse(testCaseListQuerySchema, req.query);
    return inOrg(services, req, (tx) => listTestCases(tx, req.application!, query));
  });

  app.post(TEST_CASES_PATH, { preHandler: write }, async (req, reply) => {
    const input = parse(createTestCaseSchema, req.body);
    const ctx = scenarioContext(services, req);
    const view = await inOrg(services, req, async (tx) => {
      const row = await createTestCase(tx, ctx, input);
      return testCaseView(tx, ctx.app, row);
    });
    return reply.code(201).send(view);
  });

  app.get(ITEM, { preHandler: read }, async (req: KeyRequest) =>
    inOrg(services, req, async (tx) => {
      const row = await findTestCase(tx, req.application!, req.params.testCaseKey);
      return testCaseView(tx, req.application!, row);
    }),
  );

  app.patch(ITEM, { preHandler: write }, async (req: KeyRequest) => {
    const input = parse(updateTestCaseSchema, req.body);
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const row = await findTestCase(tx, ctx.app, req.params.testCaseKey, { forUpdate: true });
      assertTestCaseNotDeleted(row);
      await assertBaseVersion(tx, row, input.baseVersion);
      const scenarioIds = await linkedScenarioIds(tx, row.id);
      const next = stateOf(row, scenarioIds, await linkedTagIds(tx, row.id));
      if (input.title !== undefined) next.title = input.title;
      if (input.status !== undefined) next.status = input.status;
      if (input.priority !== undefined) next.priority = input.priority;
      if (input.executionMode !== undefined) next.executionMode = input.executionMode;
      if (input.scenarioIds !== undefined) {
        await requireScenarioLinks(tx, ctx.app, input.scenarioIds, new Set(scenarioIds));
        next.scenarioIds = [...input.scenarioIds].sort();
      }
      if (input.tags !== undefined) {
        next.tagIds = (await resolveTags(tx, ctx, input.tags)).map((tag) => tag.id).sort();
      }
      if (input.datasetId !== undefined && input.datasetId !== next.datasetId) {
        if (input.datasetId) await requireDataset(tx, ctx.app, input.datasetId);
        next.datasetId = input.datasetId;
      }
      if (input.description !== undefined) next.description = input.description;
      if (input.preconditions !== undefined) next.preconditions = input.preconditions;
      if (input.steps !== undefined) next.steps = input.steps;
      const saved = await saveTestCaseState(tx, ctx, row, next, {
        baseVersion: input.baseVersion,
        source: input.source,
      });
      return testCaseView(tx, ctx.app, saved.row);
    });
  });

  /** Soft delete: the test case leaves the catalog and new runs, but stays readable by URL. */
  app.delete(ITEM, { preHandler: write }, async (req: KeyRequest) => {
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const row = await findTestCase(tx, ctx.app, req.params.testCaseKey, { forUpdate: true });
      if (row.deletedAt) return testCaseView(tx, ctx.app, row);
      const [deleted] = await tx
        .update(schema.testCases)
        .set({ deletedAt: ctx.now, deletedBy: ctx.user.id })
        .where(eq(schema.testCases.id, row.id))
        .returning();
      await audit(
        tx,
        { organizationId: ctx.organizationId, actor: ctx.user },
        {
          action: 'test_case.deleted',
          targetType: 'test_case',
          targetId: row.id,
          targetLabel: testCaseLabel(ctx.app, row),
          changes: { deleted: { from: false, to: true } },
        },
      );
      return testCaseView(tx, ctx.app, deleted!);
    });
  });

  app.post(`${ITEM}/restore`, { preHandler: write }, async (req: KeyRequest) => {
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const row = await findTestCase(tx, ctx.app, req.params.testCaseKey, { forUpdate: true });
      if (!row.deletedAt) return testCaseView(tx, ctx.app, row);
      const [restored] = await tx
        .update(schema.testCases)
        .set({ deletedAt: null, deletedBy: null })
        .where(eq(schema.testCases.id, row.id))
        .returning();
      await audit(
        tx,
        { organizationId: ctx.organizationId, actor: ctx.user },
        {
          action: 'test_case.restored',
          targetType: 'test_case',
          targetId: row.id,
          targetLabel: testCaseLabel(ctx.app, row),
          changes: { deleted: { from: true, to: false } },
        },
      );
      return testCaseView(tx, ctx.app, restored!);
    });
  });

  app.get(`${ITEM}/versions`, { preHandler: read }, async (req: KeyRequest) =>
    inOrg(services, req, async (tx) => {
      const row = await findTestCase(tx, req.application!, req.params.testCaseKey);
      return versionSummaries(tx, row.id);
    }),
  );

  app.get(`${ITEM}/versions/:number`, { preHandler: read }, async (req: VersionRequest) =>
    inOrg(services, req, async (tx) => {
      const row = await findTestCase(tx, req.application!, req.params.testCaseKey);
      const version = await findVersion(tx, row.id, Number(req.params.number.replace(/^v/i, '')));
      return versionView(tx, req.application!, row, version);
    }),
  );

  /** Restoring creates a new version with the old content (source `restore`). */
  app.post(
    `${ITEM}/versions/:number/restore`,
    { preHandler: write },
    async (req: VersionRequest) => {
      const input = parse(restoreVersionSchema, req.body);
      const ctx = scenarioContext(services, req);
      return inOrg(services, req, async (tx) => {
        const row = await findTestCase(tx, ctx.app, req.params.testCaseKey, { forUpdate: true });
        assertTestCaseNotDeleted(row);
        await assertBaseVersion(tx, row, input.baseVersion);
        const number = Number(req.params.number.replace(/^v/i, ''));
        const version = await findVersion(tx, row.id, number);
        const current = new Set(await linkedScenarioIds(tx, row.id));
        // A scenario deleted since the version was saved is only kept if it is still linked.
        const scenarios = await tx
          .select({ id: schema.scenarios.id, deletedAt: schema.scenarios.deletedAt })
          .from(schema.scenarios)
          .where(
            and(
              eq(schema.scenarios.applicationId, ctx.app.id),
              inArray(schema.scenarios.id, version.scenarioIds),
            ),
          );
        const usable = scenarios
          .filter((scenario) => scenario.deletedAt === null || current.has(scenario.id))
          .map((scenario) => scenario.id);
        const next = stateOf(version, usable.length ? usable : [...current], version.tagIds);
        await requireScenarioLinks(tx, ctx.app, next.scenarioIds, current);
        if (next.datasetId) {
          const [dataset] = await tx
            .select({ deletedAt: schema.datasets.deletedAt })
            .from(schema.datasets)
            .where(eq(schema.datasets.id, next.datasetId));
          if (!dataset || dataset.deletedAt) next.datasetId = null;
        }
        const saved = await saveTestCaseState(tx, ctx, row, next, {
          baseVersion: input.baseVersion,
          source: 'restore',
          restoredFrom: number,
        });
        return testCaseView(tx, ctx.app, saved.row);
      });
    },
  );

  /** The test case as a `@playwright/test` spec, with the application's global steps. */
  app.get(`${ITEM}/playwright`, { preHandler: read }, async (req: KeyRequest) =>
    inOrg(services, req, async (tx): Promise<PlaywrightCode> => {
      const row = await findTestCase(tx, req.application!, req.params.testCaseKey);
      const label = testCaseLabel(req.application!, row);
      return {
        fileName: specFileName(testCaseKey(req.application!, row)),
        code: await playwrightCodeFor(tx, req.application!, [row], {
          heading: label,
          groupTitle: null,
        }),
      };
    }),
  );

  /** Every live test case of a scenario as one spec file (a describe block per scenario). */
  app.get(
    `${SCENARIOS_PATH}/:scenarioKey/playwright`,
    { preHandler: read },
    async (req: FastifyRequest<{ Params: ScenarioParams }>) =>
      inOrg(services, req, async (tx): Promise<PlaywrightCode> => {
        const scenario = await findScenario(tx, req.application!, req.params.scenarioKey);
        const rows = await testCasesOfScenario(tx, req.application!.id, scenario.id);
        const label = scenarioLabel(req.application!, scenario);
        return {
          fileName: specFileName(label.split(' · ')[0]!),
          code: await playwrightCodeFor(tx, req.application!, rows, {
            heading: label,
            groupTitle: label,
          }),
        };
      }),
  );
}
