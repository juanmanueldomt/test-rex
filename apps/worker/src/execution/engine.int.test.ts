// The step engine against a real Chromium and a local fixture site.
import type { TestStep } from '@testrex/contracts';
import type { Browser, BrowserContext } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startSite, type FixtureSite } from '../testing/site';
import { launchBrowser } from './browsers';
import { runSteps, type StepContext } from './engine';

let site: FixtureSite;
let browser: Browser;
let context: BrowserContext;
let stepContext: StepContext;

beforeAll(async () => {
  site = await startSite();
  browser = await launchBrowser('chromium');
});

afterAll(async () => {
  await browser?.close();
  await site?.close();
});

beforeEach(async () => {
  context = await browser.newContext({ baseURL: site.url });
  context.setDefaultTimeout(2_000);
  stepContext = { page: await context.newPage(), assertionTimeoutMs: 1_500, baseUrl: site.url };
});

afterEach(async () => {
  await context.close();
});

const steps = (list: Omit<TestStep, 'id'>[]): TestStep[] =>
  list.map((step, index) => ({ id: `s${index + 1}`, ...step }) as TestStep);

describe('runSteps', () => {
  it('runs actions and retrying assertions until the page shows the result', async () => {
    const outcome = await runSteps(
      stepContext,
      steps([
        { action: 'goto', value: '/cart' },
        { action: 'fill', target: { strategy: 'label', value: 'Coupon' }, value: '{{code}}' },
        { action: 'click', target: { strategy: 'role', value: 'button', name: 'Apply' } },
        { action: 'expectText', target: { strategy: 'testId', value: 'total' }, value: '90' },
        { action: 'expectVisible', target: { strategy: 'text', value: 'Discount applied' } },
        { action: 'check', target: { strategy: 'label', value: 'Gift wrap' } },
        {
          action: 'expectChecked',
          target: { strategy: 'role', value: 'checkbox', name: 'Gift wrap' },
        },
        { action: 'select', target: { strategy: 'label', value: 'Country' }, value: 'Argentina' },
        { action: 'expectValue', target: { strategy: 'label', value: 'Country' }, value: 'ar' },
        { action: 'expectCount', target: { strategy: 'css', value: 'li' }, value: '3' },
        { action: 'click', target: { strategy: 'role', value: 'button', name: 'Remove', nth: 1 } },
        { action: 'expectCount', target: { strategy: 'css', value: 'li' }, value: '2' },
        {
          action: 'expectDisabled',
          target: { strategy: 'role', value: 'button', name: 'Pay later' },
        },
        { action: 'expectTitle', value: 'Cart' },
        { action: 'expectUrl', value: '/cart' },
      ]),
      { code: 'SAVE10' },
    );
    expect(outcome.error).toBeNull();
    expect(outcome.results.map((r) => r.status)).toEqual(Array(15).fill('passed'));
  });

  it('reports expected and received values, then skips the remaining steps', async () => {
    const outcome = await runSteps(
      stepContext,
      steps([
        { action: 'goto', value: '/cart' },
        { action: 'expectText', target: { strategy: 'testId', value: 'total' }, value: '80' },
        { action: 'click', target: { strategy: 'text', value: 'Apply' } },
      ]),
      {},
    );
    expect(outcome.failedStepId).toBe('s2');
    expect(outcome.error).toBe('Expected test id "total" to contain "80", but it was "100".');
    expect(outcome.results.map((r) => r.status)).toEqual(['passed', 'failed', 'skipped']);
  });

  it('fails ambiguous locators, unknown variables and relative URLs without a base URL', async () => {
    const ambiguous = await runSteps(
      stepContext,
      steps([
        { action: 'goto', value: '/cart' },
        { action: 'click', target: { strategy: 'role', value: 'button', name: 'Remove' } },
      ]),
      {},
    );
    expect(ambiguous.error).toMatch(/strict mode violation.*resolved to 3 elements/s);

    const unknown = await runSteps(
      stepContext,
      steps([{ action: 'goto', value: '/{{page}}' }]),
      {},
    );
    expect(unknown.error).toBe('Unknown variable {{page}}.');

    const relative = await runSteps(
      { ...stepContext, baseUrl: null },
      steps([{ action: 'goto', value: '/cart' }]),
      {},
    );
    expect(relative.error).toMatch(/set a base URL/);
  });

  it('stops when the run is cancelled', async () => {
    let stop = false;
    const outcome = await runSteps(
      stepContext,
      steps([
        { action: 'goto', value: '/' },
        { action: 'wait', value: '10' },
        { action: 'wait', value: '10' },
      ]),
      {},
      async () => {
        const answer = stop;
        stop = true;
        return answer;
      },
    );
    expect(outcome.cancelled).toBe(true);
    expect(outcome.results.map((r) => r.status)).toEqual(['passed', 'skipped', 'skipped']);
  });
});
