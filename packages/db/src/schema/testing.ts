// Test cases, datasets, automation (settings, global steps), test runs, recordings and the
// organization's LLM settings. All tenant tables: RLS policies are created in the same
// migration as the tables (0005_test_cases_and_runs).
import type {
  AutomationSettings,
  DatasetSnapshot,
  HookSnapshot,
  IterationResult,
  RecordedElement,
  RecordingCommand,
  RunHookResult,
  TestStep,
} from '@testrex/contracts';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { newId } from './ids';
import { scenarioPriority, scenarios, scenarioStatus, tags } from './scenarios';
import { applications, organizations } from './tenancy';

export const executionMode = pgEnum('execution_mode', ['automated', 'manual']);
export const versionSource = pgEnum('version_source', ['editor', 'ai', 'recording', 'restore']);
export const browserName = pgEnum('browser_name', ['chromium', 'firefox', 'webkit']);
export const hookPhase = pgEnum('hook_phase', ['beforeRun', 'beforeEach', 'afterEach', 'afterRun']);
export const runStatus = pgEnum('run_status', ['queued', 'running', 'completed', 'cancelled']);
export const runItemStatus = pgEnum('run_item_status', [
  'queued',
  'untested',
  'running',
  'passed',
  'failed',
  'blocked',
  'skipped',
]);
export const artifactKind = pgEnum('artifact_kind', ['screenshot', 'trace', 'video']);
export const recordingStatus = pgEnum('recording_status', [
  'starting',
  'active',
  'stopped',
  'expired',
  'failed',
]);
export const llmProvider = pgEnum('llm_provider', ['anthropic', 'openai_compatible']);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

const organizationId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });
const applicationId = () =>
  uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const at = (name: string) => timestamp(name, { withTimezone: true });

/** Named columns and rows that drive test cases (one iteration per row). Soft-deleted. */
export const datasets = pgTable(
  'datasets',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    columns: text('columns').array().notNull(),
    rows: jsonb('rows')
      .$type<string[][]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
    deletedAt: at('deleted_at'),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    uniqueIndex('datasets_app_name_key')
      .on(t.applicationId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check('datasets_name_length', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
    check('datasets_rows_array', sql`jsonb_typeof(${t.rows}) = 'array'`),
  ],
);

/**
 * Current state of each test case (denormalized for the catalog). Every change also writes an
 * immutable row in `test_case_versions`; runs pin those.
 */
export const testCases = pgTable(
  'test_cases',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    /** The `12` of `CHK-TC-12`. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    status: scenarioStatus('status').notNull().default('draft'),
    priority: scenarioPriority('priority').notNull().default('medium'),
    executionMode: executionMode('execution_mode').notNull().default('automated'),
    descriptionMd: text('description_md').notNull().default(''),
    preconditionsMd: text('preconditions_md').notNull().default(''),
    steps: jsonb('steps')
      .$type<TestStep[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    datasetId: uuid('dataset_id').references(() => datasets.id, { onDelete: 'restrict' }),
    /** Folded title, rich text and step texts. */
    searchText: text('search_text').notNull().default(''),
    currentVersion: integer('current_version').notNull(),
    currentVersionId: uuid('current_version_id').notNull(),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
    deletedAt: at('deleted_at'),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    unique('test_cases_app_number_key').on(t.applicationId, t.number),
    index('test_cases_app_updated_idx').on(t.applicationId, t.updatedAt),
    index('test_cases_dataset_idx').on(t.datasetId),
    index('test_cases_search_text_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    check('test_cases_number_positive', sql`${t.number} > 0`),
    check('test_cases_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    check('test_cases_steps_array', sql`jsonb_typeof(${t.steps}) = 'array'`),
  ],
);

/** Which scenarios each test case verifies (many-to-many). */
export const testCaseScenarios = pgTable(
  'test_case_scenarios',
  {
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
  },
  (t) => [
    primaryKey({ name: 'test_case_scenarios_pkey', columns: [t.testCaseId, t.scenarioId] }),
    index('test_case_scenarios_scenario_idx').on(t.scenarioId),
  ],
);

/** Current tags of each test case (shared `tags` of the application). */
export const testCaseTags = pgTable(
  'test_case_tags',
  {
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
  },
  (t) => [
    primaryKey({ name: 'test_case_tags_pkey', columns: [t.testCaseId, t.tagId] }),
    index('test_case_tags_tag_idx').on(t.tagId),
  ],
);

/**
 * Immutable full snapshots of a test case, one per save (v1, v2, ...). Append-only: the runtime
 * database role has no UPDATE or DELETE grant. Run items reference `id`.
 */
export const testCaseVersions = pgTable(
  'test_case_versions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    status: scenarioStatus('status').notNull(),
    priority: scenarioPriority('priority').notNull(),
    executionMode: executionMode('execution_mode').notNull(),
    descriptionMd: text('description_md').notNull(),
    preconditionsMd: text('preconditions_md').notNull(),
    steps: jsonb('steps').$type<TestStep[]>().notNull(),
    datasetId: uuid('dataset_id').references(() => datasets.id, { onDelete: 'restrict' }),
    scenarioIds: uuid('scenario_ids').array().notNull(),
    tagIds: uuid('tag_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    changedFields: text('changed_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    source: versionSource('source').notNull(),
    restoredFrom: integer('restored_from'),
    authorId: userRef('author_id'),
    authorLabel: text('author_label').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('test_case_versions_case_number_key').on(t.testCaseId, t.number),
    check('test_case_versions_number_positive', sql`${t.number} > 0`),
  ],
);

/** How automated steps run in this application (one row per application, created on save). */
export const automationSettings = pgTable(
  'automation_settings',
  {
    applicationId: uuid('application_id')
      .primaryKey()
      .references(() => applications.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
    baseUrl: text('base_url'),
    browser: browserName('browser').notNull().default('chromium'),
    viewportWidth: integer('viewport_width').notNull().default(1280),
    viewportHeight: integer('viewport_height').notNull().default(720),
    actionTimeoutMs: integer('action_timeout_ms').notNull().default(10_000),
    navigationTimeoutMs: integer('navigation_timeout_ms').notNull().default(30_000),
    assertionTimeoutMs: integer('assertion_timeout_ms').notNull().default(5_000),
    traceOnFailure: boolean('trace_on_failure').notNull().default(true),
    videoOnFailure: boolean('video_on_failure').notNull().default(false),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'automation_settings_ranges',
      sql`${t.viewportWidth} BETWEEN 320 AND 3840 AND ${t.viewportHeight} BETWEEN 240 AND 2160
        AND ${t.actionTimeoutMs} > 0 AND ${t.navigationTimeoutMs} > 0 AND ${t.assertionTimeoutMs} > 0`,
    ),
  ],
);

/** Steps that run around every test case or every run (hooks). Runs keep a snapshot. */
export const globalSteps = pgTable(
  'global_steps',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    phase: hookPhase('phase').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    steps: jsonb('steps').$type<TestStep[]>().notNull(),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedBy: userRef('updated_by'),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('global_steps_app_phase_idx').on(t.applicationId, t.phase, t.position),
    check('global_steps_name_length', sql`char_length(${t.name}) BETWEEN 1 AND 80`),
  ],
);

/** One execution of a selection of test cases, with the settings and hooks it used. */
export const testRuns = pgTable(
  'test_runs',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    /** The `3` of `CHK-TR-3`. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    status: runStatus('status').notNull(),
    baseUrl: text('base_url'),
    browser: browserName('browser').notNull(),
    settings: jsonb('settings').$type<AutomationSettings>().notNull(),
    hooks: jsonb('hooks')
      .$type<HookSnapshot[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    hookResults: jsonb('hook_results')
      .$type<RunHookResult[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** A failure that stopped the worker before or between items. */
    error: text('error'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
    cancelledBy: userRef('cancelled_by'),
  },
  (t) => [
    unique('test_runs_app_number_key').on(t.applicationId, t.number),
    index('test_runs_app_created_idx').on(t.applicationId, t.createdAt),
    check('test_runs_number_positive', sql`${t.number} > 0`),
    check('test_runs_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 200`),
  ],
);

/** One test case in a run: the pinned version's content and its results. */
export const testRunItems = pgTable(
  'test_run_items',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    testCaseId: uuid('test_case_id')
      .notNull()
      .references(() => testCases.id, { onDelete: 'cascade' }),
    testCaseVersionId: uuid('test_case_version_id')
      .notNull()
      .references(() => testCaseVersions.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    position: integer('position').notNull(),
    executionMode: executionMode('execution_mode').notNull(),
    title: text('title').notNull(),
    scenarioIds: uuid('scenario_ids').array().notNull(),
    steps: jsonb('steps').$type<TestStep[]>().notNull(),
    dataset: jsonb('dataset').$type<DatasetSnapshot>(),
    status: runItemStatus('status').notNull(),
    iterations: jsonb('iterations')
      .$type<IterationResult[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    error: text('error'),
    failedStepId: text('failed_step_id'),
    durationMs: integer('duration_ms'),
    startedAt: at('started_at'),
    finishedAt: at('finished_at'),
    executedBy: userRef('executed_by'),
    notes: text('notes'),
  },
  (t) => [
    index('test_run_items_run_idx').on(t.runId, t.position),
    index('test_run_items_case_idx').on(t.testCaseId, t.finishedAt),
  ],
);

/** Screenshots, traces and videos of failed iterations. Each row owns one storage object. */
export const runArtifacts = pgTable(
  'run_artifacts',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => testRuns.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => testRunItems.id, { onDelete: 'cascade' }),
    iteration: integer('iteration').notNull().default(0),
    kind: artifactKind('kind').notNull(),
    storageKey: text('storage_key').notNull().unique('run_artifacts_storage_key_key'),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('run_artifacts_item_idx').on(t.itemId)],
);

/** An interactive recording: a browser kept open by the worker and driven from the web app. */
export const recordingSessions = pgTable(
  'recording_sessions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    createdBy: userRef('created_by'),
    status: recordingStatus('status').notNull().default('starting'),
    startUrl: text('start_url').notNull(),
    currentUrl: text('current_url'),
    pageTitle: text('page_title'),
    viewportWidth: integer('viewport_width').notNull(),
    viewportHeight: integer('viewport_height').notNull(),
    steps: jsonb('steps')
      .$type<TestStep[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    element: jsonb('element').$type<RecordedElement>(),
    /** Latest JPEG screenshot of the page. */
    frame: bytea('frame'),
    frameVersion: integer('frame_version').notNull().default(0),
    error: text('error'),
    createdAt: createdAt(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: at('ended_at'),
  },
  (t) => [index('recording_sessions_app_idx').on(t.applicationId, t.createdAt)],
);

/** Input waiting for the worker, consumed in id order. */
export const recordingCommands = pgTable(
  'recording_commands',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    organizationId: organizationId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => recordingSessions.id, { onDelete: 'cascade' }),
    payload: jsonb('payload').$type<RecordingCommand>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('recording_commands_session_idx').on(t.sessionId, t.id)],
);

/** The organization's LLM provider (bring your own key). The key is encrypted by the API. */
export const llmSettings = pgTable('llm_settings', {
  organizationId: uuid('organization_id')
    .primaryKey()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  provider: llmProvider('provider').notNull(),
  model: text('model').notNull(),
  baseUrl: text('base_url'),
  /** `v1:<iv>:<tag>:<ciphertext>` (AES-256-GCM); null for endpoints without a key. */
  apiKeyEncrypted: text('api_key_encrypted'),
  updatedBy: userRef('updated_by'),
  updatedAt: updatedAt(),
});
