// Test case domain logic shared by the test case, scenario, run and AI routes. Every function
// runs inside the caller's organization-scoped transaction (RLS) and scopes its queries to the
// request's application.
import {
  foldForSearch,
  formatScenarioKey,
  formatTestCaseKey,
  modeIssues,
  parseTestCaseKey,
  TEST_CASE_LARGE_FIELDS,
  TEST_CASE_VERSION_FIELDS,
  type CreateTestCaseInput,
  type DatasetRef,
  type ExecutionMode,
  type FieldChange,
  type LastResult,
  type ScenarioLink,
  type ScenarioPriority,
  type ScenarioStatus,
  type TestCase,
  type TestCaseField,
  type TestCaseListItem,
  type TestCaseListPage,
  type TestCaseListQuery,
  type TestCaseVersion,
  type TestCaseVersionSummary,
  type TestStep,
  type UserRef,
  type VersionSource,
} from '@testrex/contracts';
import { nextSequenceValue, schema, type Transaction } from '@testrex/db';
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { badRequest, conflict, notFound } from '../http/errors';
import type { RequestApp } from '../http/guards';
import { audit } from './audit';
import { resolveTags, userNames, userRef, type ScenarioContext } from './scenarios';

export type TestCaseRow = typeof schema.testCases.$inferSelect;
export type TestCaseVersionRow = typeof schema.testCaseVersions.$inferSelect;

/** The versioned fields in storage form. Id lists are sorted so states compare by value. */
export interface TestCaseState {
  title: string;
  status: ScenarioStatus;
  priority: ScenarioPriority;
  executionMode: ExecutionMode;
  scenarioIds: string[];
  tagIds: string[];
  datasetId: string | null;
  description: string;
  preconditions: string;
  steps: TestStep[];
}

const STATE_KEYS: Record<TestCaseField, keyof TestCaseState> = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  executionMode: 'executionMode',
  scenarios: 'scenarioIds',
  tags: 'tagIds',
  dataset: 'datasetId',
  description: 'description',
  preconditions: 'preconditions',
  steps: 'steps',
};

export function testCaseKey(app: { key: string }, row: { number: number }): string {
  return formatTestCaseKey(app.key, row.number);
}

export function testCaseLabel(app: { key: string }, row: { number: number; title: string }) {
  return `${testCaseKey(app, row)} · ${row.title}`;
}

/** A test case of the request's application by key or number, including deleted ones. */
export async function findTestCase(
  tx: Transaction,
  app: RequestApp,
  key: string,
  options: { forUpdate?: boolean } = {},
): Promise<TestCaseRow> {
  const number = parseTestCaseKey(key, app.key);
  if (number === null) throw notFound();
  const query = tx
    .select()
    .from(schema.testCases)
    .where(and(eq(schema.testCases.applicationId, app.id), eq(schema.testCases.number, number)))
    .limit(1);
  const [row] = await (options.forUpdate ? query.for('update') : query);
  if (!row) throw notFound();
  return row;
}

/** A test case of the request's application by id (404 otherwise). */
export async function findTestCaseById(
  tx: Transaction,
  app: RequestApp,
  id: string,
): Promise<TestCaseRow> {
  const [row] = await tx
    .select()
    .from(schema.testCases)
    .where(and(eq(schema.testCases.applicationId, app.id), eq(schema.testCases.id, id)));
  if (!row) throw notFound();
  return row;
}

export function assertTestCaseNotDeleted(row: TestCaseRow): void {
  if (row.deletedAt) {
    throw conflict('TEST_CASE_DELETED', 'This test case is deleted. Restore it to make changes.');
  }
}

export async function linkedScenarioIds(tx: Transaction, testCaseId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.testCaseScenarios.scenarioId })
    .from(schema.testCaseScenarios)
    .where(eq(schema.testCaseScenarios.testCaseId, testCaseId));
  return rows.map((row) => row.id).sort();
}

export async function linkedTagIds(tx: Transaction, testCaseId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.testCaseTags.tagId })
    .from(schema.testCaseTags)
    .where(eq(schema.testCaseTags.testCaseId, testCaseId));
  return rows.map((row) => row.id).sort();
}

export function stateOf(
  row: TestCaseRow | TestCaseVersionRow,
  scenarioIds: string[],
  tagIds: string[],
): TestCaseState {
  return {
    title: row.title,
    status: row.status,
    priority: row.priority,
    executionMode: row.executionMode,
    scenarioIds: [...scenarioIds].sort(),
    tagIds: [...tagIds].sort(),
    datasetId: row.datasetId,
    description: row.descriptionMd,
    preconditions: row.preconditionsMd,
    steps: row.steps,
  };
}

export function changedFields(before: TestCaseState, after: TestCaseState): TestCaseField[] {
  return TEST_CASE_VERSION_FIELDS.filter((field) => {
    const key = STATE_KEYS[field];
    return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  });
}

/**
 * Scenario ids must belong to the application. New links must point to live scenarios; links
 * that already exist may stay even if their scenario was deleted since.
 */
export async function requireScenarioLinks(
  tx: Transaction,
  app: RequestApp,
  ids: string[],
  alreadyLinked: Set<string> = new Set(),
): Promise<void> {
  const rows = ids.length
    ? await tx
        .select({ id: schema.scenarios.id, deletedAt: schema.scenarios.deletedAt })
        .from(schema.scenarios)
        .where(and(eq(schema.scenarios.applicationId, app.id), inArray(schema.scenarios.id, ids)))
    : [];
  const found = new Map(rows.map((row) => [row.id, row.deletedAt]));
  const invalid = ids.filter(
    (id) => !found.has(id) || (found.get(id) !== null && !alreadyLinked.has(id)),
  );
  if (invalid.length || ids.length === 0) {
    throw badRequest('SCENARIO_NOT_FOUND', 'Choose existing scenarios of this application.', {
      issues: [{ path: 'scenarioIds', message: 'scenarios.notFound' }],
    });
  }
}

/** A live dataset of the application. */
export async function requireDataset(tx: Transaction, app: RequestApp, id: string) {
  const [row] = await tx
    .select()
    .from(schema.datasets)
    .where(
      and(
        eq(schema.datasets.id, id),
        eq(schema.datasets.applicationId, app.id),
        isNull(schema.datasets.deletedAt),
      ),
    );
  if (!row) {
    throw badRequest('DATASET_NOT_FOUND', 'The selected dataset does not exist.', {
      issues: [{ path: 'datasetId', message: 'dataset.notFound' }],
    });
  }
  return row;
}

export function buildTestCaseSearchText(state: TestCaseState): string {
  const stepTexts = state.steps.flatMap((step) => [
    step.description,
    step.expected,
    step.value,
    step.target?.value,
    step.target?.name,
  ]);
  return foldForSearch(
    [state.title, state.description, state.preconditions, ...stepTexts]
      .filter((text): text is string => Boolean(text))
      .join('\n'),
  );
}

/** Steps that cannot run automatically in an automated test case → 400 with field issues. */
export function assertModeAllowsSteps(state: Pick<TestCaseState, 'executionMode' | 'steps'>) {
  const issues = modeIssues(state.executionMode, state.steps).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  if (issues.length) throw badRequest('VALIDATION_FAILED', 'Some fields are invalid.', { issues });
}

async function insertVersion(
  tx: Transaction,
  ctx: ScenarioContext,
  testCaseId: string,
  number: number,
  state: TestCaseState,
  changed: TestCaseField[],
  source: VersionSource,
  restoredFrom: number | null,
  id: string = schema.newId(),
): Promise<TestCaseVersionRow> {
  const [row] = await tx
    .insert(schema.testCaseVersions)
    .values({
      id,
      organizationId: ctx.organizationId,
      testCaseId,
      number,
      title: state.title,
      status: state.status,
      priority: state.priority,
      executionMode: state.executionMode,
      descriptionMd: state.description,
      preconditionsMd: state.preconditions,
      steps: state.steps,
      datasetId: state.datasetId,
      scenarioIds: state.scenarioIds,
      tagIds: state.tagIds,
      changedFields: changed,
      source,
      restoredFrom,
      authorId: ctx.user.id,
      authorLabel: ctx.user.name,
      createdAt: ctx.now,
    })
    .returning();
  return row!;
}

/** Scenario keys, tag names and dataset names for audit entries. */
async function auditNames(tx: Transaction, app: RequestApp, states: TestCaseState[]) {
  const scenarioIds = [...new Set(states.flatMap((s) => s.scenarioIds))];
  const tagIds = [...new Set(states.flatMap((s) => s.tagIds))];
  const datasetIds = [...new Set(states.flatMap((s) => (s.datasetId ? [s.datasetId] : [])))];
  const scenarios = scenarioIds.length
    ? await tx
        .select({ id: schema.scenarios.id, number: schema.scenarios.number })
        .from(schema.scenarios)
        .where(inArray(schema.scenarios.id, scenarioIds))
    : [];
  const tags = tagIds.length
    ? await tx
        .select({ id: schema.tags.id, name: schema.tags.name })
        .from(schema.tags)
        .where(inArray(schema.tags.id, tagIds))
    : [];
  const datasets = datasetIds.length
    ? await tx
        .select({ id: schema.datasets.id, name: schema.datasets.name })
        .from(schema.datasets)
        .where(inArray(schema.datasets.id, datasetIds))
    : [];
  const scenarioKey = new Map(scenarios.map((s) => [s.id, formatScenarioKey(app.key, s.number)]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const datasetName = new Map(datasets.map((d) => [d.id, d.name]));
  return {
    scenarios: (state: TestCaseState) =>
      state.scenarioIds.map((id) => scenarioKey.get(id) ?? id).sort(),
    tags: (state: TestCaseState) => state.tagIds.map((id) => tagName.get(id) ?? id).sort(),
    dataset: (state: TestCaseState) =>
      state.datasetId ? (datasetName.get(state.datasetId) ?? state.datasetId) : null,
  };
}

async function auditChanges(
  tx: Transaction,
  app: RequestApp,
  before: TestCaseState | null,
  after: TestCaseState,
  changed: TestCaseField[],
  versions: { from: number | null; to: number },
): Promise<Record<string, FieldChange>> {
  const names = await auditNames(tx, app, before ? [before, after] : [after]);
  const changes: Record<string, FieldChange> = {};
  for (const field of changed) {
    if (TEST_CASE_LARGE_FIELDS.includes(field)) {
      changes[field] = {
        from: versions.from === null ? null : `v${versions.from}`,
        to: `v${versions.to}`,
      };
    } else if (field === 'scenarios' || field === 'tags' || field === 'dataset') {
      changes[field] = { from: before ? names[field](before) : null, to: names[field](after) };
    } else {
      const key = STATE_KEYS[field];
      changes[field] = { from: before ? before[key] : null, to: after[key] };
    }
  }
  return changes;
}

async function replaceLinks(
  tx: Transaction,
  ctx: ScenarioContext,
  testCaseId: string,
  state: TestCaseState,
  which: { scenarios: boolean; tags: boolean },
) {
  if (which.scenarios) {
    await tx
      .delete(schema.testCaseScenarios)
      .where(eq(schema.testCaseScenarios.testCaseId, testCaseId));
    if (state.scenarioIds.length) {
      await tx.insert(schema.testCaseScenarios).values(
        state.scenarioIds.map((scenarioId) => ({
          testCaseId,
          scenarioId,
          organizationId: ctx.organizationId,
        })),
      );
    }
  }
  if (which.tags) {
    await tx.delete(schema.testCaseTags).where(eq(schema.testCaseTags.testCaseId, testCaseId));
    if (state.tagIds.length) {
      await tx
        .insert(schema.testCaseTags)
        .values(
          state.tagIds.map((tagId) => ({ testCaseId, tagId, organizationId: ctx.organizationId })),
        );
    }
  }
}

/** Creates a test case with the next key number and version v1. */
export async function createTestCase(
  tx: Transaction,
  ctx: ScenarioContext,
  input: CreateTestCaseInput,
): Promise<TestCaseRow> {
  await requireScenarioLinks(tx, ctx.app, input.scenarioIds);
  if (input.datasetId) await requireDataset(tx, ctx.app, input.datasetId);
  const tags = await resolveTags(tx, ctx, input.tags);
  const state: TestCaseState = {
    title: input.title,
    status: input.status,
    priority: input.priority,
    executionMode: input.executionMode,
    scenarioIds: [...input.scenarioIds].sort(),
    tagIds: tags.map((tag) => tag.id).sort(),
    datasetId: input.datasetId,
    description: input.description,
    preconditions: input.preconditions,
    steps: input.steps,
  };
  assertModeAllowsSteps(state);
  const number = await nextSequenceValue(tx, ctx.app.id, 'TC');
  const id = schema.newId();
  const versionId = schema.newId();
  const [row] = await tx
    .insert(schema.testCases)
    .values({
      id,
      organizationId: ctx.organizationId,
      applicationId: ctx.app.id,
      number,
      title: state.title,
      status: state.status,
      priority: state.priority,
      executionMode: state.executionMode,
      descriptionMd: state.description,
      preconditionsMd: state.preconditions,
      steps: state.steps,
      datasetId: state.datasetId,
      searchText: buildTestCaseSearchText(state),
      currentVersion: 1,
      currentVersionId: versionId,
      createdBy: ctx.user.id,
      createdAt: ctx.now,
      updatedBy: ctx.user.id,
      updatedAt: ctx.now,
    })
    .returning();
  await replaceLinks(tx, ctx, id, state, { scenarios: true, tags: true });
  await insertVersion(tx, ctx, id, 1, state, [], input.source, null, versionId);
  const initial = TEST_CASE_VERSION_FIELDS.filter((field) => {
    const value = state[STATE_KEYS[field]];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    {
      action: 'test_case.created',
      targetType: 'test_case',
      targetId: id,
      targetLabel: testCaseLabel(ctx.app, row!),
      changes: await auditChanges(tx, ctx.app, null, state, initial, { from: null, to: 1 }),
    },
  );
  return row!;
}

async function conflictError(tx: Transaction, row: TestCaseRow) {
  const [latest] = await tx
    .select({
      authorLabel: schema.testCaseVersions.authorLabel,
      createdAt: schema.testCaseVersions.createdAt,
    })
    .from(schema.testCaseVersions)
    .where(eq(schema.testCaseVersions.id, row.currentVersionId));
  return conflict(
    'TEST_CASE_CHANGED',
    `${latest?.authorLabel ?? 'Someone'} changed this test case since you opened it.`,
    {
      latestVersion: row.currentVersion,
      changedBy: latest?.authorLabel ?? '',
      changedAt: (latest?.createdAt ?? row.updatedAt).toISOString(),
    },
  );
}

export async function assertBaseVersion(tx: Transaction, row: TestCaseRow, baseVersion: number) {
  if (row.currentVersion !== baseVersion) throw await conflictError(tx, row);
}

/**
 * Writes a new state: appends the next version and updates the current row, unless nothing
 * changed. `row` must have been read `FOR UPDATE` in this transaction.
 */
export async function saveTestCaseState(
  tx: Transaction,
  ctx: ScenarioContext,
  row: TestCaseRow,
  next: TestCaseState,
  options: { baseVersion: number; source: VersionSource; restoredFrom?: number },
): Promise<{ row: TestCaseRow; changed: TestCaseField[] }> {
  const before = stateOf(row, await linkedScenarioIds(tx, row.id), await linkedTagIds(tx, row.id));
  const changed = changedFields(before, next);
  if (changed.length === 0) return { row, changed };
  assertModeAllowsSteps(next);

  const number = row.currentVersion + 1;
  const version = await insertVersion(
    tx,
    ctx,
    row.id,
    number,
    next,
    changed,
    options.source,
    options.restoredFrom ?? null,
  );
  const [updated] = await tx
    .update(schema.testCases)
    .set({
      title: next.title,
      status: next.status,
      priority: next.priority,
      executionMode: next.executionMode,
      descriptionMd: next.description,
      preconditionsMd: next.preconditions,
      steps: next.steps,
      datasetId: next.datasetId,
      searchText: buildTestCaseSearchText(next),
      currentVersion: number,
      currentVersionId: version.id,
      updatedBy: ctx.user.id,
      updatedAt: ctx.now,
    })
    .where(
      and(
        eq(schema.testCases.id, row.id),
        eq(schema.testCases.currentVersion, options.baseVersion),
      ),
    )
    .returning();
  if (!updated) throw await conflictError(tx, row);
  await replaceLinks(tx, ctx, row.id, next, {
    scenarios: changed.includes('scenarios'),
    tags: changed.includes('tags'),
  });

  const changes = await auditChanges(tx, ctx.app, before, next, changed, {
    from: row.currentVersion,
    to: number,
  });
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    options.restoredFrom
      ? {
          action: 'test_case.version_restored',
          targetType: 'test_case',
          targetId: row.id,
          targetLabel: testCaseLabel(ctx.app, updated),
          changes: {
            version: { from: `v${options.restoredFrom}`, to: `v${number}` },
            ...changes,
          },
        }
      : {
          action: 'test_case.updated',
          targetType: 'test_case',
          targetId: row.id,
          targetLabel: testCaseLabel(ctx.app, updated),
          changes,
        },
  );
  return { row: updated, changed };
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

/** Links of each test case to its scenarios (including deleted scenarios). */
export async function scenarioLinksOf(
  tx: Transaction,
  app: { key: string },
  testCaseIds: string[],
): Promise<Map<string, ScenarioLink[]>> {
  const result = new Map<string, ScenarioLink[]>();
  if (testCaseIds.length === 0) return result;
  const rows = await tx
    .select({
      testCaseId: schema.testCaseScenarios.testCaseId,
      id: schema.scenarios.id,
      number: schema.scenarios.number,
      title: schema.scenarios.title,
      deletedAt: schema.scenarios.deletedAt,
    })
    .from(schema.testCaseScenarios)
    .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.testCaseScenarios.scenarioId))
    .where(inArray(schema.testCaseScenarios.testCaseId, testCaseIds))
    .orderBy(asc(schema.scenarios.number));
  for (const row of rows) {
    const links = result.get(row.testCaseId) ?? [];
    links.push({
      id: row.id,
      key: formatScenarioKey(app.key, row.number),
      title: row.title,
      deleted: row.deletedAt !== null,
    });
    result.set(row.testCaseId, links);
  }
  return result;
}

/** Scenario links for a list of ids (version snapshots, run items), in key order. */
export async function scenarioLinksById(
  tx: Transaction,
  app: { key: string },
  scenarioIds: string[],
): Promise<Map<string, ScenarioLink>> {
  if (scenarioIds.length === 0) return new Map();
  const rows = await tx
    .select({
      id: schema.scenarios.id,
      number: schema.scenarios.number,
      title: schema.scenarios.title,
      deletedAt: schema.scenarios.deletedAt,
    })
    .from(schema.scenarios)
    .where(inArray(schema.scenarios.id, [...new Set(scenarioIds)]));
  return new Map(
    rows
      .sort((a, b) => a.number - b.number)
      .map((row) => [
        row.id,
        {
          id: row.id,
          key: formatScenarioKey(app.key, row.number),
          title: row.title,
          deleted: row.deletedAt !== null,
        },
      ]),
  );
}

/** Most recent final result of each test case, with the run key. */
export async function lastResults(
  tx: Transaction,
  app: { key: string },
  testCaseIds: string[],
): Promise<Map<string, LastResult>> {
  if (testCaseIds.length === 0) return new Map();
  const rows = await tx.execute<{
    test_case_id: string;
    status: LastResult['status'];
    finished_at: Date | string;
    number: number;
  }>(sql`
    SELECT DISTINCT ON (i.test_case_id) i.test_case_id, i.status, i.finished_at, r.number
      FROM ${schema.testRunItems} i
      JOIN ${schema.testRuns} r ON r.id = i.run_id
     WHERE i.test_case_id IN (${sql.join(
       testCaseIds.map((id) => sql`${id}`),
       sql`, `,
     )})
       AND i.status IN ('passed', 'failed', 'blocked', 'skipped')
       AND i.finished_at IS NOT NULL
     ORDER BY i.test_case_id, i.finished_at DESC`);
  return new Map(
    rows.rows.map((row) => [
      row.test_case_id,
      {
        status: row.status,
        runKey: `${app.key}-TR-${row.number}`,
        finishedAt: new Date(row.finished_at).toISOString(),
      },
    ]),
  );
}

async function tagNamesByCase(tx: Transaction, testCaseIds: string[]) {
  const result = new Map<string, string[]>();
  if (testCaseIds.length === 0) return result;
  const rows = await tx
    .select({ testCaseId: schema.testCaseTags.testCaseId, name: schema.tags.name })
    .from(schema.testCaseTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.testCaseTags.tagId))
    .where(inArray(schema.testCaseTags.testCaseId, testCaseIds))
    .orderBy(asc(schema.tags.name));
  for (const row of rows)
    result.set(row.testCaseId, [...(result.get(row.testCaseId) ?? []), row.name]);
  return result;
}

export async function datasetRef(
  tx: Transaction,
  datasetId: string | null,
): Promise<DatasetRef | null> {
  if (!datasetId) return null;
  const [row] = await tx
    .select({ id: schema.datasets.id, name: schema.datasets.name })
    .from(schema.datasets)
    .where(eq(schema.datasets.id, datasetId));
  return row ?? null;
}

/** The full test case as returned by the API. */
export async function testCaseView(
  tx: Transaction,
  app: RequestApp,
  row: TestCaseRow,
): Promise<TestCase> {
  const links = (await scenarioLinksOf(tx, app, [row.id])).get(row.id) ?? [];
  const tags = (await tagNamesByCase(tx, [row.id])).get(row.id) ?? [];
  const last = (await lastResults(tx, app, [row.id])).get(row.id) ?? null;
  const names = await userNames(tx, [row.createdBy, row.updatedBy, row.deletedBy]);
  const labels = await tx
    .select({
      number: schema.testCaseVersions.number,
      label: schema.testCaseVersions.authorLabel,
    })
    .from(schema.testCaseVersions)
    .where(
      and(
        eq(schema.testCaseVersions.testCaseId, row.id),
        inArray(schema.testCaseVersions.number, [1, row.currentVersion]),
      ),
    );
  const label = (number: number) => labels.find((l) => l.number === number)?.label ?? '';
  return {
    id: row.id,
    key: testCaseKey(app, row),
    number: row.number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    executionMode: row.executionMode,
    scenarios: links,
    tags,
    stepCount: row.steps.length,
    dataset: await datasetRef(tx, row.datasetId),
    lastResult: last,
    author: userRef(names, row.createdBy, label(1)),
    createdAt: row.createdAt.toISOString(),
    updatedBy: userRef(names, row.updatedBy, label(row.currentVersion)),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedBy: row.deletedAt ? userRef(names, row.deletedBy) : null,
    description: row.descriptionMd,
    preconditions: row.preconditionsMd,
    steps: row.steps,
    version: row.currentVersion,
    versionId: row.currentVersionId,
  };
}

/** `%`, `_` and `\` are LIKE wildcards/escapes and must match literally. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const creator = alias(schema.users, 'tc_creator');
const updater = alias(schema.users, 'tc_updater');

function listFilters(appId: string, appKey: string, query: TestCaseListQuery): SQL {
  const t = schema.testCases;
  const filters: (SQL | undefined)[] = [eq(t.applicationId, appId)];
  if (!query.deleted) filters.push(isNull(t.deletedAt));
  if (query.status) filters.push(inArray(t.status, query.status));
  if (query.priority) filters.push(inArray(t.priority, query.priority));
  if (query.mode) filters.push(inArray(t.executionMode, query.mode));
  if (query.scenario) {
    filters.push(
      inArray(
        t.id,
        sql`(SELECT tcs.test_case_id FROM ${schema.testCaseScenarios} tcs
              WHERE tcs.scenario_id IN (${sql.join(
                query.scenario.map((id) => sql`${id}`),
                sql`, `,
              )}))`,
      ),
    );
  }
  if (query.tag) {
    const tags = query.tag;
    filters.push(
      inArray(
        t.id,
        sql`(SELECT tct.test_case_id FROM ${schema.testCaseTags} tct
              JOIN ${schema.tags} tg ON tg.id = tct.tag_id
             WHERE tg.application_id = ${appId} AND tg.name IN (${sql.join(
               tags.map((tag) => sql`${tag}`),
               sql`, `,
             )})
             GROUP BY tct.test_case_id
            HAVING count(DISTINCT tg.name) = ${tags.length})`,
      ),
    );
  }
  if (query.q) {
    const number = parseTestCaseKey(query.q, appKey);
    const text = sql`${t.searchText} LIKE ${likeContains(foldForSearch(query.q))}`;
    filters.push(number === null ? text : or(text, eq(t.number, number)));
  }
  return and(...filters)!;
}

function listOrder(query: TestCaseListQuery, appKey: string): SQL[] {
  const t = schema.testCases;
  const descending = query.sort.startsWith('-');
  const field = query.sort.replace(/^-/, '');
  const dir = (expr: SQL | typeof t.number) => (descending ? desc(expr) : asc(expr));
  const order: SQL[] = [];
  const number = query.q ? parseTestCaseKey(query.q, appKey) : null;
  if (number !== null) order.push(sql`(${t.number} = ${number}) DESC`);
  switch (field) {
    case 'title':
      order.push(dir(sql`lower(${t.title})`));
      break;
    case 'status':
      order.push(dir(sql`${t.status}`));
      break;
    case 'priority':
      order.push(dir(sql`${t.priority}`));
      break;
    case 'mode':
      order.push(dir(sql`${t.executionMode}`));
      break;
    case 'updated':
      order.push(dir(sql`${t.updatedAt}`));
      break;
  }
  order.push(dir(t.number));
  return order;
}

export async function listTestCases(
  tx: Transaction,
  app: { id: string; key: string },
  query: TestCaseListQuery,
): Promise<TestCaseListPage> {
  const t = schema.testCases;
  const where = listFilters(app.id, app.key, query);
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(t).where(where);
  const lastPage = Math.max(1, Math.ceil(total / query.size));
  const page = Math.min(query.page, lastPage);
  const rows = await tx
    .select({
      row: t,
      datasetName: schema.datasets.name,
      creatorName: creator.name,
      updaterName: updater.name,
    })
    .from(t)
    .leftJoin(schema.datasets, eq(schema.datasets.id, t.datasetId))
    .leftJoin(creator, eq(creator.id, t.createdBy))
    .leftJoin(updater, eq(updater.id, t.updatedBy))
    .where(where)
    .orderBy(...listOrder(query, app.key))
    .limit(query.size)
    .offset((page - 1) * query.size);
  const ids = rows.map((r) => r.row.id);
  const links = await scenarioLinksOf(tx, app, ids);
  const tags = await tagNamesByCase(tx, ids);
  const last = await lastResults(tx, app, ids);
  const user = (id: string | null, name: string | null): UserRef => ({ id, name: name ?? '' });
  const items = rows.map(({ row, datasetName, creatorName, updaterName }): TestCaseListItem => ({
    id: row.id,
    key: testCaseKey(app, row),
    number: row.number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    executionMode: row.executionMode,
    scenarios: links.get(row.id) ?? [],
    tags: tags.get(row.id) ?? [],
    stepCount: row.steps.length,
    dataset: row.datasetId ? { id: row.datasetId, name: datasetName ?? '' } : null,
    lastResult: last.get(row.id) ?? null,
    author: user(row.createdBy, creatorName),
    createdAt: row.createdAt.toISOString(),
    updatedBy: user(row.updatedBy, updaterName),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  }));
  return { items, total, page, size: query.size };
}

/** Number of live test cases linked to each scenario. */
export async function testCaseCounts(
  tx: Transaction,
  scenarioIds: string[],
): Promise<Map<string, number>> {
  if (scenarioIds.length === 0) return new Map();
  const rows = await tx
    .select({ scenarioId: schema.testCaseScenarios.scenarioId, n: count() })
    .from(schema.testCaseScenarios)
    .innerJoin(schema.testCases, eq(schema.testCases.id, schema.testCaseScenarios.testCaseId))
    .where(
      and(
        inArray(schema.testCaseScenarios.scenarioId, scenarioIds),
        isNull(schema.testCases.deletedAt),
      ),
    )
    .groupBy(schema.testCaseScenarios.scenarioId);
  return new Map(rows.map((row) => [row.scenarioId, row.n]));
}

// ---------------------------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------------------------

export async function versionSummaries(
  tx: Transaction,
  testCaseId: string,
): Promise<TestCaseVersionSummary[]> {
  const rows = await tx
    .select()
    .from(schema.testCaseVersions)
    .where(eq(schema.testCaseVersions.testCaseId, testCaseId))
    .orderBy(desc(schema.testCaseVersions.number));
  const names = await userNames(
    tx,
    rows.map((row) => row.authorId),
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    author: userRef(names, row.authorId, row.authorLabel),
    createdAt: row.createdAt.toISOString(),
    source: row.source,
    changedFields: row.changedFields as TestCaseField[],
    restoredFrom: row.restoredFrom,
  }));
}

export async function findVersion(
  tx: Transaction,
  testCaseId: string,
  number: number,
): Promise<TestCaseVersionRow> {
  if (!Number.isInteger(number) || number < 1) throw notFound();
  const [row] = await tx
    .select()
    .from(schema.testCaseVersions)
    .where(
      and(
        eq(schema.testCaseVersions.testCaseId, testCaseId),
        eq(schema.testCaseVersions.number, number),
      ),
    );
  if (!row) throw notFound();
  return row;
}

export async function versionView(
  tx: Transaction,
  app: RequestApp,
  testCase: TestCaseRow,
  row: TestCaseVersionRow,
): Promise<TestCaseVersion> {
  const links = await scenarioLinksById(tx, app, row.scenarioIds);
  const tags = row.tagIds.length
    ? await tx
        .select({ name: schema.tags.name })
        .from(schema.tags)
        .where(inArray(schema.tags.id, row.tagIds))
        .orderBy(asc(schema.tags.name))
    : [];
  const names = await userNames(tx, [row.authorId]);
  return {
    id: row.id,
    number: row.number,
    testCaseKey: testCaseKey(app, testCase),
    latest: testCase.currentVersion,
    author: userRef(names, row.authorId, row.authorLabel),
    createdAt: row.createdAt.toISOString(),
    source: row.source,
    changedFields: row.changedFields as TestCaseField[],
    restoredFrom: row.restoredFrom,
    title: row.title,
    status: row.status,
    priority: row.priority,
    executionMode: row.executionMode,
    scenarios: [...links.values()],
    tags: tags.map((tag) => tag.name),
    dataset: await datasetRef(tx, row.datasetId),
    description: row.descriptionMd,
    preconditions: row.preconditionsMd,
    steps: row.steps,
  };
}
