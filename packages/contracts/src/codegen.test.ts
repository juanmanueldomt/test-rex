import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION_SETTINGS } from './automation';
import { jsString, playwrightSpec, specFileName, stepCode } from './codegen';
import { parsePlaywrightCode } from './recording';
import type { TestStep } from './steps';

const settings = { ...DEFAULT_AUTOMATION_SETTINGS, baseUrl: 'https://shop.example.com' };

describe('jsString', () => {
  it('escapes quotes, backslashes and line breaks', () => {
    expect(jsString("it's a \\ path\nnext")).toBe("'it\\'s a \\\\ path\\nnext'");
  });
});

describe('stepCode', () => {
  it('maps actions and assertions to Playwright calls', () => {
    const steps: TestStep[] = [
      { id: '1', action: 'goto', value: '/cart' },
      {
        id: '2',
        action: 'click',
        target: { strategy: 'role', value: 'button', name: 'Apply', exact: true },
      },
      {
        id: '3',
        action: 'fill',
        target: { strategy: 'label', value: 'Coupon' },
        value: 'SAVE10',
        description: 'Type the coupon',
      },
      { id: '4', action: 'press', value: 'Enter' },
      {
        id: '5',
        action: 'expectText',
        target: { strategy: 'testId', value: 'total', nth: 0 },
        value: '€90',
        expected: 'The discount is applied',
      },
      { id: '6', action: 'expectCount', target: { strategy: 'css', value: 'li.item' }, value: '3' },
      { id: '7', action: 'expectUrl', value: '/thanks' },
    ];
    expect(steps.flatMap((step) => stepCode(step))).toEqual([
      "await page.goto('/cart');",
      "await page.getByRole('button', { name: 'Apply', exact: true }).click();",
      '// Type the coupon',
      "await page.getByLabel('Coupon').fill('SAVE10');",
      "await page.keyboard.press('Enter');",
      '// Expected: The discount is applied',
      "await expect(page.getByTestId('total').nth(0)).toContainText('€90');",
      "await expect(page.locator('li.item')).toHaveCount(3);",
      "await expect.poll(() => page.url()).toContain('/thanks');",
    ]);
  });
});

describe('playwrightSpec', () => {
  it('writes hooks, a describe per scenario, tags and dataset loops', () => {
    const code = playwrightSpec({
      heading: 'CHK-TS-1 · Checkout',
      settings,
      hooks: [
        {
          id: 'h1',
          name: 'Sign in',
          phase: 'beforeRun',
          steps: [{ id: 'a', action: 'goto', value: '/login' }],
        },
        {
          id: 'h2',
          name: 'Accept cookies',
          phase: 'beforeEach',
          steps: [{ id: 'b', action: 'click', target: { strategy: 'text', value: 'Accept' } }],
        },
      ],
      groups: [
        {
          title: 'CHK-TS-1 · Checkout',
          testCases: [
            {
              key: 'CHK-TC-2',
              title: 'Apply a coupon',
              executionMode: 'automated',
              tags: ['smoke'],
              dataset: { id: 'd', name: 'Coupons', columns: ['code'], rows: [['SAVE10'], ['VIP']] },
              steps: [
                {
                  id: 'c',
                  action: 'fill',
                  target: { strategy: 'label', value: 'Coupon' },
                  value: '{{code}}-{{iteration}}',
                },
              ],
            },
          ],
        },
      ],
    });
    expect(code).toContain("const BASE_URL = 'https://shop.example.com';");
    expect(code).toContain('test.beforeAll(async ({ browser }) => {');
    expect(code).toContain('test.use({ storageState: STORAGE_STATE });');
    expect(code).toContain('test.beforeEach(async ({ page }) => {');
    expect(code).toContain("test.describe('CHK-TS-1 · Checkout', () => {");
    expect(code).toContain("{ code: 'SAVE10' },");
    expect(code).toContain(
      "test(`CHK-TC-2 · Apply a coupon [${index + 1}]`, { tag: ['@smoke'] }, async ({ page }) => {",
    );
    expect(code).toContain("await page.getByLabel('Coupon').fill(`${row.code}-${index + 1}`);");
    expect(code.endsWith('\n')).toBe(true);
    expect(specFileName('CHK-TC-2')).toBe('chk-tc-2.spec.ts');
  });

  it('marks manual test cases as fixme', () => {
    const code = playwrightSpec({
      heading: 'CHK-TC-3',
      settings,
      hooks: [],
      groups: [
        {
          title: null,
          testCases: [
            {
              key: 'CHK-TC-3',
              title: 'Check the receipt',
              executionMode: 'manual',
              tags: [],
              dataset: null,
              steps: [{ id: 'a', action: 'manual', description: 'Print the receipt' }],
            },
          ],
        },
      ],
    });
    expect(code).toContain("test('CHK-TC-3 · Check the receipt', async ({ page }) => {");
    expect(code).toContain(
      "test.fixme(true, 'Manual test case: executed by a person in testRex.');",
    );
    expect(code).toContain('// Print the receipt');
  });
});

describe('parsePlaywrightCode', () => {
  it('imports test-style codegen output', () => {
    const { steps, warnings } =
      parsePlaywrightCode(`import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://demo.playwright.dev/todomvc/');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).click();
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('buy milk');
  await page.getByRole('textbox', { name: 'What needs to be done?' }).press('Enter');
  await page.getByTestId('todo-item').first().getByRole('checkbox').check();
  await page.getByRole('link', { name: /^Completed$/ }).click();
  await page.getByLabel('Toggle All').setChecked(false);
  await page.locator('#main').nth(1).hover();
  await page.getByRole('combobox').selectOption({ label: 'Spain' });
  await expect(page.getByTestId('todo-title')).toContainText('buy milk');
  await expect(page.getByText('1 item left')).toBeVisible();
  await expect(page.getByRole('alert')).not.toBeVisible();
  await expect(page).toHaveURL('https://demo.playwright.dev/todomvc/#/completed');
  const page1Promise = page.waitForEvent('popup');
});`);
    const shapes = steps.map((step) => ({ ...step, id: undefined }));
    expect(shapes).toEqual([
      { id: undefined, action: 'goto', value: 'https://demo.playwright.dev/todomvc/' },
      {
        id: undefined,
        action: 'click',
        target: { strategy: 'role', value: 'textbox', name: 'What needs to be done?' },
      },
      {
        id: undefined,
        action: 'fill',
        target: { strategy: 'role', value: 'textbox', name: 'What needs to be done?' },
        value: 'buy milk',
      },
      {
        id: undefined,
        action: 'press',
        target: { strategy: 'role', value: 'textbox', name: 'What needs to be done?' },
        value: 'Enter',
      },
      {
        id: undefined,
        action: 'click',
        target: { strategy: 'role', value: 'link', name: 'Completed', exact: true },
      },
      { id: undefined, action: 'uncheck', target: { strategy: 'label', value: 'Toggle All' } },
      { id: undefined, action: 'hover', target: { strategy: 'css', value: '#main', nth: 1 } },
      {
        id: undefined,
        action: 'select',
        target: { strategy: 'role', value: 'combobox' },
        value: 'Spain',
      },
      {
        id: undefined,
        action: 'expectText',
        target: { strategy: 'testId', value: 'todo-title' },
        value: 'buy milk',
      },
      {
        id: undefined,
        action: 'expectVisible',
        target: { strategy: 'text', value: '1 item left' },
      },
      { id: undefined, action: 'expectHidden', target: { strategy: 'role', value: 'alert' } },
      {
        id: undefined,
        action: 'expectUrl',
        value: 'https://demo.playwright.dev/todomvc/#/completed',
      },
    ]);
    expect(warnings.map((w) => [w.line, w.reason])).toEqual([
      [8, 'locator'],
      [17, 'unsupported'],
    ]);
  });

  it('imports library-style output and skips browser setup', () => {
    const { steps, warnings } = parsePlaywrightCode(`const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: false
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('https://example.com/');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);

  // ---------------------
  await context.close();
  await browser.close();
})();`);
    expect(steps.map((step) => [step.action, step.value])).toEqual([
      ['goto', 'https://example.com/'],
      ['press', 'Escape'],
      ['wait', '250'],
    ]);
    expect(warnings).toEqual([]);
  });
});
