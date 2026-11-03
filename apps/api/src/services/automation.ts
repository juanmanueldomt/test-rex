// Automation settings, global steps, dataset snapshots and generated Playwright code.
import {
  DEFAULT_AUTOMATION_SETTINGS,
  HOOK_PHASES,
  playwrightSpec,
  type AutomationSettings,
  type AutomationSettingsView,
  type DatasetSnapshot,
  type GlobalStep,
  type HookSnapshot,
  type SpecTestCase,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { userNames, userRef } from './scenarios';
import { testCaseKey, type TestCaseRow } from './test-cases';

export type GlobalStepRow = typeof schema.globalSteps.$inferSelect;

export async function automationSettingsOf(
  tx: Transaction,
  applicationId: string,
): Promise<AutomationSettingsView> {
  const [row] = await tx
    .select()
    .from(schema.automationSettings)
    .where(eq(schema.automationSettings.applicationId, applicationId));
  if (!row) return { ...DEFAULT_AUTOMATION_SETTINGS, updatedBy: null, updatedAt: null };
  const names = await userNames(tx, [row.updatedBy]);
  return {
    baseUrl: row.baseUrl,
    browser: row.browser,
    viewportWidth: row.viewportWidth,
    viewportHeight: row.viewportHeight,
    actionTimeoutMs: row.actionTimeoutMs,
    navigationTimeoutMs: row.navigationTimeoutMs,
    assertionTimeoutMs: row.assertionTimeoutMs,
    traceOnFailure: row.traceOnFailure,
    videoOnFailure: row.videoOnFailure,
    updatedBy: userRef(names, row.updatedBy),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Plain settings (without who changed them), as runs store them. */
export function settingsSnapshot(view: AutomationSettingsView): AutomationSettings {
  return {
    baseUrl: view.baseUrl,
    browser: view.browser,
    viewportWidth: view.viewportWidth,
    viewportHeight: view.viewportHeight,
    actionTimeoutMs: view.actionTimeoutMs,
    navigationTimeoutMs: view.navigationTimeoutMs,
    assertionTimeoutMs: view.assertionTimeoutMs,
    traceOnFailure: view.traceOnFailure,
    videoOnFailure: view.videoOnFailure,
  };
}

const PHASE_ORDER = new Map(HOOK_PHASES.map((phase, index) => [phase, index]));

export function sortGlobalSteps<
  T extends { phase: GlobalStepRow['phase']; position: number; createdAt?: Date },
>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      PHASE_ORDER.get(a.phase)! - PHASE_ORDER.get(b.phase)! ||
      a.position - b.position ||
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0),
  );
}

export async function globalStepRows(tx: Transaction, applicationId: string) {
  const rows = await tx
    .select()
    .from(schema.globalSteps)
    .where(eq(schema.globalSteps.applicationId, applicationId))
    .orderBy(asc(schema.globalSteps.position), asc(schema.globalSteps.createdAt));
  return sortGlobalSteps(rows);
}

export async function globalStepViews(
  tx: Transaction,
  applicationId: string,
): Promise<GlobalStep[]> {
  const rows = await globalStepRows(tx, applicationId);
  const names = await userNames(
    tx,
    rows.map((row) => row.updatedBy),
  );
  return rows.map((row) => globalStepView(row, names));
}

export function globalStepView(row: GlobalStepRow, names: Map<string, string>): GlobalStep {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase,
    enabled: row.enabled,
    position: row.position,
    steps: row.steps,
    updatedBy: userRef(names, row.updatedBy),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Enabled global steps in execution order, as a run keeps them. */
export async function enabledHooks(
  tx: Transaction,
  applicationId: string,
): Promise<HookSnapshot[]> {
  const rows = await globalStepRows(tx, applicationId);
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({ id: row.id, name: row.name, phase: row.phase, steps: row.steps }));
}

/** Current columns and rows of a dataset (also of a deleted one: versions may still use it). */
export async function datasetSnapshots(
  tx: Transaction,
  datasetIds: (string | null)[],
): Promise<Map<string, DatasetSnapshot>> {
  const ids = [...new Set(datasetIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({
      id: schema.datasets.id,
      name: schema.datasets.name,
      columns: schema.datasets.columns,
      rows: schema.datasets.rows,
    })
    .from(schema.datasets)
    .where(inArray(schema.datasets.id, ids));
  return new Map(rows.map((row) => [row.id, row]));
}

async function tagNamesOf(tx: Transaction, testCaseIds: string[]) {
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

/** A spec file for some test cases of an application, with its settings and global steps. */
export async function playwrightCodeFor(
  tx: Transaction,
  app: { id: string; key: string },
  testCases: TestCaseRow[],
  options: { heading: string; groupTitle: string | null },
): Promise<string> {
  const settings = await automationSettingsOf(tx, app.id);
  const hooks = await enabledHooks(tx, app.id);
  const datasets = await datasetSnapshots(
    tx,
    testCases.map((row) => row.datasetId),
  );
  const tags = await tagNamesOf(
    tx,
    testCases.map((row) => row.id),
  );
  const specCases: SpecTestCase[] = testCases.map((row) => ({
    key: testCaseKey(app, row),
    title: row.title,
    executionMode: row.executionMode,
    tags: tags.get(row.id) ?? [],
    steps: row.steps,
    dataset: row.datasetId ? (datasets.get(row.datasetId) ?? null) : null,
  }));
  return playwrightSpec({
    heading: options.heading,
    settings,
    hooks,
    groups: [{ title: options.groupTitle, testCases: specCases }],
  });
}

/** Live test cases linked to a scenario, in key order. */
export async function testCasesOfScenario(
  tx: Transaction,
  applicationId: string,
  scenarioId: string,
): Promise<TestCaseRow[]> {
  const rows = await tx
    .select({ row: schema.testCases })
    .from(schema.testCases)
    .innerJoin(
      schema.testCaseScenarios,
      eq(schema.testCaseScenarios.testCaseId, schema.testCases.id),
    )
    .where(
      and(
        eq(schema.testCases.applicationId, applicationId),
        eq(schema.testCaseScenarios.scenarioId, scenarioId),
      ),
    )
    .orderBy(asc(schema.testCases.number));
  return rows.map((r) => r.row).filter((row) => !row.deletedAt);
}
