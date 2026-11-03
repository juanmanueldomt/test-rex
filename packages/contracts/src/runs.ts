// Test runs: selection, statuses, results per iteration and step, aggregation, report types
// and the JUnit export. Shared by the API, the worker and the web app.
import { z } from 'zod';
import {
  BROWSERS,
  type AutomationSettings,
  type Browser,
  type HookPhase,
  type HookSnapshot,
} from './automation';
import type { DatasetSnapshot } from './datasets';
import { csvParam, optionalTextParam, type UserRef } from './scenarios';
import { describeStep, type TestStep } from './steps';
import { EXECUTION_MODES, type ExecutionMode, type ScenarioLink } from './test-cases';

export const RUN_STATUSES = ['queued', 'running', 'completed', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const RUN_ITEM_STATUSES = [
  'queued',
  'untested',
  'running',
  'passed',
  'failed',
  'blocked',
  'skipped',
] as const;
export type RunItemStatus = (typeof RUN_ITEM_STATUSES)[number];

export const FINAL_ITEM_STATUSES = ['passed', 'failed', 'blocked', 'skipped'] as const;
export type FinalItemStatus = (typeof FINAL_ITEM_STATUSES)[number];

export const STEP_RESULT_STATUSES = ['passed', 'failed', 'blocked', 'skipped', 'untested'] as const;
export type StepResultStatus = (typeof STEP_RESULT_STATUSES)[number];

export const RUN_TITLE_MAX = 200;
export const RUN_PAGE_SIZES = [25, 50, 100] as const;
export const ACTUAL_RESULT_MAX = 2_000;
export const RUN_NOTES_MAX = 5_000;

export function isFinal(status: RunItemStatus): status is FinalItemStatus {
  return (FINAL_ITEM_STATUSES as readonly string[]).includes(status);
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const optionalUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z
    .string()
    .trim()
    .max(2_000, 'url.tooLong')
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'url.httpOnly')
    .optional(),
);

export const createRunSchema = z
  .object({
    title: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().max(RUN_TITLE_MAX, 'title.tooLong').optional(),
    ),
    scenarioIds: z
      .array(z.uuid())
      .max(200)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    testCaseIds: z
      .array(z.uuid())
      .max(1_000)
      .default([])
      .transform((ids) => [...new Set(ids)]),
    modes: z
      .array(z.enum(EXECUTION_MODES))
      .min(1, 'run.modesRequired')
      .default(['automated', 'manual']),
    baseUrl: optionalUrl,
    browser: z.enum(BROWSERS).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scenarioIds.length + value.testCaseIds.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['scenarioIds'], message: 'run.selectionRequired' });
    }
  });
export type CreateRunInput = z.infer<typeof createRunSchema>;

export const rerunSchema = z.object({ scope: z.enum(['all', 'failed']).default('all') });

const stepResultInput = z.object({
  stepId: z.string().min(1).max(40),
  status: z.enum(STEP_RESULT_STATUSES),
  actual: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(ACTUAL_RESULT_MAX, 'run.actualTooLong').optional(),
  ),
});

/** A tester's result for a manual item: per iteration, per step, plus the item's notes. */
export const manualResultSchema = z.object({
  iterations: z
    .array(
      z.object({
        index: z.number().int().min(0).max(1_000),
        status: z.enum(FINAL_ITEM_STATUSES),
        steps: z.array(stepResultInput).max(400).default([]),
      }),
    )
    .min(1)
    .max(500),
  notes: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().max(RUN_NOTES_MAX, 'run.notesTooLong').optional(),
  ),
});
export type ManualResultInput = z.infer<typeof manualResultSchema>;

export const RUN_SORT_FIELDS = ['key', 'title', 'status', 'created'] as const;
export type RunSortField = (typeof RUN_SORT_FIELDS)[number];
export type RunSort = RunSortField | `-${RunSortField}`;

export const runListQuerySchema = z.object({
  q: optionalTextParam(200),
  status: csvParam(z.enum(RUN_STATUSES)),
  sort: z
    .custom<RunSort>(
      (value) =>
        typeof value === 'string' &&
        (RUN_SORT_FIELDS as readonly string[]).includes(value.replace(/^-/, '')),
      'sort.invalid',
    )
    .default('-key'),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .refine((size) => (RUN_PAGE_SIZES as readonly number[]).includes(size), 'size.invalid')
    .default(RUN_PAGE_SIZES[0]),
});
export type RunListQuery = z.infer<typeof runListQuerySchema>;

/** Parses untrusted search parameters, dropping invalid ones instead of failing. */
export function parseRunListQueryLenient(raw: Record<string, unknown>): RunListQuery {
  let input = { ...raw };
  for (let attempt = 0; attempt < 6; attempt++) {
    const result = runListQuerySchema.safeParse(input);
    if (result.success) return result.data;
    const bad = new Set(result.error.issues.map((issue) => String(issue.path[0])));
    input = Object.fromEntries(Object.entries(input).filter(([key]) => !bad.has(key)));
  }
  return runListQuerySchema.parse({});
}

/** Canonical compact form: defaults omitted (URLs, requests and cache keys). */
export function compactRunListQuery(
  query: Partial<RunListQuery>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (query.q) out.q = query.q;
  if (query.status?.length) out.status = [...query.status].sort().join(',');
  if (query.sort && query.sort !== '-key') out.sort = query.sort;
  if (query.page && query.page !== 1) out.page = query.page;
  if (query.size && query.size !== RUN_PAGE_SIZES[0]) out.size = query.size;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export const REPORT_PERIODS = [7, 30, 90] as const;
export const reportQuerySchema = z.object({
  days: z.coerce
    .number()
    .refine((days) => (REPORT_PERIODS as readonly number[]).includes(days), 'period.invalid')
    .default(30),
});

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

export interface StepResult {
  stepId: string;
  status: StepResultStatus;
  durationMs?: number;
  /** Failure message (automated) or the reason a step was not run. */
  error?: string;
  /** What a tester observed (manual). */
  actual?: string;
}

/** A global step executed around one iteration (before/after each). */
export interface HookResult {
  hookId: string;
  name: string;
  phase: HookPhase;
  status: StepResultStatus;
  durationMs: number;
  steps: StepResult[];
  error?: string;
}

export type ArtifactKind = 'screenshot' | 'trace' | 'video';

export interface ArtifactRef {
  id: string;
  kind: ArtifactKind;
  contentType: string;
  sizeBytes: number;
  /** Download URL (same origin, requires a session). */
  url: string;
}

export interface IterationResult {
  index: number;
  /** Dataset row values, or null without dataset. */
  data: Record<string, string> | null;
  status: RunItemStatus;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  steps: StepResult[];
  hooks: HookResult[];
  /** Why the iteration did not pass. */
  error?: { message: string; stepId?: string; hookId?: string };
  /** Page state when it failed (automated). */
  url?: string;
  ariaSnapshot?: string;
  consoleErrors?: string[];
  artifacts?: ArtifactRef[];
}

export type RunCounts = Record<RunItemStatus, number> & { total: number };

export function emptyCounts(): RunCounts {
  return {
    total: 0,
    queued: 0,
    untested: 0,
    running: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
  };
}

export function countStatuses(statuses: RunItemStatus[]): RunCounts {
  const counts = emptyCounts();
  for (const status of statuses) {
    counts[status]++;
    counts.total++;
  }
  return counts;
}

/** Passed ÷ executed (passed + failed + blocked); null when nothing was executed. */
export function passRate(counts: Pick<RunCounts, 'passed' | 'failed' | 'blocked'>): number | null {
  const executed = counts.passed + counts.failed + counts.blocked;
  return executed === 0 ? null : counts.passed / executed;
}

/**
 * The result of several iterations (or steps): any failure fails it, then any blocked one
 * blocks it, unfinished ones keep it open, all skipped skips it, otherwise it passed.
 */
export function aggregateStatus(statuses: RunItemStatus[]): RunItemStatus {
  if (statuses.length === 0) return 'skipped';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('running')) return 'running';
  if (statuses.includes('queued')) return 'queued';
  if (statuses.includes('untested')) return 'untested';
  if (statuses.every((status) => status === 'skipped')) return 'skipped';
  return 'passed';
}

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export interface RunSummary {
  id: string;
  key: string;
  number: number;
  title: string;
  status: RunStatus;
  baseUrl: string | null;
  browser: Browser;
  counts: RunCounts;
  passRate: number | null;
  /** Wall time from start to finish (or until now while running). */
  durationMs: number | null;
  createdBy: UserRef;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  hasAutomated: boolean;
  hasManual: boolean;
}

export interface RunListPage {
  items: RunSummary[];
  total: number;
  page: number;
  size: number;
}

export interface RunItemSummary {
  id: string;
  position: number;
  testCase: { id: string; key: string; deleted: boolean };
  title: string;
  version: number;
  executionMode: ExecutionMode;
  scenarios: ScenarioLink[];
  status: RunItemStatus;
  iterationCount: number;
  durationMs: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** First failure, for the list. */
  error: string | null;
  failedStep: { id: string; index: number; text: string } | null;
  executedBy: UserRef | null;
}

export interface RunItemDetail extends RunItemSummary {
  steps: TestStep[];
  dataset: DatasetSnapshot | null;
  iterations: IterationResult[];
  notes: string | null;
}

export interface RunHookResult extends HookResult {
  /** Before or after the whole run. */
  scope: 'run';
}

export interface ScenarioBreakdown {
  scenario: ScenarioLink;
  counts: RunCounts;
  passRate: number | null;
}

export interface Run extends RunSummary {
  settings: AutomationSettings;
  hooks: HookSnapshot[];
  hookResults: RunHookResult[];
  items: RunItemSummary[];
  scenarios: ScenarioBreakdown[];
  cancelledBy: UserRef | null;
  /** Message of a failure that stopped the worker (e.g. the browser could not start). */
  error: string | null;
}

export interface RunReport extends Omit<Run, 'items'> {
  generatedAt: string;
  items: RunItemDetail[];
}

// ---------------------------------------------------------------------------------------------
// Global report
// ---------------------------------------------------------------------------------------------

export interface TrendPoint {
  runKey: string;
  title: string;
  createdAt: string;
  status: RunStatus;
  counts: RunCounts;
  passRate: number | null;
  durationMs: number | null;
}

export interface TestCaseHealth {
  testCase: { id: string; key: string; title: string };
  executions: number;
  failures: number;
  passes: number;
  failureRate: number;
  lastFailure: { runKey: string; at: string } | null;
  averageDurationMs: number | null;
}

export interface ScenarioHealth {
  scenario: ScenarioLink;
  executed: number;
  passed: number;
  passRate: number | null;
}

export interface GlobalReport {
  days: number;
  from: string;
  to: string;
  runs: number;
  runsByStatus: Record<RunStatus, number>;
  counts: RunCounts;
  passRate: number | null;
  averageDurationMs: number | null;
  trend: TrendPoint[];
  mostFailing: TestCaseHealth[];
  flaky: TestCaseHealth[];
  slowest: TestCaseHealth[];
  scenarios: ScenarioHealth[];
}

// ---------------------------------------------------------------------------------------------
// JUnit XML
// ---------------------------------------------------------------------------------------------

function xml(text: string): string {
  return (
    text
      // Characters XML 1.0 cannot carry at all.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  );
}

const seconds = (ms: number | null) => ((ms ?? 0) / 1000).toFixed(3);

/** One `<testcase>` per item; failed/blocked items carry a `<failure>`, skipped a `<skipped>`. */
export function junitXml(report: RunReport): string {
  const items = report.items;
  const failures = items.filter((item) => item.status === 'failed' || item.status === 'blocked');
  const skipped = items.filter((item) => !['passed', 'failed', 'blocked'].includes(item.status));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="${xml(report.key)}" tests="${items.length}" failures="${failures.length}" skipped="${skipped.length}" time="${seconds(report.durationMs)}">`,
    `  <testsuite name="${xml(`${report.key} · ${report.title}`)}" tests="${items.length}" failures="${failures.length}" errors="0" skipped="${skipped.length}" time="${seconds(report.durationMs)}" timestamp="${xml(report.startedAt ?? report.createdAt)}">`,
  ];
  for (const item of items) {
    const classname = item.scenarios.map((s) => s.key).join(', ') || report.key;
    lines.push(
      `    <testcase classname="${xml(classname)}" name="${xml(`${item.testCase.key} · ${item.title}`)}" time="${seconds(item.durationMs)}">`,
    );
    if (item.status === 'failed' || item.status === 'blocked') {
      const details = item.iterations
        .filter((iteration) => iteration.status === 'failed' || iteration.status === 'blocked')
        .map((iteration) => {
          const step = item.steps.find((s) => s.id === iteration.error?.stepId);
          const where = step ? `Step: ${describeStep(step)}\n` : '';
          const data = iteration.data ? `Data: ${JSON.stringify(iteration.data)}\n` : '';
          return `Iteration ${iteration.index + 1}\n${data}${where}${iteration.error?.message ?? ''}`;
        })
        .join('\n\n');
      const type = item.status === 'blocked' ? 'blocked' : 'failure';
      lines.push(
        `      <failure message="${xml(item.error ?? item.status)}" type="${type}">${xml(details || item.notes || '')}</failure>`,
      );
    } else if (item.status !== 'passed') {
      lines.push(`      <skipped message="${xml(item.status)}"/>`);
    }
    if (item.notes) lines.push(`      <system-out>${xml(item.notes)}</system-out>`);
    lines.push('    </testcase>');
  }
  lines.push('  </testsuite>', '</testsuites>', '');
  return lines.join('\n');
}
