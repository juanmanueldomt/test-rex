// Test cases: keys, field rules, request schemas and response types shared by API and web.
// Validation messages are i18n keys (see apps/web/src/locales).
import { z } from 'zod';
import { APP_KEY_PATTERN } from './identifiers';
import {
  csvParam,
  optionalTextParam,
  RICH_TEXT_MAX,
  SCENARIO_PRIORITIES,
  SCENARIO_STATUSES,
  SCENARIO_TAGS_MAX,
  tagSchema,
  type ScenarioPriority,
  type ScenarioStatus,
  type UserRef,
} from './scenarios';
import { manualStepIssues, stepsSchema, type StepAction, type TestStep } from './steps';

export const EXECUTION_MODES = ['automated', 'manual'] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];

/** Test cases share the scenario statuses and priorities. */
export const TEST_CASE_STATUSES = SCENARIO_STATUSES;
export type TestCaseStatus = ScenarioStatus;
export const TEST_CASE_PRIORITIES = SCENARIO_PRIORITIES;
export type TestCasePriority = ScenarioPriority;

/** How a version came to be. */
export const VERSION_SOURCES = ['editor', 'ai', 'recording', 'restore'] as const;
export type VersionSource = (typeof VERSION_SOURCES)[number];

export const TEST_CASE_TITLE_MAX = 200;
export const TEST_CASE_SCENARIOS_MAX = 20;
export const TEST_CASE_PAGE_SIZES = [25, 50, 100] as const;

/** Fields captured by every version. */
export const TEST_CASE_VERSION_FIELDS = [
  'title',
  'status',
  'priority',
  'executionMode',
  'scenarios',
  'tags',
  'dataset',
  'description',
  'preconditions',
  'steps',
] as const;
export type TestCaseField = (typeof TEST_CASE_VERSION_FIELDS)[number];
/** Recorded in audit entries as "changed" with version numbers instead of their content. */
export const TEST_CASE_LARGE_FIELDS: readonly TestCaseField[] = [
  'description',
  'preconditions',
  'steps',
];

// ---------------------------------------------------------------------------------------------
// Keys (`CHK-TC-12`, `CHK-TR-3`)
// ---------------------------------------------------------------------------------------------

export const TEST_CASE_KEY_KIND = 'TC';
export const RUN_KEY_KIND = 'TR';

export function formatItemKey(appKey: string, kind: string, number: number): string {
  return `${appKey}-${kind}-${number}`;
}

const MAX_KEY_NUMBER = 2_147_483_647;

/**
 * Reads the number of a key of the given kind (`CHK-TC-12`, any case) or a bare number. When
 * `appKey` is given, a full key must belong to that application.
 */
export function parseItemKey(text: string, kind: string, appKey?: string): number | null {
  const value = text.trim().toUpperCase();
  let digits: string | undefined;
  if (/^\d+$/.test(value)) {
    digits = value;
  } else {
    const match = new RegExp(`^([A-Z][A-Z0-9]*)-${kind}-(\\d+)$`).exec(value);
    if (!match || !APP_KEY_PATTERN.test(match[1]!)) return null;
    if (appKey && match[1] !== appKey.toUpperCase()) return null;
    digits = match[2];
  }
  const number = Number(digits);
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_KEY_NUMBER ? number : null;
}

export const formatTestCaseKey = (appKey: string, number: number) =>
  formatItemKey(appKey, TEST_CASE_KEY_KIND, number);
export const parseTestCaseKey = (text: string, appKey?: string) =>
  parseItemKey(text, TEST_CASE_KEY_KIND, appKey);
export const formatRunKey = (appKey: string, number: number) =>
  formatItemKey(appKey, RUN_KEY_KIND, number);
export const parseRunKey = (text: string, appKey?: string) =>
  parseItemKey(text, RUN_KEY_KIND, appKey);

// ---------------------------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------------------------

const scenarioIdsSchema = z
  .array(z.uuid())
  .transform((ids) => [...new Set(ids)])
  .refine((ids) => ids.length >= 1, 'scenarios.required')
  .refine((ids) => ids.length <= TEST_CASE_SCENARIOS_MAX, 'scenarios.tooMany');

const fieldSchemas = {
  title: z.string().trim().min(1, 'title.required').max(TEST_CASE_TITLE_MAX, 'title.tooLong'),
  status: z.enum(TEST_CASE_STATUSES),
  priority: z.enum(TEST_CASE_PRIORITIES),
  executionMode: z.enum(EXECUTION_MODES),
  scenarioIds: scenarioIdsSchema,
  tags: z
    .array(tagSchema)
    .transform((tags) => [...new Set(tags)])
    .refine((tags) => tags.length <= SCENARIO_TAGS_MAX, 'tags.tooMany'),
  datasetId: z.uuid().nullable(),
  description: z.string().max(RICH_TEXT_MAX, 'richText.tooLong'),
  preconditions: z.string().max(RICH_TEXT_MAX, 'richText.tooLong'),
  steps: stepsSchema,
};

/** Saves made by people pass `editor`; AI proposals and recordings say where they came from. */
const sourceSchema = z.enum(['editor', 'ai', 'recording']);

/** Automated test cases may only hold steps the engine can execute. */
export function modeIssues(
  executionMode: ExecutionMode,
  steps: { action: StepAction }[],
): { path: (string | number)[]; message: string }[] {
  return executionMode === 'automated' ? manualStepIssues(steps) : [];
}

export const createTestCaseSchema = z
  .object({
    title: fieldSchemas.title,
    status: fieldSchemas.status.default('draft'),
    priority: fieldSchemas.priority.default('medium'),
    executionMode: fieldSchemas.executionMode.default('automated'),
    scenarioIds: fieldSchemas.scenarioIds,
    tags: fieldSchemas.tags.default([]),
    datasetId: fieldSchemas.datasetId.default(null),
    description: fieldSchemas.description.default(''),
    preconditions: fieldSchemas.preconditions.default(''),
    steps: fieldSchemas.steps.default([]),
    source: sourceSchema.default('editor'),
  })
  .superRefine((value, ctx) => {
    for (const issue of modeIssues(value.executionMode, value.steps)) {
      ctx.addIssue({ code: 'custom', ...issue });
    }
  });
export type CreateTestCaseInput = z.infer<typeof createTestCaseSchema>;

/**
 * Only the fields present change. `baseVersion` is the version the editor started from; the
 * save is rejected when the test case has moved on since. The mode rule is checked by the API
 * on the merged state (see {@link modeIssues}).
 */
export const updateTestCaseSchema = z.object({
  baseVersion: z.number().int().min(1),
  title: fieldSchemas.title.optional(),
  status: fieldSchemas.status.optional(),
  priority: fieldSchemas.priority.optional(),
  executionMode: fieldSchemas.executionMode.optional(),
  scenarioIds: fieldSchemas.scenarioIds.optional(),
  tags: fieldSchemas.tags.optional(),
  datasetId: fieldSchemas.datasetId.optional(),
  description: fieldSchemas.description.optional(),
  preconditions: fieldSchemas.preconditions.optional(),
  steps: fieldSchemas.steps.optional(),
  source: sourceSchema.default('editor'),
});
export type UpdateTestCaseInput = z.infer<typeof updateTestCaseSchema>;

export const restoreVersionSchema = z.object({ baseVersion: z.number().int().min(1) });

// ---------------------------------------------------------------------------------------------
// List query (shared by the API and the web URL)
// ---------------------------------------------------------------------------------------------

export const TEST_CASE_SORT_FIELDS = [
  'key',
  'title',
  'status',
  'priority',
  'mode',
  'updated',
] as const;
export type TestCaseSortField = (typeof TEST_CASE_SORT_FIELDS)[number];
export type TestCaseSort = TestCaseSortField | `-${TestCaseSortField}`;
export const DEFAULT_TEST_CASE_SORT: TestCaseSort = '-key';

export const testCaseListQuerySchema = z.object({
  q: optionalTextParam(200),
  status: csvParam(z.enum(TEST_CASE_STATUSES)),
  priority: csvParam(z.enum(TEST_CASE_PRIORITIES)),
  mode: csvParam(z.enum(EXECUTION_MODES)),
  /** Scenario ids: test cases linked to any of them. */
  scenario: csvParam(z.uuid()),
  /** Test cases must have every listed tag. */
  tag: csvParam(tagSchema),
  deleted: z.preprocess(
    (value) => value === true || value === 'true' || value === '1',
    z.boolean(),
  ),
  sort: z
    .custom<TestCaseSort>(
      (value) =>
        typeof value === 'string' &&
        (TEST_CASE_SORT_FIELDS as readonly string[]).includes(value.replace(/^-/, '')),
      'sort.invalid',
    )
    .default(DEFAULT_TEST_CASE_SORT),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .refine((size) => (TEST_CASE_PAGE_SIZES as readonly number[]).includes(size), 'size.invalid')
    .default(TEST_CASE_PAGE_SIZES[0]),
});
export type TestCaseListQuery = z.infer<typeof testCaseListQuerySchema>;

const TEST_CASE_FILTER_KEYS = [
  'q',
  'status',
  'priority',
  'mode',
  'scenario',
  'tag',
  'deleted',
] as const;

/** Parses untrusted search parameters, dropping invalid ones instead of failing. */
export function parseTestCaseListQueryLenient(raw: Record<string, unknown>): TestCaseListQuery {
  let input = { ...raw };
  for (let attempt = 0; attempt < TEST_CASE_FILTER_KEYS.length + 3; attempt++) {
    const result = testCaseListQuerySchema.safeParse(input);
    if (result.success) return result.data;
    const bad = new Set(result.error.issues.map((issue) => String(issue.path[0])));
    input = Object.fromEntries(Object.entries(input).filter(([key]) => !bad.has(key)));
  }
  return testCaseListQuerySchema.parse({});
}

/** Canonical compact form: defaults omitted, multi-values sorted and comma-joined. */
export function compactTestCaseListQuery(
  query: Partial<TestCaseListQuery>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (query.q) out.q = query.q;
  for (const key of ['status', 'priority', 'mode', 'scenario', 'tag'] as const) {
    const values = query[key];
    if (values && values.length) out[key] = [...values].sort().join(',');
  }
  if (query.deleted) out.deleted = true;
  if (query.sort && query.sort !== DEFAULT_TEST_CASE_SORT) out.sort = query.sort;
  if (query.page && query.page !== 1) out.page = query.page;
  if (query.size && query.size !== TEST_CASE_PAGE_SIZES[0]) out.size = query.size;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function testCaseListQueryString(query: Partial<TestCaseListQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(compactTestCaseListQuery(query))) {
    params.set(key, String(value));
  }
  return params.toString();
}

// ---------------------------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------------------------

export interface ScenarioLink {
  id: string;
  key: string;
  title: string;
  deleted: boolean;
}

export interface DatasetRef {
  id: string;
  name: string;
}

/** Status of the most recent finished execution of a test case. */
export interface LastResult {
  status: 'passed' | 'failed' | 'blocked' | 'skipped';
  runKey: string;
  finishedAt: string;
}

export interface TestCaseListItem {
  id: string;
  key: string;
  number: number;
  title: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  executionMode: ExecutionMode;
  scenarios: ScenarioLink[];
  /** Alphabetical. */
  tags: string[];
  stepCount: number;
  dataset: DatasetRef | null;
  lastResult: LastResult | null;
  author: UserRef;
  createdAt: string;
  updatedBy: UserRef;
  updatedAt: string;
  deletedAt: string | null;
}

export interface TestCaseListPage {
  items: TestCaseListItem[];
  total: number;
  page: number;
  size: number;
}

export interface TestCase extends TestCaseListItem {
  description: string;
  preconditions: string;
  steps: TestStep[];
  /** Current version number (v1, v2, ...). */
  version: number;
  versionId: string;
  deletedBy: UserRef | null;
}

export interface TestCaseVersionSummary {
  id: string;
  number: number;
  author: UserRef;
  createdAt: string;
  source: VersionSource;
  changedFields: TestCaseField[];
  restoredFrom: number | null;
}

export interface TestCaseVersion extends TestCaseVersionSummary {
  testCaseKey: string;
  /** The test case's current version number. */
  latest: number;
  title: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  executionMode: ExecutionMode;
  scenarios: ScenarioLink[];
  tags: string[];
  dataset: DatasetRef | null;
  description: string;
  preconditions: string;
  steps: TestStep[];
}

/** Extra fields of the 409 `TEST_CASE_CHANGED` error. */
export interface TestCaseConflictDetails {
  latestVersion: number;
  changedBy: string;
  changedAt: string;
}

/** A generated `@playwright/test` file. */
export interface PlaywrightCode {
  fileName: string;
  code: string;
}
