import { describe, expect, it } from 'vitest';
import {
  describeAction,
  describeLocator,
  describeStep,
  extractVariables,
  manualStepIssues,
  newStepId,
  relativeToBaseUrl,
  relativizeSteps,
  resolveStep,
  stepSchema,
  stepsSchema,
  substituteVariables,
  type TestStep,
} from './steps';

const issues = (result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) => (result.success ? [] : result.error!.issues.map((i) => `${i.path.join('.')}:${i.message}`));

describe('stepSchema', () => {
  it('accepts a click with a role locator and drops fields the action does not use', () => {
    const step = stepSchema.parse({
      id: 's1',
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Apply', exact: false },
      value: 'left over',
      description: '  ',
    });
    expect(step).toEqual({
      id: 's1',
      action: 'click',
      target: { strategy: 'role', value: 'button', name: 'Apply' },
    });
  });

  it('requires a target for element actions and a value where the action needs one', () => {
    expect(issues(stepSchema.safeParse({ id: 'a', action: 'click' }))).toEqual([
      'target:step.targetRequired',
    ]);
    expect(issues(stepSchema.safeParse({ id: 'a', action: 'goto', value: ' ' }))).toEqual([
      'value:step.valueRequired',
    ]);
    expect(
      issues(
        stepSchema.safeParse({
          id: 'a',
          action: 'expectText',
          target: { strategy: 'text', value: 'Total' },
        }),
      ),
    ).toEqual(['value:step.valueRequired']);
  });

  it('validates wait and count values', () => {
    expect(issues(stepSchema.safeParse({ id: 'a', action: 'wait', value: '61000' }))).toEqual([
      'value:step.waitInvalid',
    ]);
    expect(stepSchema.parse({ id: 'a', action: 'wait', value: ' 500 ' }).value).toBe('500');
    expect(
      issues(
        stepSchema.safeParse({
          id: 'a',
          action: 'expectCount',
          target: { strategy: 'css', value: 'li' },
          value: 'three',
        }),
      ),
    ).toEqual(['value:step.countInvalid']);
  });

  it('rejects unknown roles and requires a description for manual steps', () => {
    expect(
      issues(
        stepSchema.safeParse({
          id: 'a',
          action: 'click',
          target: { strategy: 'role', value: 'buton' },
        }),
      ),
    ).toEqual(['target.value:locator.role']);
    expect(issues(stepSchema.safeParse({ id: 'a', action: 'manual' }))).toEqual([
      'description:step.descriptionRequired',
    ]);
  });

  it('keeps an empty fill value (clearing a field) and an expected result', () => {
    expect(
      stepSchema.parse({
        id: 'a',
        action: 'fill',
        target: { strategy: 'label', value: 'Coupon' },
        value: '',
        expected: 'The field is empty',
      }),
    ).toEqual({
      id: 'a',
      action: 'fill',
      target: { strategy: 'label', value: 'Coupon' },
      value: '',
      expected: 'The field is empty',
    });
  });

  it('rejects duplicate step ids in a list', () => {
    const result = stepsSchema.safeParse([
      { id: 'a', action: 'goto', value: '/' },
      { id: 'a', action: 'goto', value: '/cart' },
    ]);
    expect(issues(result)).toEqual(['1.id:step.duplicateId']);
  });

  it('reports manual steps for automated test cases', () => {
    expect(
      manualStepIssues([{ action: 'goto' }, { action: 'manual' }]).map((i) => i.path.join('.')),
    ).toEqual(['steps.1.action']);
  });

  it('creates short unique ids', () => {
    const ids = new Set(Array.from({ length: 200 }, newStepId));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{9}$/);
  });
});

describe('descriptions', () => {
  it('describes locators and actions', () => {
    expect(describeLocator({ strategy: 'role', value: 'button', name: 'Apply' })).toBe(
      'button "Apply"',
    );
    expect(describeLocator({ strategy: 'testId', value: 'total', nth: 1 })).toBe(
      'test id "total" (#2)',
    );
    expect(
      describeAction({
        action: 'fill',
        target: { strategy: 'label', value: 'Email' },
        value: 'ana@example.com',
      }),
    ).toBe('Fill label "Email" with "ana@example.com"');
    expect(describeAction({ action: 'press', value: 'Enter' })).toBe('Press Enter');
    expect(describeAction({ action: 'expectUrl', value: '/thanks' })).toBe(
      'Expect the URL to contain "/thanks"',
    );
  });

  it('prefers the written description', () => {
    const step: TestStep = { id: 'a', action: 'click', target: { strategy: 'text', value: 'Pay' } };
    expect(describeStep(step)).toBe('Click text "Pay"');
    expect(describeStep({ ...step, description: 'Pay the order' })).toBe('Pay the order');
  });
});

describe('variables', () => {
  it('extracts and substitutes placeholders', () => {
    expect(extractVariables('{{ code }} and {{code}} then {{user_1}}')).toEqual(['code', 'user_1']);
    expect(substituteVariables('Use {{code}} on {{site}}', { code: 'SAVE10' })).toEqual({
      text: 'Use SAVE10 on {{site}}',
      missing: ['site'],
    });
  });

  it('resolves values and locators of a step', () => {
    const { step, missing } = resolveStep(
      {
        id: 'a',
        action: 'fill',
        target: { strategy: 'role', value: 'textbox', name: '{{field}}' },
        value: '{{code}}-{{iteration}}',
      },
      { field: 'Coupon', code: 'SAVE10', iteration: '2' },
    );
    expect(missing).toEqual([]);
    expect(step.target).toEqual({ strategy: 'role', value: 'textbox', name: 'Coupon' });
    expect(step.value).toBe('SAVE10-2');
  });
});

describe('relativeToBaseUrl', () => {
  it('turns URLs on the base origin into origin-relative paths', () => {
    expect(relativeToBaseUrl('https://shop.test/cart?x=1#top', 'https://shop.test')).toBe(
      '/cart?x=1#top',
    );
    // A base URL with a path still resolves the path from the origin, like Playwright's baseURL.
    expect(relativeToBaseUrl('https://shop.test/app/login', 'https://shop.test/app')).toBe(
      '/app/login',
    );
  });

  it('keeps other URLs unchanged', () => {
    expect(relativeToBaseUrl('https://other.test/cart', 'https://shop.test')).toBe(
      'https://other.test/cart',
    );
    expect(relativeToBaseUrl('http://shop.test/cart', 'https://shop.test')).toBe(
      'http://shop.test/cart',
    );
    expect(relativeToBaseUrl('/cart', 'https://shop.test')).toBe('/cart');
    expect(relativeToBaseUrl('https://shop.test/cart', null)).toBe('https://shop.test/cart');
  });

  it('relativizes navigation and URL assertions only', () => {
    const steps: TestStep[] = [
      { id: 'a', action: 'goto', value: 'https://shop.test/login' },
      { id: 'b', action: 'expectUrl', value: 'https://shop.test/account' },
      { id: 'c', action: 'expectUrl', value: 'https://shop.test/' },
      {
        id: 'd',
        action: 'fill',
        target: { strategy: 'label', value: 'Site' },
        value: 'https://shop.test/x',
      },
    ];
    expect(relativizeSteps(steps, 'https://shop.test').map((step) => step.value)).toEqual([
      '/login',
      '/account',
      'https://shop.test/',
      'https://shop.test/x',
    ]);
    expect(relativizeSteps(steps, null)).toBe(steps);
  });
});
