// Test steps: the one model shared by authoring, manual execution, the Playwright engine,
// generated code, recordings and AI proposals. Validation messages are i18n keys.
import { z } from 'zod';

/** Actions that do something on the page (plus `manual`, a step only people can execute). */
export const STEP_ACTIONS = [
  'goto',
  'click',
  'dblclick',
  'fill',
  'press',
  'select',
  'check',
  'uncheck',
  'hover',
  'wait',
  'manual',
] as const;

/** Assertions: the expected results an automated step verifies. */
export const STEP_ASSERTIONS = [
  'expectVisible',
  'expectHidden',
  'expectText',
  'expectExactText',
  'expectValue',
  'expectChecked',
  'expectEnabled',
  'expectDisabled',
  'expectCount',
  'expectUrl',
  'expectTitle',
] as const;

export const STEP_KINDS = [...STEP_ACTIONS, ...STEP_ASSERTIONS] as const;
export type StepAction = (typeof STEP_KINDS)[number];
export type StepAssertion = (typeof STEP_ASSERTIONS)[number];

export const LOCATOR_STRATEGIES = [
  'role',
  'text',
  'label',
  'placeholder',
  'altText',
  'title',
  'testId',
  'css',
] as const;
export type LocatorStrategy = (typeof LOCATOR_STRATEGIES)[number];

/** The ARIA roles Playwright's `getByRole` accepts. */
export const ARIA_ROLES = [
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
] as const;
export type AriaRole = (typeof ARIA_ROLES)[number];

export const STEP_DESCRIPTION_MAX = 2_000;
export const STEP_VALUE_MAX = 5_000;
export const LOCATOR_VALUE_MAX = 1_000;
export const LOCATOR_NAME_MAX = 500;
export const STEPS_MAX = 200;
export const WAIT_MAX_MS = 60_000;
export const COUNT_MAX = 10_000;

type Need = 'required' | 'optional' | 'none';
type ValueKind = 'url' | 'text' | 'key' | 'ms' | 'count';

export interface StepRule {
  target: Need;
  value: Need;
  valueKind?: ValueKind;
  /** Can the Playwright engine execute it? */
  automated: boolean;
}

/** What each action needs. The editor, the schema and the engine all read this table. */
export const STEP_RULES: Record<StepAction, StepRule> = {
  goto: { target: 'none', value: 'required', valueKind: 'url', automated: true },
  click: { target: 'required', value: 'none', automated: true },
  dblclick: { target: 'required', value: 'none', automated: true },
  fill: { target: 'required', value: 'optional', valueKind: 'text', automated: true },
  press: { target: 'optional', value: 'required', valueKind: 'key', automated: true },
  select: { target: 'required', value: 'required', valueKind: 'text', automated: true },
  check: { target: 'required', value: 'none', automated: true },
  uncheck: { target: 'required', value: 'none', automated: true },
  hover: { target: 'required', value: 'none', automated: true },
  wait: { target: 'none', value: 'required', valueKind: 'ms', automated: true },
  manual: { target: 'none', value: 'optional', valueKind: 'text', automated: false },
  expectVisible: { target: 'required', value: 'none', automated: true },
  expectHidden: { target: 'required', value: 'none', automated: true },
  expectText: { target: 'required', value: 'required', valueKind: 'text', automated: true },
  expectExactText: { target: 'required', value: 'optional', valueKind: 'text', automated: true },
  expectValue: { target: 'required', value: 'optional', valueKind: 'text', automated: true },
  expectChecked: { target: 'required', value: 'none', automated: true },
  expectEnabled: { target: 'required', value: 'none', automated: true },
  expectDisabled: { target: 'required', value: 'none', automated: true },
  expectCount: { target: 'required', value: 'required', valueKind: 'count', automated: true },
  expectUrl: { target: 'none', value: 'required', valueKind: 'text', automated: true },
  expectTitle: { target: 'none', value: 'required', valueKind: 'text', automated: true },
};

export function isAssertion(action: StepAction): action is StepAssertion {
  return (STEP_ASSERTIONS as readonly string[]).includes(action);
}

export interface StepLocator {
  strategy: LocatorStrategy;
  /** Role name (`button`), text, label, placeholder, alt text, title, test id or CSS selector. */
  value: string;
  /** Accessible name, for `role`. */
  name?: string;
  exact?: boolean;
  /** Zero-based index when several elements match. */
  nth?: number;
}

export interface TestStep {
  /** Stable within its list (results and diffs refer to it). */
  id: string;
  action: StepAction;
  target?: StepLocator;
  value?: string;
  /** What a person does; when empty the interface describes the action. */
  description?: string;
  /** Expected result, shown with emphasis. */
  expected?: string;
}

const STEP_ID_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

/** A short random id for a new step (browsers and Node 22 both provide Web Crypto). */
export function newStepId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(bytes, (byte) => (byte % 36).toString(36)).join('');
}

const optionalText = (max: number, message: string) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? undefined : (value ?? undefined),
    z.string().trim().max(max, message).optional(),
  );

export const locatorSchema = z
  .object({
    strategy: z.enum(LOCATOR_STRATEGIES),
    value: z.string().trim().min(1, 'locator.required').max(LOCATOR_VALUE_MAX, 'locator.tooLong'),
    name: optionalText(LOCATOR_NAME_MAX, 'locator.tooLong'),
    exact: z.boolean().optional(),
    nth: z.number().int().min(0).max(1000).optional(),
  })
  .superRefine((locator, ctx) => {
    if (locator.strategy === 'role' && !(ARIA_ROLES as readonly string[]).includes(locator.value)) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'locator.role' });
    }
  })
  .transform((locator): StepLocator => {
    const out: StepLocator = { strategy: locator.strategy, value: locator.value };
    if (locator.strategy === 'role' && locator.name !== undefined) out.name = locator.name;
    if (locator.exact) out.exact = true;
    if (locator.nth !== undefined) out.nth = locator.nth;
    return out;
  });

/** Checks a step against its action's rule (target, value and value format). */
function checkStep(
  step: { action: StepAction; target?: unknown; value?: string; description?: string },
  ctx: z.RefinementCtx,
) {
  const rule = STEP_RULES[step.action];
  if (rule.target === 'required' && !step.target) {
    ctx.addIssue({ code: 'custom', path: ['target'], message: 'step.targetRequired' });
  }
  if (step.action === 'manual' && !step.description) {
    ctx.addIssue({ code: 'custom', path: ['description'], message: 'step.descriptionRequired' });
  }
  const value = step.value ?? '';
  if (rule.value === 'required' && value.trim() === '') {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'step.valueRequired' });
    return;
  }
  if (rule.value === 'none' || value === '') return;
  if (rule.valueKind === 'ms') {
    const ms = Number(value);
    if (!/^\d+$/.test(value.trim()) || ms > WAIT_MAX_MS) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'step.waitInvalid' });
    }
  }
  if (rule.valueKind === 'count') {
    const count = Number(value);
    if (!/^\d+$/.test(value.trim()) || count > COUNT_MAX) {
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'step.countInvalid' });
    }
  }
  if (rule.valueKind === 'key' && value.length > 60) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'step.keyInvalid' });
  }
}

export const stepSchema = z
  .object({
    id: z.string().regex(STEP_ID_PATTERN, 'step.idInvalid'),
    action: z.enum(STEP_KINDS),
    target: locatorSchema.nullish(),
    value: z
      .string()
      .max(STEP_VALUE_MAX, 'step.valueTooLong')
      .nullish()
      .transform((value) => value ?? undefined),
    description: optionalText(STEP_DESCRIPTION_MAX, 'step.descriptionTooLong'),
    expected: optionalText(STEP_DESCRIPTION_MAX, 'step.expectedTooLong'),
  })
  .superRefine((step, ctx) =>
    checkStep(
      {
        action: step.action,
        target: step.target,
        value: step.value,
        description: step.description,
      },
      ctx,
    ),
  )
  .transform((step): TestStep => {
    // Fields the action does not use are dropped (the editor keeps them while switching).
    const rule = STEP_RULES[step.action];
    const out: TestStep = { id: step.id, action: step.action };
    if (rule.target !== 'none' && step.target) out.target = step.target;
    if (rule.value !== 'none' && step.value !== undefined) {
      out.value =
        rule.valueKind === 'ms' || rule.valueKind === 'count' ? step.value.trim() : step.value;
    }
    if (step.description) out.description = step.description;
    if (step.expected) out.expected = step.expected;
    return out;
  });

/** An ordered list of steps with unique ids. */
export const stepsSchema = z
  .array(stepSchema)
  .max(STEPS_MAX, 'steps.tooMany')
  .superRefine((steps, ctx) => {
    const seen = new Set<string>();
    steps.forEach((step, index) => {
      if (seen.has(step.id)) {
        ctx.addIssue({ code: 'custom', path: [index, 'id'], message: 'step.duplicateId' });
      }
      seen.add(step.id);
    });
  });

/** Issues for steps that cannot run automatically (automated test cases, global steps). */
export function manualStepIssues(
  steps: { action: StepAction }[],
  message = 'step.manualInAutomated',
): { path: (string | number)[]; message: string }[] {
  return steps.flatMap((step, index) =>
    STEP_RULES[step.action].automated ? [] : [{ path: ['steps', index, 'action'], message }],
  );
}

// ---------------------------------------------------------------------------------------------
// Descriptions (English; the web app localizes the same parts)
// ---------------------------------------------------------------------------------------------

const STRATEGY_WORDS: Record<LocatorStrategy, string> = {
  role: 'role',
  text: 'text',
  label: 'label',
  placeholder: 'placeholder',
  altText: 'alt text',
  title: 'title',
  testId: 'test id',
  css: 'CSS',
};

/** `button "Apply"`, `label "Email"`, `CSS "#main a"`, with `(#2)` for an index. */
export function describeLocator(locator: StepLocator): string {
  const base =
    locator.strategy === 'role'
      ? locator.name
        ? `${locator.value} "${locator.name}"`
        : locator.value
      : `${STRATEGY_WORDS[locator.strategy]} "${locator.value}"`;
  return locator.nth === undefined ? base : `${base} (#${locator.nth + 1})`;
}

const quote = (text: string | undefined) => `"${text ?? ''}"`;

/** A readable sentence for a step, e.g. `Click button "Apply"`. */
export function describeAction(step: Pick<TestStep, 'action' | 'target' | 'value'>): string {
  const target = step.target ? describeLocator(step.target) : 'the page';
  const value = step.value ?? '';
  switch (step.action) {
    case 'goto':
      return `Go to ${value}`;
    case 'click':
      return `Click ${target}`;
    case 'dblclick':
      return `Double-click ${target}`;
    case 'fill':
      return `Fill ${target} with ${quote(value)}`;
    case 'press':
      return step.target ? `Press ${value} on ${target}` : `Press ${value}`;
    case 'select':
      return `Select ${quote(value)} in ${target}`;
    case 'check':
      return `Check ${target}`;
    case 'uncheck':
      return `Uncheck ${target}`;
    case 'hover':
      return `Hover ${target}`;
    case 'wait':
      return `Wait ${value} ms`;
    case 'manual':
      return 'Manual step';
    case 'expectVisible':
      return `Expect ${target} to be visible`;
    case 'expectHidden':
      return `Expect ${target} to be hidden`;
    case 'expectText':
      return `Expect ${target} to contain ${quote(value)}`;
    case 'expectExactText':
      return `Expect ${target} to have text ${quote(value)}`;
    case 'expectValue':
      return `Expect ${target} to have value ${quote(value)}`;
    case 'expectChecked':
      return `Expect ${target} to be checked`;
    case 'expectEnabled':
      return `Expect ${target} to be enabled`;
    case 'expectDisabled':
      return `Expect ${target} to be disabled`;
    case 'expectCount':
      return `Expect ${target} to match ${value} elements`;
    case 'expectUrl':
      return `Expect the URL to contain ${quote(value)}`;
    case 'expectTitle':
      return `Expect the title to contain ${quote(value)}`;
  }
}

/** The step's own description, else the generated one. */
export function describeStep(step: TestStep): string {
  return step.description || describeAction(step);
}

// ---------------------------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------------------------

/** Always available while a run executes. */
export const BUILTIN_VARIABLES = ['baseUrl', 'runKey', 'iteration', 'timestamp', 'uuid'] as const;

const VARIABLE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Distinct `{{name}}` placeholders, in order of appearance. */
export function extractVariables(text: string | undefined): string[] {
  if (!text) return [];
  return [...new Set([...text.matchAll(VARIABLE)].map((match) => match[1]!))];
}

/** Variables used by a step's value and locator. */
export function stepVariables(step: TestStep): string[] {
  return [
    ...new Set([
      ...extractVariables(step.value),
      ...extractVariables(step.target?.value),
      ...extractVariables(step.target?.name),
    ]),
  ];
}

/** Replaces `{{name}}` with values; unknown names are left as they are and reported. */
export function substituteVariables(
  text: string,
  values: Record<string, string>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const result = text.replace(VARIABLE, (whole, name: string) => {
    if (Object.hasOwn(values, name)) return values[name]!;
    missing.add(name);
    return whole;
  });
  return { text: result, missing: [...missing] };
}

/** The step with every placeholder resolved, or the names that could not be resolved. */
export function resolveStep(
  step: TestStep,
  values: Record<string, string>,
): { step: TestStep; missing: string[] } {
  const missing = new Set<string>();
  const sub = (text: string | undefined) => {
    if (text === undefined) return undefined;
    const result = substituteVariables(text, values);
    result.missing.forEach((name) => missing.add(name));
    return result.text;
  };
  const resolved: TestStep = { ...step };
  if (step.value !== undefined) resolved.value = sub(step.value);
  if (step.target) {
    resolved.target = { ...step.target, value: sub(step.target.value)! };
    if (step.target.name !== undefined) resolved.target.name = sub(step.target.name);
  }
  return { step: resolved, missing: [...missing] };
}
