// Executes the automated items of a test run: one browser per run, a fresh context per test
// case iteration, global steps around them, and results written item by item in short
// transactions so progress is visible and cancellation is noticed between steps.
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { Logger } from '@testrex/config';
import {
  aggregateStatus,
  formatRunKey,
  rowValues,
  type ArtifactKind,
  type ArtifactRef,
  type AutomationSettings,
  type HookPhase,
  type HookResult,
  type HookSnapshot,
  type IterationResult,
  type RunHookResult,
  type RunItemStatus,
  type StepResult,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import type { StorageAdapter } from '@testrex/storage';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Browser, BrowserContext } from 'playwright-core';
import { cleanError, runSteps, type StepContext } from './engine';

export type InOrg = <T>(fn: (tx: Transaction) => Promise<T>) => Promise<T>;
export type LaunchBrowser = (name: AutomationSettings['browser']) => Promise<Browser>;

export interface ExecutorDeps {
  logger: Logger;
  storage: StorageAdapter;
  launch: LaunchBrowser;
  now?: () => Date;
}

type RunRow = typeof schema.testRuns.$inferSelect;
type ItemRow = typeof schema.testRunItems.$inferSelect;

const ARIA_SNAPSHOT_MAX = 20_000;
const CONSOLE_ERRORS_MAX = 20;
const CANCEL_CHECK_MS = 1_000;

interface RunState {
  run: RunRow;
  /** Launched once per run. */
  browser?: Browser;
  appKey: string;
  organizationId: string;
  settings: AutomationSettings;
  storageState?: Awaited<ReturnType<BrowserContext['storageState']>>;
}

/** Runs one global step in an existing page and reports it like a step list. */
async function runHook(
  context: StepContext,
  hook: HookSnapshot,
  variables: Record<string, string>,
  shouldStop: () => Promise<boolean>,
): Promise<HookResult> {
  const started = Date.now();
  const outcome = await runSteps(context, hook.steps, variables, shouldStop);
  return {
    hookId: hook.id,
    name: hook.name,
    phase: hook.phase,
    status: outcome.failedStepId ? 'failed' : outcome.cancelled ? 'skipped' : 'passed',
    durationMs: Date.now() - started,
    steps: outcome.results,
    ...(outcome.error ? { error: outcome.error } : {}),
  };
}

export async function executeRun(
  deps: ExecutorDeps,
  inOrg: InOrg,
  payload: { organizationId: string; runId: string },
): Promise<{ executed: number }> {
  const now = deps.now ?? (() => new Date());
  const loaded = await inOrg(async (tx) => {
    const [run] = await tx
      .select()
      .from(schema.testRuns)
      .where(eq(schema.testRuns.id, payload.runId));
    if (!run || (run.status !== 'queued' && run.status !== 'running')) return null;
    const [app] = await tx
      .select({ key: schema.applications.key })
      .from(schema.applications)
      .where(eq(schema.applications.id, run.applicationId));
    const items = await tx
      .select()
      .from(schema.testRunItems)
      .where(
        and(
          eq(schema.testRunItems.runId, run.id),
          eq(schema.testRunItems.executionMode, 'automated'),
          inArray(schema.testRunItems.status, ['queued', 'running']),
        ),
      )
      .orderBy(asc(schema.testRunItems.position));
    await tx
      .update(schema.testRuns)
      .set({ status: 'running', startedAt: run.startedAt ?? now() })
      .where(eq(schema.testRuns.id, run.id));
    return { run, appKey: app!.key, items };
  });
  if (!loaded) return { executed: 0 };
  const logger = deps.logger.child({ runId: payload.runId });
  const state: RunState = {
    run: loaded.run,
    appKey: loaded.appKey,
    organizationId: payload.organizationId,
    settings: loaded.run.settings,
  };

  let lastCheck = 0;
  let cancelled = false;
  const shouldStop = async () => {
    if (cancelled) return true;
    if (Date.now() - lastCheck < CANCEL_CHECK_MS) return false;
    lastCheck = Date.now();
    const [row] = await inOrg((tx) =>
      tx
        .select({ status: schema.testRuns.status })
        .from(schema.testRuns)
        .where(eq(schema.testRuns.id, payload.runId)),
    );
    cancelled = row?.status === 'cancelled';
    return cancelled;
  };

  const hookResults: RunHookResult[] = [];
  let runError: string | null = null;
  let executed = 0;
  let browser: Browser | null = null;
  try {
    try {
      browser = await deps.launch(state.settings.browser);
      state.browser = browser;
    } catch (error) {
      runError = `The ${state.settings.browser} browser could not start: ${cleanError(error)}`;
      logger.error({ err: error }, 'browser launch failed');
      await blockItems(inOrg, loaded.items, runError, now);
      return { executed: 0 };
    }

    const hooksOf = (phase: HookPhase) => loaded.run.hooks.filter((hook) => hook.phase === phase);
    const setupFailure = await runRunHooks(
      browser,
      state,
      hooksOf('beforeRun'),
      hookResults,
      shouldStop,
      true,
    );
    if (setupFailure) {
      await blockItems(inOrg, loaded.items, setupFailure, now);
    } else {
      for (const item of loaded.items) {
        if (await shouldStop()) break;
        const started = await inOrg((tx) =>
          tx
            .update(schema.testRunItems)
            .set({ status: 'running', startedAt: now() })
            .where(
              and(
                eq(schema.testRunItems.id, item.id),
                inArray(schema.testRunItems.status, ['queued', 'running']),
              ),
            )
            .returning({ id: schema.testRunItems.id }),
        );
        if (started.length === 0) continue;
        await executeItem(
          deps,
          inOrg,
          state,
          item,
          hooksOf('beforeEach'),
          hooksOf('afterEach'),
          shouldStop,
          now,
        );
        executed++;
      }
    }
    if (!(await shouldStop())) {
      await runRunHooks(browser, state, hooksOf('afterRun'), hookResults, shouldStop, false);
    }
  } finally {
    await browser?.close().catch(() => {});
    await inOrg(async (tx) => {
      await tx
        .update(schema.testRuns)
        .set({ hookResults, ...(runError ? { error: runError } : {}) })
        .where(eq(schema.testRuns.id, payload.runId));
      const open = await tx
        .select({ id: schema.testRunItems.id })
        .from(schema.testRunItems)
        .where(
          and(
            eq(schema.testRunItems.runId, payload.runId),
            inArray(schema.testRunItems.status, ['queued', 'untested', 'running']),
          ),
        )
        .limit(1);
      if (open.length === 0) {
        await tx
          .update(schema.testRuns)
          .set({ status: 'completed', finishedAt: now() })
          .where(and(eq(schema.testRuns.id, payload.runId), eq(schema.testRuns.status, 'running')));
      }
    });
  }
  logger.info({ executed }, 'test run executed');
  return { executed };
}

/** Marks every pending automated item blocked (setup failure, browser problem). */
async function blockItems(inOrg: InOrg, items: ItemRow[], message: string, now: () => Date) {
  if (items.length === 0) return;
  await inOrg((tx) =>
    tx
      .update(schema.testRunItems)
      .set({ status: 'blocked', error: message, finishedAt: now() })
      .where(
        and(
          inArray(
            schema.testRunItems.id,
            items.map((item) => item.id),
          ),
          inArray(schema.testRunItems.status, ['queued', 'running']),
        ),
      ),
  );
}

function contextOptions(state: RunState) {
  const { settings } = state;
  return {
    baseURL: settings.baseUrl ?? undefined,
    viewport: { width: settings.viewportWidth, height: settings.viewportHeight },
    ...(state.storageState ? { storageState: state.storageState } : {}),
  };
}

function prepare(context: BrowserContext, settings: AutomationSettings) {
  context.setDefaultTimeout(settings.actionTimeoutMs);
  context.setDefaultNavigationTimeout(settings.navigationTimeoutMs);
}

/**
 * Before/after-run global steps in a context of their own. Before-run hooks hand their cookies
 * and storage to every test case. Returns an error message when a before-run hook failed.
 */
async function runRunHooks(
  browser: Browser,
  state: RunState,
  hooks: HookSnapshot[],
  results: RunHookResult[],
  shouldStop: () => Promise<boolean>,
  before: boolean,
): Promise<string | null> {
  if (hooks.length === 0) return null;
  const context = await browser.newContext(contextOptions(state));
  prepare(context, state.settings);
  const page = await context.newPage();
  const stepContext: StepContext = {
    page,
    assertionTimeoutMs: state.settings.assertionTimeoutMs,
    baseUrl: state.settings.baseUrl,
  };
  let failure: string | null = null;
  try {
    for (const hook of hooks) {
      if (failure) break;
      const result = await runHook(stepContext, hook, baseVariables(state, 0), shouldStop);
      results.push({ ...result, scope: 'run' });
      if (result.status === 'failed') {
        failure = `Global step "${hook.name}" (${before ? 'before' : 'after'} test run) failed: ${result.error}`;
      }
    }
    if (before && !failure) state.storageState = await context.storageState();
  } finally {
    await context.close().catch(() => {});
  }
  return failure;
}

function baseVariables(state: RunState, index: number): Record<string, string> {
  return {
    baseUrl: state.settings.baseUrl ?? '',
    runKey: formatRunKey(state.appKey, state.run.number),
    iteration: String(index + 1),
    timestamp: String(Date.now()),
    uuid: randomUUID(),
  };
}

async function executeItem(
  deps: ExecutorDeps,
  inOrg: InOrg,
  state: RunState,
  item: ItemRow,
  beforeEach: HookSnapshot[],
  afterEach: HookSnapshot[],
  shouldStop: () => Promise<boolean>,
  now: () => Date,
): Promise<void> {
  const rows: (string[] | null)[] = item.dataset ? item.dataset.rows : [null];
  const iterations: IterationResult[] = [];
  const started = Date.now();
  for (const [index, row] of rows.entries()) {
    if (await shouldStop()) {
      iterations.push(skippedIteration(index, item, row));
      continue;
    }
    iterations.push(
      await executeIteration(
        deps,
        inOrg,
        state,
        item,
        index,
        row,
        beforeEach,
        afterEach,
        shouldStop,
      ),
    );
  }
  const status: RunItemStatus = aggregateStatus(iterations.map((iteration) => iteration.status));
  const failure = iterations.find((iteration) => iteration.error)?.error;
  await inOrg((tx) =>
    tx
      .update(schema.testRunItems)
      .set({
        status,
        iterations,
        durationMs: Date.now() - started,
        error: failure?.message ?? null,
        failedStepId: failure?.stepId ?? null,
        finishedAt: now(),
      })
      .where(and(eq(schema.testRunItems.id, item.id), eq(schema.testRunItems.status, 'running'))),
  );
}

function skippedIteration(index: number, item: ItemRow, row: string[] | null): IterationResult {
  return {
    index,
    data: row && item.dataset ? rowValues(item.dataset.columns, row) : null,
    status: 'skipped',
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    steps: item.steps.map((step) => ({ stepId: step.id, status: 'skipped' })),
    hooks: [],
  };
}

async function executeIteration(
  deps: ExecutorDeps,
  inOrg: InOrg,
  state: RunState,
  item: ItemRow,
  index: number,
  row: string[] | null,
  beforeEach: HookSnapshot[],
  afterEach: HookSnapshot[],
  shouldStop: () => Promise<boolean>,
): Promise<IterationResult> {
  const { settings } = state;
  const data = row && item.dataset ? rowValues(item.dataset.columns, row) : null;
  const variables = { ...baseVariables(state, index), ...(data ?? {}) };
  const startedAt = new Date();
  const videoDir = settings.videoOnFailure ? await mkdtemp(join(tmpdir(), 'testrex-video-')) : null;
  const context = await state.browser!.newContext({
    ...contextOptions(state),
    ...(videoDir
      ? {
          recordVideo: {
            dir: videoDir,
            size: { width: settings.viewportWidth, height: settings.viewportHeight },
          },
        }
      : {}),
  });
  prepare(context, settings);
  if (settings.traceOnFailure) {
    await context.tracing.start({ screenshots: true, snapshots: true });
  }
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const remember = (text: string) => {
    if (consoleErrors.length < CONSOLE_ERRORS_MAX) consoleErrors.push(text.slice(0, 500));
  };
  page.on('console', (message) => {
    if (message.type() === 'error') remember(message.text());
  });
  page.on('pageerror', (error) => remember(error.message));

  const stepContext: StepContext = {
    page,
    assertionTimeoutMs: settings.assertionTimeoutMs,
    baseUrl: settings.baseUrl,
  };
  const hooks: HookResult[] = [];
  let steps: StepResult[];
  let error: IterationResult['error'];
  let cancelled = false;

  for (const hook of beforeEach) {
    const result = await runHook(stepContext, hook, variables, shouldStop);
    hooks.push(result);
    if (result.status !== 'passed') {
      error = {
        message: `Global step "${hook.name}" (before each test case) failed: ${result.error ?? 'cancelled'}`,
        hookId: hook.id,
      };
      break;
    }
  }
  if (error) {
    steps = item.steps.map((step) => ({ stepId: step.id, status: 'skipped' as const }));
  } else {
    const outcome = await runSteps(stepContext, item.steps, variables, shouldStop);
    steps = outcome.results;
    cancelled = outcome.cancelled;
    if (outcome.failedStepId) {
      error = { message: outcome.error ?? 'Step failed', stepId: outcome.failedStepId };
    }
  }
  // After-each steps run even when the test case failed (like Playwright's afterEach).
  for (const hook of afterEach) {
    const result = await runHook(stepContext, hook, variables, shouldStop);
    hooks.push(result);
    if (result.status === 'failed' && !error) {
      error = {
        message: `Global step "${hook.name}" (after each test case) failed: ${result.error}`,
        hookId: hook.id,
      };
    }
  }

  const failed = Boolean(error);
  const iteration: IterationResult = {
    index,
    data,
    status: failed ? 'failed' : cancelled ? 'skipped' : 'passed',
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    durationMs: null,
    steps,
    hooks,
    ...(error ? { error } : {}),
  };
  const artifacts: ArtifactRef[] = [];
  const upload = async (
    kind: ArtifactKind,
    contentType: string,
    body: Readable,
    sizeBytes: number,
  ) => {
    const id = schema.newId();
    const storageKey = `org/${state.organizationId}/runs/${state.run.id}/${id}`;
    await deps.storage.put(storageKey, body, { contentType });
    await inOrg((tx) =>
      tx.insert(schema.runArtifacts).values({
        id,
        organizationId: state.organizationId,
        applicationId: state.run.applicationId,
        runId: state.run.id,
        itemId: item.id,
        iteration: index,
        kind,
        storageKey,
        contentType,
        sizeBytes,
      }),
    );
    artifacts.push({ id, kind, contentType, sizeBytes, url: '' });
  };

  try {
    if (failed) {
      iteration.url = page.url();
      iteration.consoleErrors = consoleErrors;
      const screenshot = await page.screenshot({ type: 'png', timeout: 5_000 }).catch(() => null);
      if (screenshot)
        await upload('screenshot', 'image/png', Readable.from(screenshot), screenshot.length);
      const snapshot = await page
        .locator('body')
        .ariaSnapshot({ timeout: 2_000 })
        .catch(() => null);
      if (snapshot) {
        iteration.ariaSnapshot =
          snapshot.length > ARIA_SNAPSHOT_MAX
            ? `${snapshot.slice(0, ARIA_SNAPSHOT_MAX)}\n…`
            : snapshot;
      }
    }
    if (settings.traceOnFailure) {
      if (failed) {
        const dir = await mkdtemp(join(tmpdir(), 'testrex-trace-'));
        const path = join(dir, 'trace.zip');
        try {
          await context.tracing.stop({ path });
          const { size } = await stat(path);
          await upload('trace', 'application/zip', createReadStream(path), size);
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      } else {
        await context.tracing.stop();
      }
    }
  } catch (caught) {
    deps.logger.warn({ err: caught, itemId: item.id }, 'could not keep failure artifacts');
  } finally {
    const video = page.video();
    await context.close().catch(() => {});
    if (videoDir) {
      try {
        if (failed && video) {
          const path = await video.path();
          const { size } = await stat(path);
          await upload('video', 'video/webm', createReadStream(path), size);
        }
      } catch (caught) {
        deps.logger.warn({ err: caught, itemId: item.id }, 'could not keep the video');
      } finally {
        await rm(videoDir, { recursive: true, force: true });
      }
    }
  }
  if (artifacts.length) iteration.artifacts = artifacts;
  iteration.finishedAt = new Date().toISOString();
  iteration.durationMs = Date.now() - startedAt.getTime();
  return iteration;
}
