import { describe, expect, it } from 'vitest';
import { DEFAULT_AUTOMATION_SETTINGS } from './automation';
import {
  aggregateStatus,
  countStatuses,
  createRunSchema,
  junitXml,
  manualResultSchema,
  passRate,
  type RunReport,
} from './runs';

describe('aggregation', () => {
  it('takes the worst iteration result', () => {
    expect(aggregateStatus(['passed', 'failed', 'passed'])).toBe('failed');
    expect(aggregateStatus(['passed', 'blocked'])).toBe('blocked');
    expect(aggregateStatus(['passed', 'untested'])).toBe('untested');
    expect(aggregateStatus(['skipped', 'skipped'])).toBe('skipped');
    expect(aggregateStatus(['skipped', 'passed'])).toBe('passed');
    expect(aggregateStatus([])).toBe('skipped');
  });

  it('counts statuses and computes the pass rate over executed items', () => {
    const counts = countStatuses(['passed', 'passed', 'failed', 'skipped', 'untested']);
    expect(counts).toMatchObject({ total: 5, passed: 2, failed: 1, skipped: 1, untested: 1 });
    expect(passRate(counts)).toBeCloseTo(2 / 3);
    expect(passRate(countStatuses(['skipped']))).toBeNull();
  });
});

describe('request schemas', () => {
  it('requires a selection and at least one mode', () => {
    expect(createRunSchema.safeParse({}).error?.issues.map((i) => i.message)).toEqual([
      'run.selectionRequired',
    ]);
    const parsed = createRunSchema.parse({
      testCaseIds: ['0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b'],
      baseUrl: ' ',
    });
    expect(parsed.modes).toEqual(['automated', 'manual']);
    expect(parsed.baseUrl).toBeUndefined();
    expect(
      createRunSchema.safeParse({
        testCaseIds: ['0190a3b2-7c4d-7e8f-9a0b-1c2d3e4f5a6b'],
        baseUrl: 'ftp://example.com',
      }).success,
    ).toBe(false);
  });

  it('accepts manual results per iteration', () => {
    const value = manualResultSchema.parse({
      iterations: [
        { index: 0, status: 'failed', steps: [{ stepId: 'a', status: 'failed', actual: ' No ' }] },
      ],
      notes: '',
    });
    expect(value.iterations[0]!.steps[0]!.actual).toBe('No');
    expect(value.notes).toBeUndefined();
  });
});

describe('junitXml', () => {
  it('writes one test case per item with escaped failures', () => {
    const report = {
      id: 'r',
      key: 'CHK-TR-5',
      number: 5,
      title: 'Nightly <smoke>',
      status: 'completed',
      baseUrl: 'https://shop.example.com',
      browser: 'chromium',
      counts: countStatuses(['passed', 'failed', 'skipped']),
      passRate: 0.5,
      durationMs: 4200,
      createdBy: { id: null, name: 'Ana' },
      createdAt: '2026-11-01T10:00:00.000Z',
      startedAt: '2026-11-01T10:00:01.000Z',
      finishedAt: '2026-11-01T10:00:05.200Z',
      hasAutomated: true,
      hasManual: false,
      settings: DEFAULT_AUTOMATION_SETTINGS,
      hooks: [],
      hookResults: [],
      scenarios: [],
      cancelledBy: null,
      error: null,
      generatedAt: '2026-11-01T10:01:00.000Z',
      items: [
        {
          id: 'i1',
          position: 0,
          testCase: { id: 't1', key: 'CHK-TC-1', deleted: false },
          title: 'Pay & leave',
          version: 2,
          executionMode: 'automated',
          scenarios: [{ id: 's', key: 'CHK-TS-1', title: 'Checkout', deleted: false }],
          status: 'failed',
          iterationCount: 1,
          durationMs: 1500,
          startedAt: null,
          finishedAt: null,
          error: 'Expected "Paid" but got "Pending"',
          failedStep: null,
          executedBy: null,
          steps: [
            {
              id: 'x',
              action: 'expectText',
              target: { strategy: 'text', value: 'Status' },
              value: 'Paid',
            },
          ],
          dataset: null,
          notes: null,
          iterations: [
            {
              index: 0,
              data: null,
              status: 'failed',
              startedAt: null,
              finishedAt: null,
              durationMs: 1500,
              steps: [],
              hooks: [],
              error: { message: 'Expected "Paid" but got "Pending"', stepId: 'x' },
            },
          ],
        },
        {
          id: 'i2',
          position: 1,
          testCase: { id: 't2', key: 'CHK-TC-2', deleted: false },
          title: 'Skip me',
          version: 1,
          executionMode: 'manual',
          scenarios: [],
          status: 'skipped',
          iterationCount: 1,
          durationMs: null,
          startedAt: null,
          finishedAt: null,
          error: null,
          failedStep: null,
          executedBy: null,
          steps: [],
          dataset: null,
          notes: null,
          iterations: [],
        },
      ],
    } satisfies RunReport;
    const xml = junitXml(report);
    expect(xml).toContain(
      '<testsuites name="CHK-TR-5" tests="2" failures="1" skipped="1" time="4.200">',
    );
    expect(xml).toContain('name="CHK-TR-5 · Nightly &lt;smoke&gt;"');
    expect(xml).toContain(
      '<testcase classname="CHK-TS-1" name="CHK-TC-1 · Pay &amp; leave" time="1.500">',
    );
    expect(xml).toContain(
      '<failure message="Expected &quot;Paid&quot; but got &quot;Pending&quot;" type="failure">',
    );
    expect(xml).toContain('Step: Expect text &quot;Status&quot; to contain &quot;Paid&quot;');
    expect(xml).toContain('<skipped message="skipped"/>');
  });
});
