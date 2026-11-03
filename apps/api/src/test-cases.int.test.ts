import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  scenarioTeam,
  type Harness,
  type Loose,
  type ScenarioTeam,
} from './testing/harness';

let container: StartedPostgreSqlContainer;
let harness: Harness;
let team: ScenarioTeam;
let checkout: Loose;
let payment: Loose;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await harness?.close();
  await container?.stop();
});

beforeEach(async () => {
  await harness?.close();
  harness = await createHarness(container);
  team = await scenarioTeam(harness);
  checkout = (await team.editor.post(`${team.chk}/scenarios`, { title: 'Checkout' })).body;
  payment = (await team.editor.post(`${team.chk}/scenarios`, { title: 'Payment' })).body;
});

const STEPS = [
  { id: 'open', action: 'goto', value: '/cart' },
  {
    id: 'apply',
    action: 'click',
    target: { strategy: 'role', value: 'button', name: 'Apply' },
    description: 'Apply the coupon',
  },
  {
    id: 'check',
    action: 'expectText',
    target: { strategy: 'testId', value: 'total' },
    value: '90',
    expected: 'The discount is applied',
  },
];

async function createTestCase(body: Record<string, unknown>, client = team.editor) {
  const res = await client.post(`${team.chk}/test-cases`, {
    scenarioIds: [checkout.id],
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Loose;
}

async function auditEvents(action: string) {
  const res = await team.owner.get(`/api/orgs/${team.slug}/audit?action=${action}`);
  return res.body.events as Loose[];
}

describe('creating test cases', () => {
  it('Create a test case: draft, medium, automated, v1, linked to its scenario', async () => {
    const testCase = await createTestCase({
      title: 'Apply a valid coupon',
      tags: ['smoke'],
      steps: STEPS,
    });
    expect(testCase).toMatchObject({
      key: 'CHK-TC-1',
      title: 'Apply a valid coupon',
      status: 'draft',
      priority: 'medium',
      executionMode: 'automated',
      version: 1,
      stepCount: 3,
      tags: ['smoke'],
      scenarios: [{ id: checkout.id, key: 'CHK-TS-1', title: 'Checkout', deleted: false }],
      dataset: null,
      lastResult: null,
      author: { id: team.editor.user!.id, name: 'Ana Editor' },
    });
    expect(testCase.steps).toEqual(STEPS);
    const [event] = await auditEvents('test_case.created');
    expect(event).toMatchObject({
      target: { type: 'test_case', label: 'CHK-TC-1 · Apply a valid coupon' },
      changes: { steps: { from: null, to: 'v1' }, scenarios: { from: null, to: ['CHK-TS-1'] } },
    });
  });

  it('Title required and at least one scenario of the same application', async () => {
    const noTitle = await team.editor.post(`${team.chk}/test-cases`, {
      title: ' ',
      scenarioIds: [checkout.id],
    });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.issues).toEqual([{ path: 'title', message: 'title.required' }]);

    const noScenario = await team.editor.post(`${team.chk}/test-cases`, {
      title: 'x',
      scenarioIds: [],
    });
    expect(noScenario.body.issues).toEqual([
      { path: 'scenarioIds', message: 'scenarios.required' },
    ]);

    const other = (await team.editor.post(`${team.pay}/scenarios`, { title: 'Refunds' })).body;
    const foreign = await team.editor.post(`${team.chk}/test-cases`, {
      title: 'x',
      scenarioIds: [other.id],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.code).toBe('SCENARIO_NOT_FOUND');
  });

  it('Manual-only step in an automated test case is rejected; manual mode accepts it', async () => {
    const steps = [{ id: 'look', action: 'manual', description: 'Look at the receipt' }];
    const automated = await team.editor.post(`${team.chk}/test-cases`, {
      title: 'Receipt',
      scenarioIds: [checkout.id],
      steps,
    });
    expect(automated.status).toBe(400);
    expect(automated.body.issues).toEqual([
      { path: 'steps.0.action', message: 'step.manualInAutomated' },
    ]);
    const manual = await createTestCase({ title: 'Receipt', executionMode: 'manual', steps });
    expect(manual.executionMode).toBe('manual');
  });

  it('One test case, two scenarios: both count it, deleted test cases are not counted', async () => {
    const testCase = await createTestCase({
      title: 'Pay with card',
      scenarioIds: [checkout.id, payment.id],
    });
    expect(testCase.scenarios.map((s: Loose) => s.key)).toEqual(['CHK-TS-1', 'CHK-TS-2']);
    const list = await team.viewer.get(`${team.chk}/scenarios`);
    expect(list.body.items.map((s: Loose) => [s.key, s.testCaseCount])).toEqual([
      ['CHK-TS-2', 1],
      ['CHK-TS-1', 1],
    ]);
    await team.editor.delete(`${team.chk}/test-cases/${testCase.key}`);
    const scenario = await team.viewer.get(`${team.chk}/scenarios/CHK-TS-1`);
    expect(scenario.body.testCaseCount).toBe(0);
  });
});

describe('editing test cases', () => {
  it('Version history, no-op saves and restoring a version', async () => {
    const created = await createTestCase({ title: 'Coupon', steps: STEPS });
    const url = `${team.chk}/test-cases/${created.key}`;
    const v2 = await team.editor.patch(url, { baseVersion: 1, title: 'Coupon v2' });
    expect(v2.body.version).toBe(2);
    const same = await team.editor.patch(url, { baseVersion: 2, title: 'Coupon v2' });
    expect(same.body.version).toBe(2);
    const v3 = await team.editor.patch(url, {
      baseVersion: 2,
      steps: STEPS.slice(0, 2),
      source: 'ai',
    });
    expect(v3.body.version).toBe(3);
    const v4 = await team.editor.patch(url, {
      baseVersion: 3,
      priority: 'high',
      scenarioIds: [checkout.id, payment.id],
    });
    expect(v4.body.version).toBe(4);

    const history = await team.viewer.get(`${url}/versions`);
    expect(history.body.map((v: Loose) => [v.number, v.source, v.changedFields])).toEqual([
      [4, 'editor', ['priority', 'scenarios']],
      [3, 'ai', ['steps']],
      [2, 'editor', ['title']],
      [1, 'editor', []],
    ]);
    const v2view = await team.viewer.get(`${url}/versions/2`);
    expect(v2view.body).toMatchObject({ number: 2, title: 'Coupon v2', latest: 4 });
    expect(v2view.body.steps).toHaveLength(3);

    const restored = await team.editor.post(`${url}/versions/2/restore`, { baseVersion: 4 });
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ version: 5, priority: 'medium', stepCount: 3 });
    const latest = (await team.viewer.get(`${url}/versions`)).body[0];
    expect(latest).toMatchObject({ number: 5, source: 'restore', restoredFrom: 2 });
    const [event] = await auditEvents('test_case.version_restored');
    expect(event.changes.version).toEqual({ from: 'v2', to: 'v5' });
  });

  it('Conflicting edit: the second save is rejected naming who changed it', async () => {
    const created = await createTestCase({ title: 'Coupon' });
    const url = `${team.chk}/test-cases/${created.key}`;
    expect((await team.editor.patch(url, { baseVersion: 1, title: 'Ana' })).status).toBe(200);
    const luis = await team.editor2.patch(url, { baseVersion: 1, title: 'Luis' });
    expect(luis.status).toBe(409);
    expect(luis.body).toMatchObject({
      code: 'TEST_CASE_CHANGED',
      latestVersion: 2,
      changedBy: 'Ana Editor',
    });
  });

  it('Delete and restore', async () => {
    const created = await createTestCase({ title: 'Coupon' });
    const url = `${team.chk}/test-cases/${created.key}`;
    const deleted = await team.editor.delete(url);
    expect(deleted.body.deletedAt).not.toBeNull();
    expect((await team.viewer.get(`${team.chk}/test-cases`)).body.total).toBe(0);
    expect((await team.viewer.get(url)).body.deletedBy.name).toBe('Ana Editor');
    expect((await team.editor.patch(url, { baseVersion: 1, title: 'x' })).body.code).toBe(
      'TEST_CASE_DELETED',
    );
    const restored = await team.editor.post(`${url}/restore`);
    expect(restored.body.deletedAt).toBeNull();
    expect((await team.viewer.get(`${team.chk}/test-cases`)).body.total).toBe(1);
  });

  it('Permissions: testers cannot edit, viewers read, other applications answer 404', async () => {
    const created = await createTestCase({ title: 'Coupon' });
    const url = `${team.chk}/test-cases/${created.key}`;
    expect((await team.tester.patch(url, { baseVersion: 1, title: 'x' })).status).toBe(403);
    expect((await team.viewer.get(url)).status).toBe(200);
    expect((await team.editor.get(`${team.pay}/test-cases/${created.key}`)).status).toBe(404);
    expect((await team.editor.get(`${team.pay}/test-cases/1`)).status).toBe(404);
  });
});

describe('catalog', () => {
  it('filters by scenario and mode, searches by key and step text', async () => {
    await createTestCase({ title: 'Automated checkout', steps: STEPS });
    await createTestCase({
      title: 'Manual checkout',
      executionMode: 'manual',
      steps: [{ id: 'a', action: 'manual', description: 'Pay at the counter' }],
    });
    await createTestCase({ title: 'Payment', scenarioIds: [payment.id] });
    const manual = await team.viewer.get(
      `${team.chk}/test-cases?scenario=${checkout.id}&mode=manual`,
    );
    expect(manual.body.items.map((t: Loose) => t.key)).toEqual(['CHK-TC-2']);
    const byKey = await team.viewer.get(`${team.chk}/test-cases?q=CHK-TC-3`);
    expect(byKey.body.items[0].key).toBe('CHK-TC-3');
    const byStep = await team.viewer.get(`${team.chk}/test-cases?q=counter`);
    expect(byStep.body.items.map((t: Loose) => t.key)).toEqual(['CHK-TC-2']);
    const sorted = await team.viewer.get(`${team.chk}/test-cases?sort=title`);
    expect(sorted.body.items.map((t: Loose) => t.title)).toEqual([
      'Automated checkout',
      'Manual checkout',
      'Payment',
    ]);
  });

  it('generates Playwright code for a test case and a scenario', async () => {
    await team.editor.put(`${team.chk}/automation`, {
      baseUrl: 'https://shop.example.com',
      browser: 'chromium',
      viewportWidth: 1280,
      viewportHeight: 720,
      actionTimeoutMs: 10000,
      navigationTimeoutMs: 30000,
      assertionTimeoutMs: 5000,
      traceOnFailure: true,
      videoOnFailure: false,
    });
    await team.editor.post(`${team.chk}/global-steps`, {
      name: 'Accept cookies',
      phase: 'beforeEach',
      steps: [{ id: 'c', action: 'click', target: { strategy: 'text', value: 'Accept' } }],
    });
    const created = await createTestCase({ title: 'Coupon', tags: ['smoke'], steps: STEPS });
    const code = await team.viewer.get(`${team.chk}/test-cases/${created.key}/playwright`);
    expect(code.body.fileName).toBe('chk-tc-1.spec.ts');
    expect(code.body.code).toContain("const BASE_URL = 'https://shop.example.com';");
    expect(code.body.code).toContain("await page.getByText('Accept').click();");
    expect(code.body.code).toContain("test('CHK-TC-1 · Coupon', { tag: ['@smoke'] }");
    const scenarioCode = await team.viewer.get(`${team.chk}/scenarios/CHK-TS-1/playwright`);
    expect(scenarioCode.body.code).toContain("test.describe('CHK-TS-1 · Checkout'");
  });
});

describe('datasets', () => {
  it('create, unique names, column rules, use in test cases and protection while in use', async () => {
    const created = await team.editor.post(`${team.chk}/datasets`, {
      name: 'Coupons',
      columns: ['code', 'discount'],
      rows: [
        ['SAVE10', '10'],
        ['VIP', '25'],
      ],
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Coupons', rowCount: 2, testCaseCount: 0 });
    const duplicate = await team.editor.post(`${team.chk}/datasets`, {
      name: 'coupons',
      columns: ['x'],
    });
    expect(duplicate.body.code).toBe('DATASET_EXISTS');
    const invalid = await team.editor.post(`${team.chk}/datasets`, {
      name: 'Bad',
      columns: ['first name'],
    });
    expect(invalid.body.issues).toEqual([{ path: 'columns.0', message: 'dataset.columnInvalid' }]);

    const testCase = await createTestCase({ title: 'Coupon', datasetId: created.body.id });
    expect(testCase.dataset).toEqual({ id: created.body.id, name: 'Coupons' });
    const list = await team.viewer.get(`${team.chk}/datasets`);
    expect(list.body[0].testCaseCount).toBe(1);

    const inUse = await team.editor.delete(`${team.chk}/datasets/${created.body.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body).toMatchObject({ code: 'DATASET_IN_USE', testCaseCount: 1 });
    await team.editor.patch(`${team.chk}/test-cases/${testCase.key}`, {
      baseVersion: 1,
      datasetId: null,
    });
    expect((await team.editor.delete(`${team.chk}/datasets/${created.body.id}`)).status).toBe(204);
    expect((await team.viewer.get(`${team.chk}/datasets`)).body).toEqual([]);
    expect(
      (await team.tester.post(`${team.chk}/datasets`, { name: 'x', columns: ['a'] })).status,
    ).toBe(403);
    expect((await auditEvents('dataset.deleted')).length).toBe(1);
  });
});

describe('automation', () => {
  it('settings default, update and audit', async () => {
    const defaults = await team.viewer.get(`${team.chk}/automation`);
    expect(defaults.body).toMatchObject({ baseUrl: null, browser: 'chromium', updatedAt: null });
    const saved = await team.editor.put(`${team.chk}/automation`, {
      ...defaults.body,
      baseUrl: 'https://staging.example.com',
      browser: 'firefox',
    });
    expect(saved.body).toMatchObject({
      baseUrl: 'https://staging.example.com',
      browser: 'firefox',
    });
    const [event] = await auditEvents('automation.updated');
    expect(event.changes.browser).toEqual({ from: 'chromium', to: 'firefox' });
    const invalid = await team.editor.put(`${team.chk}/automation`, {
      ...defaults.body,
      viewportWidth: 10,
    });
    expect(invalid.status).toBe(400);
  });

  it('global steps: phases, order, no manual steps, permissions', async () => {
    const step = [{ id: 'a', action: 'goto', value: '/' }];
    const first = await team.editor.post(`${team.chk}/global-steps`, {
      name: 'Open home',
      phase: 'beforeEach',
      steps: step,
    });
    const second = await team.editor.post(`${team.chk}/global-steps`, {
      name: 'Sign in',
      phase: 'beforeRun',
      steps: step,
    });
    const third = await team.editor.post(`${team.chk}/global-steps`, {
      name: 'Close banner',
      phase: 'beforeEach',
      steps: step,
    });
    expect([first.status, second.status, third.status]).toEqual([201, 201, 201]);
    const list = await team.viewer.get(`${team.chk}/global-steps`);
    expect(list.body.map((g: Loose) => [g.phase, g.name])).toEqual([
      ['beforeRun', 'Sign in'],
      ['beforeEach', 'Open home'],
      ['beforeEach', 'Close banner'],
    ]);
    await team.editor.patch(`${team.chk}/global-steps/${third.body.id}`, { position: 0 });
    const reordered = await team.viewer.get(`${team.chk}/global-steps`);
    expect(reordered.body.map((g: Loose) => g.name)).toEqual([
      'Sign in',
      'Close banner',
      'Open home',
    ]);

    const manual = await team.editor.post(`${team.chk}/global-steps`, {
      name: 'Coffee',
      phase: 'afterRun',
      steps: [{ id: 'm', action: 'manual', description: 'Make coffee' }],
    });
    expect(manual.body.issues).toEqual([
      { path: 'steps.0.action', message: 'step.manualInGlobalStep' },
    ]);
    expect(
      (
        await team.tester.post(`${team.chk}/global-steps`, {
          name: 'x',
          phase: 'afterRun',
          steps: step,
        })
      ).status,
    ).toBe(403);
    expect((await team.editor.delete(`${team.chk}/global-steps/${first.body.id}`)).status).toBe(
      204,
    );
    expect((await team.viewer.get(`${team.chk}/global-steps`)).body).toHaveLength(2);
  });
});
