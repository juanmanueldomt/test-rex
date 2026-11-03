import { Readable } from 'node:stream';
import { schema } from '@testrex/db';
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

const AUTOMATED = [
  { id: 'open', action: 'goto', value: '/cart' },
  { id: 'check', action: 'expectTitle', value: 'Cart' },
];
const MANUAL = [
  { id: 'm1', action: 'manual', description: 'Open the cart', expected: 'The cart is shown' },
  { id: 'm2', action: 'manual', description: 'Pay', expected: 'A receipt is printed' },
];

async function testCase(body: Record<string, unknown>) {
  const res = await team.editor.post(`${team.chk}/test-cases`, {
    scenarioIds: [checkout.id],
    steps: AUTOMATED,
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Loose;
}

async function startRun(body: Record<string, unknown>, client = team.tester) {
  const res = await client.post(`${team.chk}/runs`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Loose;
}

/** What the worker would write for an automated item. */
async function finishAutomated(
  runId: string,
  testCaseId: string,
  status: string,
  durationMs = 1200,
) {
  const failed = status === 'failed';
  const iteration = {
    index: 0,
    data: null,
    status,
    startedAt: null,
    finishedAt: null,
    durationMs,
    steps: [],
    hooks: [],
    ...(failed ? { error: { message: 'Expected title "Cart"', stepId: 'check' } } : {}),
    ariaSnapshot: '- heading "Basket"',
    url: 'https://shop.example.com/cart',
  };
  await harness.superPool.query(
    `UPDATE test_run_items SET status = $3::run_item_status, duration_ms = $4, started_at = now(),
            finished_at = now(), error = $5, failed_step_id = $6, iterations = $7::jsonb
      WHERE run_id = $1 AND test_case_id = $2`,
    [
      runId,
      testCaseId,
      status,
      durationMs,
      failed ? 'Expected title "Cart"' : null,
      failed ? 'check' : null,
      JSON.stringify([iteration]),
    ],
  );
  await harness.superPool.query(
    `UPDATE test_runs SET status = 'completed', started_at = now() - interval '5 seconds', finished_at = now()
      WHERE id = $1 AND NOT EXISTS (
        SELECT 1 FROM test_run_items WHERE run_id = $1 AND status IN ('queued', 'untested', 'running'))`,
    [runId],
  );
}

describe('creating runs', () => {
  it('selects scenarios and test cases once each, pins versions and sends the run to the worker', async () => {
    const tc1 = await testCase({ title: 'One' });
    const tc2 = await testCase({ title: 'Two', scenarioIds: [checkout.id, payment.id] });
    const tc3 = await testCase({ title: 'Three', scenarioIds: [payment.id] });
    const run = await startRun({ scenarioIds: [checkout.id], testCaseIds: [tc2.id, tc3.id] });
    expect(run).toMatchObject({
      key: 'CHK-TR-1',
      status: 'queued',
      browser: 'chromium',
      counts: { total: 3, queued: 3 },
      hasAutomated: true,
      hasManual: false,
      createdBy: { name: 'Tom Tester' },
    });
    expect(run.items.map((item: Loose) => item.testCase.key)).toEqual([
      'CHK-TC-1',
      'CHK-TC-2',
      'CHK-TC-3',
    ]);
    expect(run.items[1].scenarios.map((s: Loose) => s.key)).toEqual(['CHK-TS-1', 'CHK-TS-2']);
    expect(run.scenarios.map((s: Loose) => [s.scenario.key, s.counts.total])).toEqual([
      ['CHK-TS-1', 2],
      ['CHK-TS-2', 2],
    ]);
    expect(harness.jobs.sent).toEqual([
      {
        queue: 'runs.execute',
        payload: { organizationId: expect.any(String), runId: run.id },
      },
    ]);

    // Editing a test case afterwards does not change what the run executes.
    await team.editor.patch(`${team.chk}/test-cases/${tc1.key}`, { baseVersion: 1, steps: [] });
    const item = await team.viewer.get(`${team.chk}/runs/${run.key}/items/${run.items[0].id}`);
    expect(item.body.steps).toHaveLength(2);
    expect(item.body.version).toBe(1);
  });

  it('honours modes, skips deprecated and deleted test cases, rejects empty selections', async () => {
    await testCase({ title: 'Automated' });
    await testCase({ title: 'Manual', executionMode: 'manual', steps: MANUAL });
    const deprecated = await testCase({ title: 'Old', status: 'deprecated' });
    const deleted = await testCase({ title: 'Gone' });
    await team.editor.delete(`${team.chk}/test-cases/${deleted.key}`);

    const automatedOnly = await startRun({ scenarioIds: [checkout.id], modes: ['automated'] });
    expect(automatedOnly.items.map((item: Loose) => item.title)).toEqual(['Automated']);

    const explicit = await startRun({ testCaseIds: [deprecated.id, deleted.id] });
    expect(explicit.items.map((item: Loose) => item.title)).toEqual(['Old']);

    const empty = await team.tester.post(`${team.chk}/runs`, { testCaseIds: [deleted.id] });
    expect(empty.status).toBe(400);
    expect(empty.body.code).toBe('RUN_EMPTY');
    const none = await team.tester.post(`${team.chk}/runs`, {});
    expect(none.body.issues).toEqual([{ path: 'scenarioIds', message: 'run.selectionRequired' }]);
    expect(
      (await team.viewer.post(`${team.chk}/runs`, { scenarioIds: [checkout.id] })).status,
    ).toBe(403);
  });

  it('blocks items whose dataset has no rows and applies environment overrides', async () => {
    const dataset = await team.editor.post(`${team.chk}/datasets`, {
      name: 'Empty',
      columns: ['code'],
    });
    await testCase({ title: 'Coupons', datasetId: dataset.body.id });
    const run = await startRun({
      scenarioIds: [checkout.id],
      baseUrl: 'https://staging.example.com',
      browser: 'webkit',
    });
    expect(run).toMatchObject({
      status: 'completed',
      baseUrl: 'https://staging.example.com',
      browser: 'webkit',
      settings: { baseUrl: 'https://staging.example.com', browser: 'webkit' },
    });
    expect(run.items[0]).toMatchObject({
      status: 'blocked',
      error: 'Dataset "Empty" has no rows.',
    });
    expect(harness.jobs.sent).toEqual([]);
  });
});

describe('manual execution', () => {
  it('records step results, keeps a mixed run running and completes when everything is final', async () => {
    const manual = await testCase({ title: 'Receipt', executionMode: 'manual', steps: MANUAL });
    const automated = await testCase({ title: 'Cart' });
    const run = await startRun({ scenarioIds: [checkout.id] });
    const item = run.items.find((i: Loose) => i.testCase.id === manual.id);
    const url = `${team.chk}/runs/${run.key}/items/${item.id}/result`;

    const recorded = await team.tester.put(url, {
      iterations: [
        {
          index: 0,
          status: 'failed',
          steps: [
            { stepId: 'm1', status: 'passed' },
            { stepId: 'm2', status: 'failed', actual: 'No receipt' },
          ],
        },
      ],
      notes: 'Printer offline',
    });
    expect(recorded.status, JSON.stringify(recorded.body)).toBe(200);
    expect(recorded.body).toMatchObject({
      status: 'failed',
      error: 'No receipt',
      failedStep: { id: 'm2', index: 1, text: 'Pay' },
      executedBy: { name: 'Tom Tester' },
      notes: 'Printer offline',
    });
    expect(recorded.body.iterations[0].steps).toEqual([
      { stepId: 'm1', status: 'passed' },
      { stepId: 'm2', status: 'failed', actual: 'No receipt' },
    ]);
    expect((await team.viewer.get(`${team.chk}/runs/${run.key}`)).body.status).toBe('queued');

    const wrongItem = run.items.find((i: Loose) => i.testCase.id === automated.id);
    const notManual = await team.tester.put(
      `${team.chk}/runs/${run.key}/items/${wrongItem.id}/result`,
      {
        iterations: [{ index: 0, status: 'passed', steps: [] }],
      },
    );
    expect(notManual.body.code).toBe('ITEM_NOT_MANUAL');

    await finishAutomated(run.id, automated.id, 'passed');
    const done = await team.viewer.get(`${team.chk}/runs/${run.key}`);
    expect(done.body).toMatchObject({
      status: 'completed',
      counts: { passed: 1, failed: 1 },
      passRate: 0.5,
    });
    const closed = await team.tester.put(url, {
      iterations: [{ index: 0, status: 'passed', steps: [] }],
    });
    expect(closed.body.code).toBe('RUN_CLOSED');

    const [event] = (await team.owner.get(`/api/orgs/${team.slug}/audit?action=run_item.executed`))
      .body.events;
    expect(event.changes.status).toEqual({ from: 'untested', to: 'failed' });
  });

  it('requires one result per dataset row and known steps', async () => {
    const dataset = await team.editor.post(`${team.chk}/datasets`, {
      name: 'Users',
      columns: ['user'],
      rows: [['ana'], ['luis']],
    });
    await testCase({
      title: 'Login',
      executionMode: 'manual',
      steps: MANUAL,
      datasetId: dataset.body.id,
    });
    const run = await startRun({ scenarioIds: [checkout.id] });
    expect(run.status).toBe('running');
    const url = `${team.chk}/runs/${run.key}/items/${run.items[0].id}/result`;
    const one = await team.tester.put(url, {
      iterations: [{ index: 0, status: 'passed', steps: [] }],
    });
    expect(one.body.issues).toEqual([{ path: 'iterations', message: 'run.iterationsMismatch' }]);
    const unknown = await team.tester.put(url, {
      iterations: [
        { index: 0, status: 'passed', steps: [{ stepId: 'zzz', status: 'passed' }] },
        { index: 1, status: 'passed', steps: [] },
      ],
    });
    expect(unknown.body.issues).toEqual([
      { path: 'iterations.0.steps.0.stepId', message: 'run.unknownStep' },
    ]);
    const both = await team.tester.put(url, {
      iterations: [
        { index: 0, status: 'passed', steps: [] },
        { index: 1, status: 'skipped', steps: [] },
      ],
    });
    expect(both.body.status).toBe('passed');
    expect(both.body.iterations.map((i: Loose) => i.data)).toEqual([
      { user: 'ana' },
      { user: 'luis' },
    ]);
    expect((await team.viewer.get(`${team.chk}/runs/${run.key}`)).body.status).toBe('completed');
  });
});

describe('cancel, complete and re-run', () => {
  it('cancels a queued run and skips unfinished items', async () => {
    await testCase({ title: 'Cart' });
    const run = await startRun({ scenarioIds: [checkout.id] });
    const cancelled = await team.tester.post(`${team.chk}/runs/${run.key}/cancel`);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      counts: { skipped: 1 },
      cancelledBy: { name: 'Tom Tester' },
    });
    expect((await team.tester.post(`${team.chk}/runs/${run.key}/cancel`)).body.code).toBe(
      'RUN_CLOSED',
    );
  });

  it('completes a run only when automation is done; untested items become skipped', async () => {
    await testCase({ title: 'Receipt', executionMode: 'manual', steps: MANUAL });
    const automated = await testCase({ title: 'Cart' });
    const run = await startRun({ scenarioIds: [checkout.id] });
    const busy = await team.tester.post(`${team.chk}/runs/${run.key}/complete`);
    expect(busy.body.code).toBe('RUN_AUTOMATION_RUNNING');
    await finishAutomated(run.id, automated.id, 'failed');
    const completed = await team.tester.post(`${team.chk}/runs/${run.key}/complete`);
    expect(completed.body).toMatchObject({
      status: 'completed',
      counts: { failed: 1, skipped: 1 },
    });
  });

  it('re-runs only failed test cases', async () => {
    const a = await testCase({ title: 'A' });
    const b = await testCase({ title: 'B' });
    const run = await startRun({ scenarioIds: [checkout.id] });
    await finishAutomated(run.id, a.id, 'passed');
    await finishAutomated(run.id, b.id, 'failed');
    const rerun = await team.tester.post(`${team.chk}/runs/${run.key}/rerun`, { scope: 'failed' });
    expect(rerun.status).toBe(201);
    expect(rerun.body).toMatchObject({ key: 'CHK-TR-2', title: 'Re-run of CHK-TR-1 (failed)' });
    expect(rerun.body.items.map((item: Loose) => item.title)).toEqual(['B']);
  });
});

describe('reports and artifacts', () => {
  it('exports JSON and JUnit, serves artifacts of the run only', async () => {
    const a = await testCase({ title: 'Cart & checkout' });
    const run = await startRun({ scenarioIds: [checkout.id] });
    await finishAutomated(run.id, a.id, 'failed');

    const json = await team.viewer.get(`${team.chk}/runs/${run.key}/report.json`);
    expect(json.headers['content-disposition']).toContain('chk-tr-1-report.json');
    const report = JSON.parse(json.raw.toString());
    expect(report.items[0]).toMatchObject({ status: 'failed', failedStep: { index: 1 } });
    expect(report.items[0].iterations[0].ariaSnapshot).toBe('- heading "Basket"');

    const junit = await team.viewer.get(`${team.chk}/runs/${run.key}/junit.xml`);
    expect(junit.headers['content-type']).toContain('application/xml');
    expect(junit.raw.toString()).toContain('name="CHK-TC-1 · Cart &amp; checkout"');
    expect(junit.raw.toString()).toContain('<failure message="Expected title &quot;Cart&quot;"');

    const artifactId = schema.newId();
    const { rows } = await harness.superPool.query(
      `SELECT i.organization_id, r.application_id, i.id FROM test_run_items i JOIN test_runs r ON r.id = i.run_id WHERE i.run_id = $1`,
      [run.id],
    );
    const storageKey = `org/${rows[0].organization_id}/runs/${run.id}/${artifactId}`;
    await harness.services.storage.put(storageKey, Readable.from(Buffer.from('png-bytes')), {
      contentType: 'image/png',
    });
    await harness.superPool.query(
      `INSERT INTO run_artifacts (id, organization_id, application_id, run_id, item_id, kind, storage_key, content_type, size_bytes)
       VALUES ($1, $2, $3, $4, $5, 'screenshot', $6, 'image/png', 9)`,
      [artifactId, rows[0].organization_id, rows[0].application_id, run.id, rows[0].id, storageKey],
    );
    const file = await team.viewer.get(`${team.chk}/runs/${run.key}/artifacts/${artifactId}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect(file.raw.toString()).toBe('png-bytes');
    expect(
      (await team.editor.get(`${team.pay}/runs/${run.key}/artifacts/${artifactId}`)).status,
    ).toBe(404);
  });

  it('global report: totals, trend, failing, flaky, slowest and scenario health', async () => {
    const stable = await testCase({ title: 'Stable' });
    const flaky = await testCase({ title: 'Flaky', scenarioIds: [payment.id] });
    for (const status of ['passed', 'failed', 'passed']) {
      const run = await startRun({ testCaseIds: [stable.id, flaky.id] });
      await finishAutomated(run.id, stable.id, 'passed', 800);
      await finishAutomated(run.id, flaky.id, status, 3000);
    }
    const cancelled = await startRun({ testCaseIds: [stable.id] });
    await team.tester.post(`${team.chk}/runs/${cancelled.key}/cancel`);

    const report = await team.viewer.get(`${team.chk}/reports/overview?days=30`);
    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({
      days: 30,
      runs: 4,
      runsByStatus: { completed: 3, cancelled: 1 },
      counts: { total: 6, passed: 5, failed: 1 },
    });
    expect(report.body.passRate).toBeCloseTo(5 / 6);
    expect(report.body.trend.map((p: Loose) => p.runKey)).toEqual([
      'CHK-TR-1',
      'CHK-TR-2',
      'CHK-TR-3',
    ]);
    expect(report.body.mostFailing.map((h: Loose) => [h.testCase.key, h.failures])).toEqual([
      ['CHK-TC-2', 1],
    ]);
    expect(report.body.flaky.map((h: Loose) => [h.testCase.key, h.passes, h.failures])).toEqual([
      ['CHK-TC-2', 2, 1],
    ]);
    expect(report.body.slowest[0]).toMatchObject({
      testCase: { key: 'CHK-TC-2' },
      averageDurationMs: 3000,
    });
    expect(report.body.scenarios.map((s: Loose) => [s.scenario.key, s.executed, s.passed])).toEqual(
      [
        ['CHK-TS-2', 3, 2],
        ['CHK-TS-1', 3, 3],
      ],
    );
    const lastResult = (await team.viewer.get(`${team.chk}/test-cases/${flaky.key}`)).body
      .lastResult;
    expect(lastResult).toMatchObject({ status: 'passed', runKey: 'CHK-TR-3' });
    expect((await team.viewer.get(`${team.chk}/reports/overview?days=12`)).status).toBe(400);
  });
});
