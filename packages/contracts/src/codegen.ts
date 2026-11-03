// Generates `@playwright/test` code from steps: what testRex executes, written the way a
// Playwright user would write it. Deterministic output (same input, same text).
import type { AutomationSettings, HookSnapshot } from './automation';
import type { DatasetSnapshot } from './datasets';
import { BUILTIN_VARIABLES, describeStep, type StepLocator, type TestStep } from './steps';
import type { ExecutionMode } from './test-cases';

export interface SpecTestCase {
  key: string;
  title: string;
  executionMode: ExecutionMode;
  tags: string[];
  steps: TestStep[];
  dataset: DatasetSnapshot | null;
}

export interface SpecGroup {
  /** `test.describe` title (a scenario), or null for top-level tests. */
  title: string | null;
  testCases: SpecTestCase[];
}

export interface PlaywrightSpecInput {
  /** First line comment, e.g. `CHK-TS-3 · Guest checkout`. */
  heading: string;
  settings: Pick<
    AutomationSettings,
    | 'baseUrl'
    | 'viewportWidth'
    | 'viewportHeight'
    | 'actionTimeoutMs'
    | 'navigationTimeoutMs'
    | 'assertionTimeoutMs'
  >;
  /** Enabled global steps, in execution order. */
  hooks: HookSnapshot[];
  groups: SpecGroup[];
}

const INDENT = '  ';

/** A single-quoted JavaScript string literal. */
export function jsString(text: string): string {
  return `'${text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;
}

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export interface CodeScope {
  /** Dataset columns available as `row.<name>`. */
  columns: Set<string>;
  /** Inside a dataset loop (`index` exists). */
  loop: boolean;
}

function builtinExpression(name: string, scope: CodeScope): string | null {
  switch (name) {
    case 'baseUrl':
      return 'BASE_URL';
    case 'runKey':
      return "process.env.TESTREX_RUN_KEY ?? 'local'";
    case 'iteration':
      return scope.loop ? 'index + 1' : '1';
    case 'timestamp':
      return 'Date.now()';
    case 'uuid':
      return 'crypto.randomUUID()';
    default:
      return null;
  }
}

/** A string literal, or a template literal when the text uses known variables. */
function literal(text: string, scope: CodeScope): string {
  let usesVariables = false;
  const parts: string[] = [];
  let last = 0;
  for (const match of text.matchAll(VARIABLE)) {
    const name = match[1]!;
    const expression = scope.columns.has(name)
      ? `row.${name}`
      : (BUILTIN_VARIABLES as readonly string[]).includes(name)
        ? builtinExpression(name, scope)
        : null;
    if (!expression) continue;
    usesVariables = true;
    parts.push(escapeTemplate(text.slice(last, match.index)), `\${${expression}}`);
    last = match.index! + match[0].length;
  }
  if (!usesVariables) return jsString(text);
  parts.push(escapeTemplate(text.slice(last)));
  return `\`${parts.join('')}\``;
}

function escapeTemplate(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

function locatorCode(locator: StepLocator, scope: CodeScope): string {
  const exact = locator.exact ? ', { exact: true }' : '';
  let code: string;
  switch (locator.strategy) {
    case 'role': {
      const options: string[] = [];
      if (locator.name !== undefined) options.push(`name: ${literal(locator.name, scope)}`);
      if (locator.exact) options.push('exact: true');
      code = `page.getByRole(${jsString(locator.value)}${options.length ? `, { ${options.join(', ')} }` : ''})`;
      break;
    }
    case 'text':
      code = `page.getByText(${literal(locator.value, scope)}${exact})`;
      break;
    case 'label':
      code = `page.getByLabel(${literal(locator.value, scope)}${exact})`;
      break;
    case 'placeholder':
      code = `page.getByPlaceholder(${literal(locator.value, scope)}${exact})`;
      break;
    case 'altText':
      code = `page.getByAltText(${literal(locator.value, scope)}${exact})`;
      break;
    case 'title':
      code = `page.getByTitle(${literal(locator.value, scope)}${exact})`;
      break;
    case 'testId':
      code = `page.getByTestId(${literal(locator.value, scope)})`;
      break;
    case 'css':
      code = `page.locator(${literal(locator.value, scope)})`;
      break;
  }
  return locator.nth === undefined ? code : `${code}.nth(${locator.nth})`;
}

/** The statement(s) for one step, without indentation. */
export function stepCode(
  step: TestStep,
  scope: CodeScope = { columns: new Set(), loop: false },
): string[] {
  const target = step.target ? locatorCode(step.target, scope) : 'page';
  const value = literal(step.value ?? '', scope);
  const lines: string[] = [];
  if (step.description) lines.push(`// ${oneLine(step.description)}`);
  if (step.expected) lines.push(`// Expected: ${oneLine(step.expected)}`);
  switch (step.action) {
    case 'goto':
      lines.push(`await page.goto(${value});`);
      break;
    case 'click':
      lines.push(`await ${target}.click();`);
      break;
    case 'dblclick':
      lines.push(`await ${target}.dblclick();`);
      break;
    case 'fill':
      lines.push(`await ${target}.fill(${value});`);
      break;
    case 'press':
      lines.push(
        step.target ? `await ${target}.press(${value});` : `await page.keyboard.press(${value});`,
      );
      break;
    case 'select':
      lines.push(`await ${target}.selectOption(${value});`);
      break;
    case 'check':
      lines.push(`await ${target}.check();`);
      break;
    case 'uncheck':
      lines.push(`await ${target}.uncheck();`);
      break;
    case 'hover':
      lines.push(`await ${target}.hover();`);
      break;
    case 'wait':
      lines.push(`await page.waitForTimeout(${Number(step.value ?? 0)});`);
      break;
    case 'manual':
      if (!step.description) lines.push('// Manual step');
      if (step.value) lines.push(`// Test data: ${oneLine(step.value)}`);
      lines.push('// TODO: performed by a person; automate it or keep the test manual.');
      break;
    case 'expectVisible':
      lines.push(`await expect(${target}).toBeVisible();`);
      break;
    case 'expectHidden':
      lines.push(`await expect(${target}).toBeHidden();`);
      break;
    case 'expectText':
      lines.push(`await expect(${target}).toContainText(${value});`);
      break;
    case 'expectExactText':
      lines.push(`await expect(${target}).toHaveText(${value});`);
      break;
    case 'expectValue':
      lines.push(`await expect(${target}).toHaveValue(${value});`);
      break;
    case 'expectChecked':
      lines.push(`await expect(${target}).toBeChecked();`);
      break;
    case 'expectEnabled':
      lines.push(`await expect(${target}).toBeEnabled();`);
      break;
    case 'expectDisabled':
      lines.push(`await expect(${target}).toBeDisabled();`);
      break;
    case 'expectCount':
      lines.push(`await expect(${target}).toHaveCount(${Number(step.value ?? 0)});`);
      break;
    case 'expectUrl':
      lines.push(`await expect.poll(() => page.url()).toContain(${value});`);
      break;
    case 'expectTitle':
      lines.push(`await expect.poll(() => page.title()).toContain(${value});`);
      break;
  }
  return lines;
}

function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, ' ').trim();
}

function indent(lines: string[], depth: number): string[] {
  return lines.map((line) => (line ? INDENT.repeat(depth) + line : line));
}

function stepsBlock(steps: TestStep[], scope: CodeScope): string[] {
  return steps.flatMap((step) => stepCode(step, scope));
}

function identifier(key: string): string {
  return `data${key.replace(/[^A-Za-z0-9]/g, '')}`;
}

function testBlock(testCase: SpecTestCase): string[] {
  const name = `${testCase.key} · ${testCase.title}`;
  const tags = testCase.tags.map((tag) => jsString(`@${tag}`));
  const details = tags.length ? `{ tag: [${tags.join(', ')}] }, ` : '';
  const manual = testCase.executionMode === 'manual';
  const dataset = testCase.dataset && testCase.dataset.rows.length ? testCase.dataset : null;
  const scope: CodeScope = { columns: new Set(dataset?.columns ?? []), loop: Boolean(dataset) };
  const body = [
    ...(manual ? ["test.fixme(true, 'Manual test case: executed by a person in testRex.');"] : []),
    ...stepsBlock(testCase.steps, scope),
  ];
  if (!dataset) {
    return [
      `test(${jsString(name)}, ${details}async ({ page }) => {`,
      ...indent(body.length ? body : ['// No steps yet.'], 1),
      '});',
    ];
  }
  const data = identifier(testCase.key);
  const rows = dataset.rows.map(
    (row) =>
      `{ ${dataset.columns.map((column, index) => `${column}: ${jsString(row[index] ?? '')}`).join(', ')} },`,
  );
  return [
    `// Dataset "${oneLine(dataset.name)}": one test per row.`,
    `const ${data} = [`,
    ...indent(rows, 1),
    '];',
    `for (const [index, row] of ${data}.entries()) {`,
    ...indent(
      [
        `test(\`${escapeTemplate(name)} [\${index + 1}]\`, ${details}async ({ page }) => {`,
        ...indent(body.length ? body : ['// No steps yet.'], 1),
        '});',
      ],
      1,
    ),
    '}',
  ];
}

function hookBlock(hooks: HookSnapshot[], kind: 'beforeEach' | 'afterEach'): string[] {
  if (hooks.length === 0) return [];
  const label = kind === 'beforeEach' ? 'before each test case' : 'after each test case';
  return [
    `// Global steps: ${label}.`,
    `test.${kind}(async ({ page }) => {`,
    ...indent(
      hooks.flatMap((hook) => [`// ${oneLine(hook.name)}`, ...stepsBlock(hook.steps, noScope())]),
      1,
    ),
    '});',
    '',
  ];
}

const noScope = (): CodeScope => ({ columns: new Set(), loop: false });

/** A complete spec file. */
export function playwrightSpec(input: PlaywrightSpecInput): string {
  const { settings } = input;
  const byPhase = (phase: HookSnapshot['phase']) => input.hooks.filter((h) => h.phase === phase);
  const beforeRun = byPhase('beforeRun');
  const afterRun = byPhase('afterRun');
  const lines: string[] = [
    `// ${oneLine(input.heading)}`,
    '// Generated by testRex from the test case steps. testRex runs the same steps itself.',
    "import { test, expect as baseExpect } from '@playwright/test';",
    '',
    `const BASE_URL = ${jsString(settings.baseUrl ?? 'http://localhost:3000')};`,
    `const expect = baseExpect.configure({ timeout: ${settings.assertionTimeoutMs} });`,
    '',
    'test.use({',
    ...indent(
      [
        'baseURL: BASE_URL,',
        `viewport: { width: ${settings.viewportWidth}, height: ${settings.viewportHeight} },`,
        `actionTimeout: ${settings.actionTimeoutMs},`,
        `navigationTimeout: ${settings.navigationTimeoutMs},`,
      ],
      1,
    ),
    '});',
    '',
  ];
  if (beforeRun.length || afterRun.length) {
    lines.push("const STORAGE_STATE = 'test-results/.testrex-storage-state.json';", '');
  }
  if (beforeRun.length) {
    lines.push(
      '// Global steps: before the test run. Their cookies and storage are shared by every test.',
      'test.beforeAll(async ({ browser }) => {',
      ...indent(
        [
          'const context = await browser.newContext({ baseURL: BASE_URL });',
          'const page = await context.newPage();',
          ...beforeRun.flatMap((hook) => [
            `// ${oneLine(hook.name)}`,
            ...stepsBlock(hook.steps, noScope()),
          ]),
          'await context.storageState({ path: STORAGE_STATE });',
          'await context.close();',
        ],
        1,
      ),
      '});',
      'test.use({ storageState: STORAGE_STATE });',
      '',
    );
  }
  if (afterRun.length) {
    lines.push(
      '// Global steps: after the test run.',
      'test.afterAll(async ({ browser }) => {',
      ...indent(
        [
          `const context = await browser.newContext({ baseURL: BASE_URL${beforeRun.length ? ', storageState: STORAGE_STATE' : ''} });`,
          'const page = await context.newPage();',
          ...afterRun.flatMap((hook) => [
            `// ${oneLine(hook.name)}`,
            ...stepsBlock(hook.steps, noScope()),
          ]),
          'await context.close();',
        ],
        1,
      ),
      '});',
      '',
    );
  }
  lines.push(...hookBlock(byPhase('beforeEach'), 'beforeEach'));
  lines.push(...hookBlock(byPhase('afterEach'), 'afterEach'));

  for (const group of input.groups) {
    const tests = group.testCases.flatMap((testCase, index) => [
      ...(index > 0 ? [''] : []),
      ...testBlock(testCase),
    ]);
    if (group.title === null) {
      lines.push(...tests, '');
    } else {
      lines.push(`test.describe(${jsString(group.title)}, () => {`, ...indent(tests, 1), '});', '');
    }
  }
  return `${lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd()}\n`;
}

/** `chk-tc-12.spec.ts`. */
export function specFileName(key: string): string {
  return `${key.toLowerCase()}.spec.ts`;
}

/** Plain-text summary of steps (used by AI prompts and logs). */
export function stepsAsText(steps: TestStep[]): string {
  return steps
    .map((step, index) => {
      const expected = step.expected ? ` (expected: ${oneLine(step.expected)})` : '';
      return `${index + 1}. ${oneLine(describeStep(step))}${expected}`;
    })
    .join('\n');
}
