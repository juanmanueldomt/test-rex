// Test runs: creation from a selection (with pinned versions and snapshots), views, manual
// results, cancellation, completion and reports. Runs inside organization-scoped transactions.
import {
  aggregateStatus,
  countStatuses,
  describeStep,
  formatRunKey,
  formatTestCaseKey,
  isFinal,
  parseRunKey,
  passRate,
  rowValues,
  type ArtifactRef,
  type CreateRunInput,
  type IterationResult,
  type ManualResultInput,
  type Run,
  type RunCounts,
  type RunItemDetail,
  type RunItemStatus,
  type RunItemSummary,
  type RunListPage,
  type RunListQuery,
  type RunReport,
  type RunSummary,
  type ScenarioBreakdown,
  type StepResult,
} from '@testrex/contracts';
import { nextSequenceValue, schema, type Transaction } from '@testrex/db';
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../http/errors';
import type { RequestApp } from '../http/guards';
import { audit } from './audit';
import {
  automationSettingsOf,
  datasetSnapshots,
  enabledHooks,
  settingsSnapshot,
} from './automation';
import { userNames, userRef, type ScenarioContext } from './scenarios';
import { scenarioLinksById, type TestCaseRow } from './test-cases';

export type RunRow = typeof schema.testRuns.$inferSelect;
export type RunItemRow = typeof schema.testRunItems.$inferSelect;

export function runKey(app: { key: string }, row: { number: number }): string {
  return formatRunKey(app.key, row.number);
}

export function runLabel(app: { key: string }, row: { number: number; title: string }) {
  return `${runKey(app, row)} · ${row.title}`;
}

/** Where artifact downloads of an application live (needs the organization slug). */
export interface UrlScope {
  orgSlug: string;
  appKey: string;
}

export async function findRun(
  tx: Transaction,
  app: RequestApp,
  key: string,
  options: { forUpdate?: boolean } = {},
): Promise<RunRow> {
  const number = parseRunKey(key, app.key);
  if (number === null) throw notFound();
  const query = tx
    .select()
    .from(schema.testRuns)
    .where(and(eq(schema.testRuns.applicationId, app.id), eq(schema.testRuns.number, number)))
    .limit(1);
  const [row] = await (options.forUpdate ? query.for('update') : query);
  if (!row) throw notFound();
  return row;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findItem(
  tx: Transaction,
  run: RunRow,
  itemId: string,
  options: { forUpdate?: boolean } = {},
): Promise<RunItemRow> {
  if (!UUID.test(itemId)) throw notFound();
  const query = tx
    .select()
    .from(schema.testRunItems)
    .where(and(eq(schema.testRunItems.runId, run.id), eq(schema.testRunItems.id, itemId)));
  const [row] = await (options.forUpdate ? query.for('update') : query);
  if (!row) throw notFound();
  return row;
}

function assertOpen(run: RunRow): void {
  if (run.status === 'completed' || run.status === 'cancelled') {
    throw conflict('RUN_CLOSED', 'This test run is finished and can no longer change.');
  }
}

// ---------------------------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------------------------

/** Test cases a selection resolves to, deduplicated and in a stable order. */
async function selectTestCases(
  tx: Transaction,
  app: RequestApp,
  input: Pick<CreateRunInput, 'scenarioIds' | 'testCaseIds' | 'modes'>,
): Promise<TestCaseRow[]> {
  const t = schema.testCases;
  if (input.scenarioIds.length) {
    const found = await tx
      .select({ id: schema.scenarios.id })
      .from(schema.scenarios)
      .where(
        and(
          eq(schema.scenarios.applicationId, app.id),
          inArray(schema.scenarios.id, input.scenarioIds),
          isNull(schema.scenarios.deletedAt),
        ),
      );
    if (found.length !== input.scenarioIds.length) {
      throw badRequest('SCENARIO_NOT_FOUND', 'Choose existing scenarios of this application.', {
        issues: [{ path: 'scenarioIds', message: 'scenarios.notFound' }],
      });
    }
  }
  if (input.testCaseIds.length) {
    const found = await tx
      .select({ id: t.id })
      .from(t)
      .where(and(eq(t.applicationId, app.id), inArray(t.id, input.testCaseIds)));
    if (found.length !== input.testCaseIds.length) {
      throw badRequest('TEST_CASE_NOT_FOUND', 'Choose existing test cases of this application.', {
        issues: [{ path: 'testCaseIds', message: 'testCases.notFound' }],
      });
    }
  }
  const live = and(
    eq(t.applicationId, app.id),
    isNull(t.deletedAt),
    inArray(t.executionMode, input.modes),
  );
  const viaScenarios = input.scenarioIds.length
    ? await tx
        .select({ row: t, scenarioId: schema.testCaseScenarios.scenarioId })
        .from(t)
        .innerJoin(schema.testCaseScenarios, eq(schema.testCaseScenarios.testCaseId, t.id))
        .where(
          and(
            live,
            ne(t.status, 'deprecated'),
            inArray(schema.testCaseScenarios.scenarioId, input.scenarioIds),
          ),
        )
    : [];
  const explicit = input.testCaseIds.length
    ? await tx
        .select({ row: t })
        .from(t)
        .where(and(live, inArray(t.id, input.testCaseIds)))
    : [];
  // Ordered by the first selected scenario they belong to, then key; explicit ones after.
  const rank = new Map<string, { row: TestCaseRow; order: number }>();
  for (const { row, scenarioId } of viaScenarios) {
    const order = input.scenarioIds.indexOf(scenarioId);
    const current = rank.get(row.id);
    if (!current || order < current.order) rank.set(row.id, { row, order });
  }
  for (const { row } of explicit) {
    if (!rank.has(row.id)) rank.set(row.id, { row, order: input.scenarioIds.length });
  }
  return [...rank.values()]
    .sort((a, b) => a.order - b.order || a.row.number - b.row.number)
    .map((entry) => entry.row);
}

function defaultTitle(testCases: TestCaseRow[], now: Date): string {
  if (testCases.length === 1) return testCases[0]!.title.slice(0, 200);
  return `${testCases.length} test cases · ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Creates a run for a selection: every item copies its test case's current version (steps,
 * mode, title, scenarios) and dataset rows; the run keeps the settings and enabled global
 * steps. Returns whether automated items wait for the worker.
 */
export async function createRun(
  tx: Transaction,
  ctx: ScenarioContext,
  input: CreateRunInput,
): Promise<{ run: RunRow; queued: boolean }> {
  const testCases = await selectTestCases(tx, ctx.app, input);
  if (testCases.length === 0) {
    throw badRequest('RUN_EMPTY', 'The selection has no test cases to run.', {
      issues: [{ path: 'scenarioIds', message: 'run.empty' }],
    });
  }
  const settings = settingsSnapshot(await automationSettingsOf(tx, ctx.app.id));
  if (input.baseUrl) settings.baseUrl = input.baseUrl;
  if (input.browser) settings.browser = input.browser;
  const hooks = await enabledHooks(tx, ctx.app.id);
  const versions = await tx
    .select()
    .from(schema.testCaseVersions)
    .where(
      inArray(
        schema.testCaseVersions.id,
        testCases.map((row) => row.currentVersionId),
      ),
    );
  const versionOf = new Map(versions.map((version) => [version.testCaseId, version]));
  const datasets = await datasetSnapshots(
    tx,
    versions.map((version) => version.datasetId),
  );

  const number = await nextSequenceValue(tx, ctx.app.id, 'TR');
  const runId = schema.newId();
  const items = testCases.map((testCase, position) => {
    const version = versionOf.get(testCase.id)!;
    const dataset = version.datasetId ? (datasets.get(version.datasetId) ?? null) : null;
    const emptyDataset = dataset !== null && dataset.rows.length === 0;
    const status: RunItemStatus = emptyDataset
      ? 'blocked'
      : version.executionMode === 'automated'
        ? 'queued'
        : 'untested';
    return {
      organizationId: ctx.organizationId,
      runId,
      testCaseId: testCase.id,
      testCaseVersionId: version.id,
      versionNumber: version.number,
      position,
      executionMode: version.executionMode,
      title: version.title,
      scenarioIds: version.scenarioIds,
      steps: version.steps,
      dataset,
      status,
      error: emptyDataset ? `Dataset "${dataset.name}" has no rows.` : null,
      finishedAt: emptyDataset ? ctx.now : null,
    };
  });
  const queued = items.some((item) => item.status === 'queued');
  const pending = items.some((item) => !isFinal(item.status));
  const [run] = await tx
    .insert(schema.testRuns)
    .values({
      id: runId,
      organizationId: ctx.organizationId,
      applicationId: ctx.app.id,
      number,
      title: input.title ?? defaultTitle(testCases, ctx.now),
      status: queued ? 'queued' : pending ? 'running' : 'completed',
      baseUrl: settings.baseUrl,
      browser: settings.browser,
      settings,
      hooks,
      createdBy: ctx.user.id,
      createdAt: ctx.now,
      startedAt: queued ? null : ctx.now,
      finishedAt: pending ? null : ctx.now,
    })
    .returning();
  await tx.insert(schema.testRunItems).values(items);
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    {
      action: 'run.created',
      targetType: 'run',
      targetId: runId,
      targetLabel: runLabel(ctx.app, run!),
      changes: {
        items: { from: null, to: items.length },
        baseUrl: { from: null, to: settings.baseUrl },
        browser: { from: null, to: settings.browser },
      },
    },
  );
  return { run: run!, queued };
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function durationOf(run: RunRow, now: Date): number | null {
  if (!run.startedAt) return null;
  return Math.max(0, (run.finishedAt ?? now).getTime() - run.startedAt.getTime());
}

interface RunStats {
  counts: RunCounts;
  hasAutomated: boolean;
  hasManual: boolean;
}

async function runStats(tx: Transaction, runIds: string[]): Promise<Map<string, RunStats>> {
  const result = new Map<string, RunStats>();
  if (runIds.length === 0) return result;
  const rows = await tx
    .select({
      runId: schema.testRunItems.runId,
      status: schema.testRunItems.status,
      mode: schema.testRunItems.executionMode,
      n: count(),
    })
    .from(schema.testRunItems)
    .where(inArray(schema.testRunItems.runId, runIds))
    .groupBy(
      schema.testRunItems.runId,
      schema.testRunItems.status,
      schema.testRunItems.executionMode,
    );
  for (const id of runIds) {
    result.set(id, { counts: countStatuses([]), hasAutomated: false, hasManual: false });
  }
  for (const row of rows) {
    const stats = result.get(row.runId)!;
    stats.counts[row.status] += row.n;
    stats.counts.total += row.n;
    if (row.mode === 'automated') stats.hasAutomated = true;
    else stats.hasManual = true;
  }
  return result;
}

function summaryOf(
  app: { key: string },
  run: RunRow,
  stats: RunStats,
  names: Map<string, string>,
  now: Date,
): RunSummary {
  return {
    id: run.id,
    key: runKey(app, run),
    number: run.number,
    title: run.title,
    status: run.status,
    baseUrl: run.baseUrl,
    browser: run.browser,
    counts: stats.counts,
    passRate: passRate(stats.counts),
    durationMs: durationOf(run, now),
    createdBy: userRef(names, run.createdBy),
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    hasAutomated: stats.hasAutomated,
    hasManual: stats.hasManual,
  };
}

export async function listRuns(
  tx: Transaction,
  app: RequestApp,
  query: RunListQuery,
  now: Date,
): Promise<RunListPage> {
  const r = schema.testRuns;
  const filters: (SQL | undefined)[] = [eq(r.applicationId, app.id)];
  if (query.status) filters.push(inArray(r.status, query.status));
  if (query.q) {
    const number = parseRunKey(query.q, app.key);
    const text = sql`lower(${r.title}) LIKE ${`%${query.q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`;
    filters.push(number === null ? text : or(text, eq(r.number, number)));
  }
  const where = and(...filters)!;
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(r).where(where);
  const lastPage = Math.max(1, Math.ceil(total / query.size));
  const page = Math.min(query.page, lastPage);
  const descending = query.sort.startsWith('-');
  const field = query.sort.replace(/^-/, '');
  const column =
    field === 'title'
      ? sql`lower(${r.title})`
      : field === 'status'
        ? sql`${r.status}`
        : field === 'created'
          ? sql`${r.createdAt}`
          : sql`${r.number}`;
  const rows = await tx
    .select()
    .from(r)
    .where(where)
    .orderBy(descending ? desc(column) : asc(column), descending ? desc(r.number) : asc(r.number))
    .limit(query.size)
    .offset((page - 1) * query.size);
  const stats = await runStats(
    tx,
    rows.map((row) => row.id),
  );
  const names = await userNames(
    tx,
    rows.map((row) => row.createdBy),
  );
  return {
    items: rows.map((row) => summaryOf(app, row, stats.get(row.id)!, names, now)),
    total,
    page,
    size: query.size,
  };
}

function artifactUrl(scope: UrlScope, run: RunRow, artifactId: string): string {
  return `/api/orgs/${scope.orgSlug}/apps/${scope.appKey}/runs/${scope.appKey}-TR-${run.number}/artifacts/${artifactId}`;
}

/** Fills in download URLs (the worker stores artifacts without them). */
function withUrls(iterations: IterationResult[], scope: UrlScope, run: RunRow): IterationResult[] {
  return iterations.map((iteration) => ({
    ...iteration,
    artifacts: iteration.artifacts?.map((artifact): ArtifactRef => ({
      ...artifact,
      url: artifactUrl(scope, run, artifact.id),
    })),
  }));
}

async function testCaseRefs(tx: Transaction, items: RunItemRow[]) {
  const ids = [...new Set(items.map((item) => item.testCaseId))];
  if (ids.length === 0) return new Map<string, { number: number; deleted: boolean }>();
  const rows = await tx
    .select({
      id: schema.testCases.id,
      number: schema.testCases.number,
      deletedAt: schema.testCases.deletedAt,
    })
    .from(schema.testCases)
    .where(inArray(schema.testCases.id, ids));
  return new Map(
    rows.map((row) => [row.id, { number: row.number, deleted: row.deletedAt !== null }]),
  );
}

async function itemSummaries(
  tx: Transaction,
  app: RequestApp,
  items: RunItemRow[],
): Promise<RunItemSummary[]> {
  const refs = await testCaseRefs(tx, items);
  const links = await scenarioLinksById(
    tx,
    app,
    items.flatMap((item) => item.scenarioIds),
  );
  const names = await userNames(
    tx,
    items.map((item) => item.executedBy),
  );
  return items.map((item) => {
    const ref = refs.get(item.testCaseId);
    const failedIndex = item.failedStepId
      ? item.steps.findIndex((step) => step.id === item.failedStepId)
      : -1;
    const failedStep = failedIndex >= 0 ? item.steps[failedIndex]! : null;
    return {
      id: item.id,
      position: item.position,
      testCase: {
        id: item.testCaseId,
        key: formatTestCaseKey(app.key, ref?.number ?? 0),
        deleted: ref?.deleted ?? false,
      },
      title: item.title,
      version: item.versionNumber,
      executionMode: item.executionMode,
      scenarios: item.scenarioIds.flatMap((id) => {
        const link = links.get(id);
        return link ? [link] : [];
      }),
      status: item.status,
      iterationCount: item.dataset ? item.dataset.rows.length : 1,
      durationMs: item.durationMs,
      startedAt: item.startedAt?.toISOString() ?? null,
      finishedAt: item.finishedAt?.toISOString() ?? null,
      error: item.error,
      failedStep: failedStep
        ? { id: failedStep.id, index: failedIndex, text: describeStep(failedStep) }
        : null,
      executedBy: item.executedBy ? userRef(names, item.executedBy) : null,
    };
  });
}

function breakdown(items: RunItemSummary[]): ScenarioBreakdown[] {
  const byScenario = new Map<
    string,
    { scenario: RunItemSummary['scenarios'][number]; statuses: RunItemStatus[] }
  >();
  for (const item of items) {
    for (const scenario of item.scenarios) {
      const entry = byScenario.get(scenario.id) ?? { scenario, statuses: [] };
      entry.statuses.push(item.status);
      byScenario.set(scenario.id, entry);
    }
  }
  return [...byScenario.values()]
    .map(({ scenario, statuses }) => {
      const counts = countStatuses(statuses);
      return { scenario, counts, passRate: passRate(counts) };
    })
    .sort((a, b) => a.scenario.key.localeCompare(b.scenario.key, undefined, { numeric: true }));
}

async function runItems(tx: Transaction, runId: string): Promise<RunItemRow[]> {
  return tx
    .select()
    .from(schema.testRunItems)
    .where(eq(schema.testRunItems.runId, runId))
    .orderBy(asc(schema.testRunItems.position));
}

export async function runView(
  tx: Transaction,
  app: RequestApp,
  run: RunRow,
  now: Date,
): Promise<Run> {
  const items = await runItems(tx, run.id);
  const summaries = await itemSummaries(tx, app, items);
  const stats: RunStats = {
    counts: countStatuses(items.map((item) => item.status)),
    hasAutomated: items.some((item) => item.executionMode === 'automated'),
    hasManual: items.some((item) => item.executionMode === 'manual'),
  };
  const names = await userNames(tx, [run.createdBy, run.cancelledBy]);
  return {
    ...summaryOf(app, run, stats, names, now),
    settings: run.settings,
    hooks: run.hooks,
    hookResults: run.hookResults,
    items: summaries,
    scenarios: breakdown(summaries),
    cancelledBy: run.cancelledBy ? userRef(names, run.cancelledBy) : null,
    error: run.error,
  };
}

export async function itemDetail(
  tx: Transaction,
  app: RequestApp,
  scope: UrlScope,
  run: RunRow,
  item: RunItemRow,
): Promise<RunItemDetail> {
  const [summary] = await itemSummaries(tx, app, [item]);
  return {
    ...summary!,
    steps: item.steps,
    dataset: item.dataset,
    iterations: withUrls(item.iterations, scope, run),
    notes: item.notes,
  };
}

export async function runReport(
  tx: Transaction,
  app: RequestApp,
  scope: UrlScope,
  run: RunRow,
  now: Date,
): Promise<RunReport> {
  const view = await runView(tx, app, run, now);
  const items = await runItems(tx, run.id);
  const summaries = new Map(view.items.map((summary) => [summary.id, summary]));
  return {
    ...view,
    generatedAt: now.toISOString(),
    items: items.map((item) => ({
      ...summaries.get(item.id)!,
      steps: item.steps,
      dataset: item.dataset,
      iterations: withUrls(item.iterations, scope, run),
      notes: item.notes,
    })),
  };
}

// ---------------------------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------------------------

/** Completes a running run once every item has a final status. */
export async function maybeCompleteRun(tx: Transaction, runId: string, now: Date): Promise<void> {
  const [open] = await tx
    .select({ n: count() })
    .from(schema.testRunItems)
    .where(
      and(
        eq(schema.testRunItems.runId, runId),
        inArray(schema.testRunItems.status, ['queued', 'untested', 'running']),
      ),
    );
  if ((open?.n ?? 0) > 0) return;
  await tx
    .update(schema.testRuns)
    .set({ status: 'completed', finishedAt: now })
    .where(
      and(eq(schema.testRuns.id, runId), inArray(schema.testRuns.status, ['queued', 'running'])),
    );
}

export async function recordManualResult(
  tx: Transaction,
  ctx: ScenarioContext,
  run: RunRow,
  item: RunItemRow,
  input: ManualResultInput,
): Promise<void> {
  assertOpen(run);
  if (item.executionMode !== 'manual') {
    throw conflict('ITEM_NOT_MANUAL', 'Automated test cases are executed by testRex.');
  }
  if (item.dataset && item.dataset.rows.length === 0) {
    throw conflict('ITEM_BLOCKED', item.error ?? 'The dataset of this test case has no rows.');
  }
  const expected = item.dataset ? item.dataset.rows.length : 1;
  const indexes = input.iterations.map((iteration) => iteration.index).sort((a, b) => a - b);
  const stepIds = new Set(item.steps.map((step) => step.id));
  const issues: { path: string; message: string }[] = [];
  if (indexes.length !== expected || indexes.some((index, position) => index !== position)) {
    issues.push({ path: 'iterations', message: 'run.iterationsMismatch' });
  }
  input.iterations.forEach((iteration, i) =>
    iteration.steps.forEach((step, j) => {
      if (!stepIds.has(step.stepId)) {
        issues.push({ path: `iterations.${i}.steps.${j}.stepId`, message: 'run.unknownStep' });
      }
    }),
  );
  if (issues.length) throw badRequest('VALIDATION_FAILED', 'Some fields are invalid.', { issues });

  const nowIso = ctx.now.toISOString();
  const iterations: IterationResult[] = [...input.iterations]
    .sort((a, b) => a.index - b.index)
    .map((iteration) => {
      const steps: StepResult[] = item.steps.map((step) => {
        const result = iteration.steps.find((s) => s.stepId === step.id);
        return {
          stepId: step.id,
          status: result?.status ?? 'untested',
          ...(result?.actual ? { actual: result.actual } : {}),
        };
      });
      const failed = steps.find((step) => step.status === 'failed' || step.status === 'blocked');
      return {
        index: iteration.index,
        data: item.dataset
          ? rowValues(item.dataset.columns, item.dataset.rows[iteration.index] ?? [])
          : null,
        status: iteration.status,
        startedAt: item.startedAt?.toISOString() ?? nowIso,
        finishedAt: nowIso,
        durationMs: null,
        steps,
        hooks: [],
        ...(iteration.status === 'failed' || iteration.status === 'blocked'
          ? {
              error: {
                message: failed?.actual ?? input.notes ?? iteration.status,
                ...(failed ? { stepId: failed.stepId } : {}),
              },
            }
          : {}),
      };
    });
  const status = aggregateStatus(iterations.map((iteration) => iteration.status));
  const firstFailure = iterations.find((iteration) => iteration.error)?.error;
  await tx
    .update(schema.testRunItems)
    .set({
      status,
      iterations,
      notes: input.notes ?? null,
      error: status === 'failed' || status === 'blocked' ? (firstFailure?.message ?? null) : null,
      failedStepId:
        status === 'failed' || status === 'blocked' ? (firstFailure?.stepId ?? null) : null,
      executedBy: ctx.user.id,
      startedAt: item.startedAt ?? ctx.now,
      finishedAt: ctx.now,
    })
    .where(eq(schema.testRunItems.id, item.id));
  if (!run.startedAt) {
    await tx
      .update(schema.testRuns)
      .set({ startedAt: ctx.now })
      .where(eq(schema.testRuns.id, run.id));
  }
  await maybeCompleteRun(tx, run.id, ctx.now);
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    {
      action: 'run_item.executed',
      targetType: 'run',
      targetId: run.id,
      targetLabel: `${runKey(ctx.app, run)} · ${item.title}`,
      changes: { status: { from: item.status, to: status } },
    },
  );
}

export async function cancelRun(tx: Transaction, ctx: ScenarioContext, run: RunRow): Promise<void> {
  assertOpen(run);
  await tx
    .update(schema.testRuns)
    .set({
      status: 'cancelled',
      finishedAt: ctx.now,
      cancelledBy: ctx.user.id,
      startedAt: run.startedAt ?? ctx.now,
    })
    .where(eq(schema.testRuns.id, run.id));
  await tx
    .update(schema.testRunItems)
    .set({ status: 'skipped', error: 'The run was cancelled.', finishedAt: ctx.now })
    .where(
      and(
        eq(schema.testRunItems.runId, run.id),
        inArray(schema.testRunItems.status, ['queued', 'untested', 'running']),
      ),
    );
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    {
      action: 'run.cancelled',
      targetType: 'run',
      targetId: run.id,
      targetLabel: runLabel(ctx.app, run),
      changes: { status: { from: run.status, to: 'cancelled' } },
    },
  );
}

/** Closes a run whose automated part is done: untested items are skipped. */
export async function completeRun(
  tx: Transaction,
  ctx: ScenarioContext,
  run: RunRow,
): Promise<void> {
  assertOpen(run);
  const [busy] = await tx
    .select({ n: count() })
    .from(schema.testRunItems)
    .where(
      and(
        eq(schema.testRunItems.runId, run.id),
        inArray(schema.testRunItems.status, ['queued', 'running']),
      ),
    );
  if ((busy?.n ?? 0) > 0) {
    throw conflict(
      'RUN_AUTOMATION_RUNNING',
      'Automated test cases of this run are still running. Wait for them or cancel the run.',
    );
  }
  await tx
    .update(schema.testRunItems)
    .set({
      status: 'skipped',
      error: 'Not executed before the run was completed.',
      finishedAt: ctx.now,
    })
    .where(and(eq(schema.testRunItems.runId, run.id), eq(schema.testRunItems.status, 'untested')));
  await tx
    .update(schema.testRuns)
    .set({ status: 'completed', finishedAt: ctx.now, startedAt: run.startedAt ?? ctx.now })
    .where(eq(schema.testRuns.id, run.id));
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    {
      action: 'run.completed',
      targetType: 'run',
      targetId: run.id,
      targetLabel: runLabel(ctx.app, run),
      changes: { status: { from: run.status, to: 'completed' } },
    },
  );
}

/** Test case ids of a run for a re-run: all of them, or only failed and blocked ones. */
export async function rerunSelection(
  tx: Transaction,
  run: RunRow,
  scope: 'all' | 'failed',
): Promise<string[]> {
  const rows = await tx
    .select({ testCaseId: schema.testRunItems.testCaseId, status: schema.testRunItems.status })
    .from(schema.testRunItems)
    .innerJoin(schema.testCases, eq(schema.testCases.id, schema.testRunItems.testCaseId))
    .where(and(eq(schema.testRunItems.runId, run.id), isNull(schema.testCases.deletedAt)))
    .orderBy(asc(schema.testRunItems.position));
  return [
    ...new Set(
      rows
        .filter((row) => scope === 'all' || row.status === 'failed' || row.status === 'blocked')
        .map((row) => row.testCaseId),
    ),
  ];
}
