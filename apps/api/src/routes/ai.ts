import {
  aiFixSchema,
  aiGenerateSchema,
  aiReviseSchema,
  llmSettingsInputSchema,
  type AiGenerateResult,
  type AiReviseResult,
  type AiStatus,
  type LlmSettings,
  type LlmTestResult,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, conflict, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit } from '../services/audit';
import { automationSettingsOf, testCasesOfScenario } from '../services/automation';
import type { ApiServices } from '../services/index';
import {
  fixPrompt,
  generateOutputSchema,
  generatePrompt,
  reviseOutputSchema,
  revisePrompt,
  SYSTEM_PROMPT,
  toProposal,
  type TestCaseForAi,
} from '../services/llm/assist';
import { LlmError, type LlmProvider } from '../services/llm/providers';
import { decryptSecret, encryptSecret } from '../services/llm/secrets';
import { findItem, findRun, runKey } from '../services/runs';
import { scenarioKey, userNames, userRef } from '../services/scenarios';
import {
  findTestCase,
  findTestCaseById,
  scenarioLinksOf,
  testCaseKey,
  type TestCaseRow,
} from '../services/test-cases';

const ORG_PATH = '/api/orgs/:orgSlug';
const APP_PATH = `${ORG_PATH}/apps/:appKey`;
type LlmRow = typeof schema.llmSettings.$inferSelect;

const notConfigured = () =>
  new ApiError(409, 'AI_NOT_CONFIGURED', 'Ask an organization admin to configure an LLM provider.');

function settingsView(row: LlmRow, names: Map<string, string>): LlmSettings {
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    hasKey: row.apiKeyEncrypted !== null,
    updatedBy: row.updatedBy ? userRef(names, row.updatedBy) : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Provider failures become 502 (upstream) errors with stable codes. */
function upstream(error: unknown): never {
  if (error instanceof LlmError) {
    throw new ApiError(error.code === 'AI_RATE_LIMITED' ? 429 : 502, error.code, error.message);
  }
  throw error;
}

export async function aiRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const manage = [guards.org, guards.orgPermission('org.manage')];
  const assist = [guards.app, guards.appPermission('testcase.write'), guards.writableApp];

  async function loadSettings(tx: Transaction, organizationId: string) {
    const [row] = await tx
      .select()
      .from(schema.llmSettings)
      .where(eq(schema.llmSettings.organizationId, organizationId));
    return row ?? null;
  }

  /** The organization's provider, ready to call (checked against the quota). */
  async function providerFor(req: FastifyRequest): Promise<LlmProvider> {
    const row = await inOrg(services, req, (tx) => loadSettings(tx, req.org!.id));
    if (!row) throw notConfigured();
    let apiKey: string | null = null;
    if (row.apiKeyEncrypted) {
      try {
        apiKey = decryptSecret(services.config.APP_SECRET, row.apiKeyEncrypted);
      } catch {
        throw new ApiError(
          409,
          'AI_KEY_UNREADABLE',
          'The stored API key can no longer be read. Ask an admin to save it again.',
        );
      }
    }
    await services.quota.check('llm.request', {
      organizationId: req.org!.id,
      plan: req.org!.plan,
    });
    return services.llm({ provider: row.provider, model: row.model, baseUrl: row.baseUrl, apiKey });
  }

  // ---- Organization settings ----------------------------------------------------------------

  app.get(
    `${ORG_PATH}/llm/status`,
    { preHandler: [guards.org] },
    async (req): Promise<AiStatus> => {
      const row = await inOrg(services, req, (tx) => loadSettings(tx, req.org!.id));
      return {
        configured: row !== null,
        provider: row?.provider ?? null,
        model: row?.model ?? null,
      };
    },
  );

  app.get(`${ORG_PATH}/llm`, { preHandler: manage }, async (req) =>
    inOrg(services, req, async (tx): Promise<LlmSettings | null> => {
      const row = await loadSettings(tx, req.org!.id);
      return row ? settingsView(row, await userNames(tx, [row.updatedBy])) : null;
    }),
  );

  app.put(`${ORG_PATH}/llm`, { preHandler: manage }, async (req) => {
    const input = parse(llmSettingsInputSchema, req.body);
    const organizationId = req.org!.id;
    const actor = req.user!;
    return inOrg(services, req, async (tx) => {
      const before = await loadSettings(tx, organizationId);
      const apiKeyEncrypted = input.clearKey
        ? null
        : input.apiKey
          ? encryptSecret(services.config.APP_SECRET, input.apiKey)
          : (before?.apiKeyEncrypted ?? null);
      if (input.provider === 'anthropic' && !apiKeyEncrypted) {
        throw new ApiError(400, 'VALIDATION_FAILED', 'Some fields are invalid.', {
          issues: [{ path: 'apiKey', message: 'llm.keyRequired' }],
        });
      }
      const values = {
        provider: input.provider,
        model: input.model,
        baseUrl: input.baseUrl,
        apiKeyEncrypted,
        updatedBy: actor.id,
        updatedAt: services.now(),
      };
      const [row] = await tx
        .insert(schema.llmSettings)
        .values({ organizationId, ...values })
        .onConflictDoUpdate({ target: schema.llmSettings.organizationId, set: values })
        .returning();
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (before?.provider !== input.provider) {
        changes.provider = { from: before?.provider ?? null, to: input.provider };
      }
      if (before?.model !== input.model) {
        changes.model = { from: before?.model ?? null, to: input.model };
      }
      if ((before?.baseUrl ?? null) !== input.baseUrl) {
        changes.baseUrl = { from: before?.baseUrl ?? null, to: input.baseUrl };
      }
      // The key itself is never logged: only that it changed.
      if (input.apiKey)
        changes.apiKey = { from: before?.apiKeyEncrypted ? 'set' : null, to: 'replaced' };
      if (input.clearKey && before?.apiKeyEncrypted) changes.apiKey = { from: 'set', to: null };
      await audit(
        tx,
        { organizationId, actor },
        {
          action: 'llm.settings_updated',
          targetType: 'organization',
          targetId: organizationId,
          targetLabel: req.org!.name,
          changes,
        },
      );
      return settingsView(row!, await userNames(tx, [actor.id]));
    });
  });

  app.delete(`${ORG_PATH}/llm`, { preHandler: manage }, async (req, reply) => {
    const organizationId = req.org!.id;
    await inOrg(services, req, async (tx) => {
      const [row] = await tx
        .delete(schema.llmSettings)
        .where(eq(schema.llmSettings.organizationId, organizationId))
        .returning();
      if (row) {
        await audit(
          tx,
          { organizationId, actor: req.user! },
          {
            action: 'llm.settings_updated',
            targetType: 'organization',
            targetId: organizationId,
            targetLabel: req.org!.name,
            changes: { provider: { from: row.provider, to: null } },
          },
        );
      }
    });
    return reply.code(204).send();
  });

  app.post(`${ORG_PATH}/llm/test`, { preHandler: manage }, async (req): Promise<LlmTestResult> => {
    const provider = await providerFor(req);
    try {
      const answer = await provider.test();
      return { ok: true, model: provider.model, message: answer };
    } catch (error) {
      if (error instanceof LlmError)
        return { ok: false, model: provider.model, message: error.message };
      throw error;
    }
  });

  // ---- Assistance ---------------------------------------------------------------------------

  async function testCaseForAi(
    tx: Transaction,
    req: FastifyRequest,
    row: TestCaseRow,
  ): Promise<TestCaseForAi> {
    const application = req.application!;
    const links = (await scenarioLinksOf(tx, application, [row.id])).get(row.id) ?? [];
    const tags = await tx
      .select({ name: schema.tags.name })
      .from(schema.testCaseTags)
      .innerJoin(schema.tags, eq(schema.tags.id, schema.testCaseTags.tagId))
      .where(eq(schema.testCaseTags.testCaseId, row.id))
      .orderBy(asc(schema.tags.name));
    const [dataset] = row.datasetId
      ? await tx
          .select({ name: schema.datasets.name, columns: schema.datasets.columns })
          .from(schema.datasets)
          .where(eq(schema.datasets.id, row.datasetId))
      : [];
    const settings = await automationSettingsOf(tx, application.id);
    return {
      key: testCaseKey(application, row),
      title: row.title,
      priority: row.priority,
      executionMode: row.executionMode,
      description: row.descriptionMd,
      preconditions: row.preconditionsMd,
      tags: tags.map((tag) => tag.name),
      steps: row.steps,
      scenarios: links.map((link) => ({ key: link.key, title: link.title })),
      dataset: dataset ?? null,
      baseUrl: settings.baseUrl,
    };
  }

  app.post(`${APP_PATH}/ai/test-cases/generate`, { preHandler: assist }, async (req) => {
    const input = parse(aiGenerateSchema, req.body);
    const application = req.application!;
    const context = await inOrg(services, req, async (tx) => {
      const [scenario] = await tx
        .select()
        .from(schema.scenarios)
        .where(
          and(
            eq(schema.scenarios.id, input.scenarioId),
            eq(schema.scenarios.applicationId, application.id),
            isNull(schema.scenarios.deletedAt),
          ),
        );
      if (!scenario) {
        throw new ApiError(400, 'SCENARIO_NOT_FOUND', 'Choose an existing scenario.', {
          issues: [{ path: 'scenarioId', message: 'scenarios.notFound' }],
        });
      }
      const existing = await testCasesOfScenario(tx, application.id, scenario.id);
      const datasets = await tx
        .select({ name: schema.datasets.name, columns: schema.datasets.columns })
        .from(schema.datasets)
        .where(
          and(eq(schema.datasets.applicationId, application.id), isNull(schema.datasets.deletedAt)),
        );
      const settings = await automationSettingsOf(tx, application.id);
      return {
        appName: application.name,
        baseUrl: settings.baseUrl,
        scenario: {
          key: scenarioKey(application, scenario),
          title: scenario.title,
          description: scenario.descriptionMd,
          stepsToReach: scenario.stepsMd,
        },
        existingTitles: existing.map((row) => `${testCaseKey(application, row)} ${row.title}`),
        datasets,
      };
    });
    const provider = await providerFor(req);
    const output = await provider
      .generate({
        system: SYSTEM_PROMPT,
        prompt: generatePrompt(context, input),
        schema: generateOutputSchema,
      })
      .catch(upstream);
    const proposals = output.testCases
      .slice(0, input.count)
      .map((testCase) => toProposal(testCase, input.executionMode));
    if (proposals.length === 0) {
      throw new ApiError(502, 'AI_INVALID_OUTPUT', 'The model did not propose any test case.');
    }
    return { proposals, model: provider.model } satisfies AiGenerateResult;
  });

  app.post(
    `${APP_PATH}/ai/test-cases/:testCaseKey/revise`,
    { preHandler: assist },
    async (req: FastifyRequest<{ Params: { testCaseKey: string } }>) => {
      const input = parse(aiReviseSchema, req.body);
      const { row, testCase } = await inOrg(services, req, async (tx) => {
        const found = await findTestCase(tx, req.application!, req.params.testCaseKey);
        if (found.deletedAt) throw conflict('TEST_CASE_DELETED', 'This test case is deleted.');
        return { row: found, testCase: await testCaseForAi(tx, req, found) };
      });
      const provider = await providerFor(req);
      const output = await provider
        .generate({
          system: SYSTEM_PROMPT,
          prompt: revisePrompt(testCase, input.instructions),
          schema: reviseOutputSchema,
        })
        .catch(upstream);
      return {
        proposal: toProposal(
          output.testCase,
          row.executionMode,
          row.steps.map((step) => step.id),
        ),
        summary: output.summary,
        model: provider.model,
        baseVersion: row.currentVersion,
      } satisfies AiReviseResult;
    },
  );

  app.post(
    `${APP_PATH}/ai/runs/:runKey/items/:itemId/fix`,
    { preHandler: assist },
    async (req: FastifyRequest<{ Params: { runKey: string; itemId: string } }>) => {
      const input = parse(aiFixSchema, req.body);
      const { row, testCase, failure } = await inOrg(services, req, async (tx) => {
        const run = await findRun(tx, req.application!, req.params.runKey);
        const item = await findItem(tx, run, req.params.itemId);
        if (item.executionMode !== 'automated' || !['failed', 'blocked'].includes(item.status)) {
          throw conflict('ITEM_NOT_FAILED', 'Only failed automated test cases can be fixed.');
        }
        const found = await findTestCaseById(tx, req.application!, item.testCaseId);
        if (found.deletedAt) throw conflict('TEST_CASE_DELETED', 'This test case is deleted.');
        const iteration = item.iterations.find(
          (it) => it.status === 'failed' || it.status === 'blocked',
        );
        const failedIndex = iteration?.error?.stepId
          ? item.steps.findIndex((step) => step.id === iteration.error!.stepId)
          : -1;
        return {
          row: found,
          testCase: await testCaseForAi(tx, req, found),
          failure: {
            runKey: runKey(req.application!, run),
            ranVersion: item.versionNumber,
            currentVersion: found.currentVersion,
            ranSteps: item.steps,
            failedStepIndex: failedIndex >= 0 ? failedIndex : null,
            error: iteration?.error?.message ?? item.error ?? 'Unknown error',
            url: iteration?.url ?? null,
            data: iteration?.data ?? null,
            consoleErrors: iteration?.consoleErrors ?? [],
            ariaSnapshot: iteration?.ariaSnapshot ?? null,
          },
        };
      });
      const provider = await providerFor(req);
      const output = await provider
        .generate({
          system: SYSTEM_PROMPT,
          prompt: fixPrompt(testCase, failure, input.instructions),
          schema: reviseOutputSchema,
        })
        .catch(upstream);
      return {
        proposal: toProposal(
          output.testCase,
          row.executionMode,
          row.steps.map((step) => step.id),
        ),
        summary: output.summary,
        model: provider.model,
        baseVersion: row.currentVersion,
      } satisfies AiReviseResult;
    },
  );
}
