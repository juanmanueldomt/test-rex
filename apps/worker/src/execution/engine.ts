// Executes test steps with the Playwright library. Locators map one to one to Playwright
// locators (strict, auto-waiting); assertions retry until they pass or the assertion timeout
// elapses, like Playwright's web-first assertions.
import {
  describeAction,
  describeLocator,
  resolveStep,
  type StepLocator,
  type StepResult,
  type TestStep,
} from '@testrex/contracts';
import type { Locator, Page } from 'playwright-core';

/** A step failure with a message people can act on. */
export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

type Role = Parameters<Page['getByRole']>[0];

export function locatorFor(page: Page, target: StepLocator): Locator {
  const exact = target.exact ? { exact: true } : undefined;
  let locator: Locator;
  switch (target.strategy) {
    case 'role':
      locator = page.getByRole(target.value as Role, {
        ...(target.name !== undefined ? { name: target.name } : {}),
        ...(target.exact ? { exact: true } : {}),
      });
      break;
    case 'text':
      locator = page.getByText(target.value, exact);
      break;
    case 'label':
      locator = page.getByLabel(target.value, exact);
      break;
    case 'placeholder':
      locator = page.getByPlaceholder(target.value, exact);
      break;
    case 'altText':
      locator = page.getByAltText(target.value, exact);
      break;
    case 'title':
      locator = page.getByTitle(target.value, exact);
      break;
    case 'testId':
      locator = page.getByTestId(target.value);
      break;
    case 'css':
      locator = page.locator(target.value);
      break;
  }
  return target.nth === undefined ? locator : locator.nth(target.nth);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const MESSAGE_MAX = 2_000;

/** Playwright errors without colors and with a bounded call log. */
export function cleanError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.replace(ANSI, '').trim();
  return text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX)}…` : text;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normalize = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim();
const quote = (text: string) => `"${text}"`;

/**
 * Reads a value until it satisfies the check or the timeout elapses. Each read gets a short
 * timeout of its own so a missing element does not consume the whole budget at once.
 */
async function poll<T>(
  read: (timeout: number) => Promise<T>,
  check: (value: T) => boolean,
  timeoutMs: number,
): Promise<{ ok: true } | { ok: false; last: T | undefined; error: unknown }> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  let error: unknown;
  for (;;) {
    const remaining = Math.max(50, deadline - Date.now());
    try {
      last = await read(Math.min(1_000, remaining));
      error = undefined;
      if (check(last)) return { ok: true };
    } catch (caught) {
      error = caught;
    }
    if (Date.now() >= deadline) return { ok: false, last, error };
    await sleep(100);
  }
}

async function assertStep(page: Page, step: TestStep, timeoutMs: number): Promise<void> {
  const target = step.target ? locatorFor(page, step.target) : null;
  const what = step.target ? describeLocator(step.target) : 'the page';
  const expected = step.value ?? '';
  const fail = (result: { last: unknown; error: unknown }, expectation: string) => {
    const received =
      result.last !== undefined
        ? `, but it was ${typeof result.last === 'string' ? quote(result.last) : String(result.last)}`
        : result.error
          ? `: ${cleanError(result.error).split('\n')[0]}`
          : '';
    return new StepError(`Expected ${what} ${expectation}${received}.`);
  };
  switch (step.action) {
    case 'expectVisible':
    case 'expectHidden': {
      const state = step.action === 'expectVisible' ? 'visible' : 'hidden';
      try {
        await target!.waitFor({ state, timeout: timeoutMs });
      } catch (error) {
        throw new StepError(`Expected ${what} to be ${state}: ${cleanError(error).split('\n')[0]}`);
      }
      return;
    }
    case 'expectText':
    case 'expectExactText': {
      const want = normalize(expected);
      const result = await poll(
        async (timeout) => normalize(await target!.textContent({ timeout })),
        (text) => (step.action === 'expectText' ? text.includes(want) : text === want),
        timeoutMs,
      );
      if (!result.ok) {
        throw fail(
          result,
          step.action === 'expectText'
            ? `to contain ${quote(want)}`
            : `to have text ${quote(want)}`,
        );
      }
      return;
    }
    case 'expectValue': {
      const result = await poll(
        (timeout) => target!.inputValue({ timeout }),
        (value) => value === expected,
        timeoutMs,
      );
      if (!result.ok) throw fail(result, `to have value ${quote(expected)}`);
      return;
    }
    case 'expectChecked': {
      const result = await poll((timeout) => target!.isChecked({ timeout }), Boolean, timeoutMs);
      if (!result.ok) throw fail(result, 'to be checked');
      return;
    }
    case 'expectEnabled':
    case 'expectDisabled': {
      const enabled = step.action === 'expectEnabled';
      const result = await poll(
        (timeout) => target!.isEnabled({ timeout }),
        (value) => value === enabled,
        timeoutMs,
      );
      if (!result.ok) throw fail(result, enabled ? 'to be enabled' : 'to be disabled');
      return;
    }
    case 'expectCount': {
      const want = Number(expected);
      const result = await poll(
        () => target!.count(),
        (count) => count === want,
        timeoutMs,
      );
      if (!result.ok) throw fail(result, `to match ${want} elements`);
      return;
    }
    case 'expectUrl': {
      const result = await poll(
        async () => page.url(),
        (url) => url.includes(expected),
        timeoutMs,
      );
      if (!result.ok) throw fail(result, `URL to contain ${quote(expected)}`);
      return;
    }
    case 'expectTitle': {
      const result = await poll(
        () => page.title(),
        (title) => title.includes(expected),
        timeoutMs,
      );
      if (!result.ok) throw fail(result, `title to contain ${quote(expected)}`);
      return;
    }
    default:
      throw new StepError(`Unsupported assertion ${step.action}.`);
  }
}

export interface StepContext {
  page: Page;
  assertionTimeoutMs: number;
  /** Relative `go to` steps need one. */
  baseUrl: string | null;
}

/** Runs one resolved step (placeholders already substituted). Throws on failure. */
export async function performStep(context: StepContext, step: TestStep): Promise<void> {
  const { page } = context;
  const target = () => {
    if (!step.target) throw new StepError(`${describeAction(step)} needs a target.`);
    return locatorFor(page, step.target);
  };
  const value = step.value ?? '';
  switch (step.action) {
    case 'goto': {
      if (!/^[a-z][a-z0-9+.-]*:/i.test(value) && !context.baseUrl) {
        throw new StepError(
          `Cannot open ${quote(value)}: set a base URL in the automation settings to use relative URLs.`,
        );
      }
      await page.goto(value);
      return;
    }
    case 'click':
      await target().click();
      return;
    case 'dblclick':
      await target().dblclick();
      return;
    case 'fill':
      await target().fill(value);
      return;
    case 'press':
      if (step.target) await target().press(value);
      else await page.keyboard.press(value);
      return;
    case 'select':
      await target().selectOption(value);
      return;
    case 'check':
      await target().check();
      return;
    case 'uncheck':
      await target().uncheck();
      return;
    case 'hover':
      await target().hover();
      return;
    case 'wait':
      await page.waitForTimeout(Number(value));
      return;
    case 'manual':
      throw new StepError('Manual steps cannot run automatically.');
    default:
      await assertStep(page, step, context.assertionTimeoutMs);
  }
}

export interface StepsOutcome {
  results: StepResult[];
  /** The step that failed, if any. */
  failedStepId: string | null;
  error: string | null;
  /** Stopped because the run was cancelled. */
  cancelled: boolean;
}

/**
 * Runs steps in order until the first failure; later steps are reported as skipped. Variables
 * are substituted per step so an unknown one fails only the step that uses it.
 */
export async function runSteps(
  context: StepContext,
  steps: TestStep[],
  variables: Record<string, string>,
  shouldStop: () => Promise<boolean> = async () => false,
): Promise<StepsOutcome> {
  const results: StepResult[] = [];
  let failedStepId: string | null = null;
  let error: string | null = null;
  let cancelled = false;
  for (const step of steps) {
    if (failedStepId || cancelled) {
      results.push({ stepId: step.id, status: 'skipped' });
      continue;
    }
    if (await shouldStop()) {
      cancelled = true;
      results.push({ stepId: step.id, status: 'skipped' });
      continue;
    }
    const started = Date.now();
    try {
      const resolved = resolveStep(step, variables);
      if (resolved.missing.length) {
        throw new StepError(
          `Unknown variable ${resolved.missing.map((name) => `{{${name}}}`).join(', ')}.`,
        );
      }
      await performStep(context, resolved.step);
      results.push({ stepId: step.id, status: 'passed', durationMs: Date.now() - started });
    } catch (caught) {
      error = cleanError(caught);
      failedStepId = step.id;
      results.push({
        stepId: step.id,
        status: 'failed',
        durationMs: Date.now() - started,
        error,
      });
    }
  }
  return { results, failedStepId, error, cancelled };
}
