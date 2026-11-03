import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LlmError, type LlmProvider, type ProviderConfig } from './services/llm/providers';
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

/** A provider that answers with the queued responses and records what it was asked. */
const calls: { config: ProviderConfig; prompt: string; system: string }[] = [];
let answers: unknown[] = [];
let failure: LlmError | null = null;

function fakeProvider(config: ProviderConfig): LlmProvider {
  return {
    model: config.model,
    async generate({ prompt, system, schema }) {
      calls.push({ config, prompt, system });
      if (failure) throw failure;
      return schema.parse(answers.shift());
    },
    async test() {
      if (failure) throw failure;
      return `Fake ${config.model}`;
    },
  };
}

const wireStep = (overrides: Record<string, unknown>) => ({
  id: '',
  action: 'goto',
  target: null,
  value: '/',
  description: '',
  expected: '',
  ...overrides,
});

const wireCase = (title: string, steps: unknown[]) => ({
  title,
  priority: 'high',
  description: 'Generated',
  preconditions: '',
  tags: ['smoke', 'not valid!'],
  steps,
});

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await harness?.close();
  await container?.stop();
});

beforeEach(async () => {
  await harness?.close();
  calls.length = 0;
  answers = [];
  failure = null;
  harness = await createHarness(container, { llm: fakeProvider });
  team = await scenarioTeam(harness);
  checkout = (
    await team.editor.post(`${team.chk}/scenarios`, {
      title: 'Guest checkout',
      description: 'A guest buys a book and applies coupon **SAVE10**.',
    })
  ).body;
});

async function configure(body: Record<string, unknown> = {}) {
  const res = await team.owner.put(`/api/orgs/${team.slug}/llm`, {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    apiKey: 'sk-ant-secret-key-123',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Loose;
}

describe('LLM settings', () => {
  it('stores the key encrypted and never returns or audits it', async () => {
    const saved = await configure();
    expect(saved).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      baseUrl: null,
      hasKey: true,
    });
    expect(JSON.stringify(saved)).not.toContain('sk-ant');
    const { rows } = await harness.superPool.query('SELECT api_key_encrypted FROM llm_settings');
    expect(rows[0].api_key_encrypted).toMatch(/^v1:/);
    expect(rows[0].api_key_encrypted).not.toContain('secret');

    // Changing the model keeps the key.
    const kept = await configure({ model: 'claude-sonnet-5-5', apiKey: undefined });
    expect(kept.hasKey).toBe(true);
    const audit = await team.owner.get(`/api/orgs/${team.slug}/audit?action=llm.settings_updated`);
    expect(JSON.stringify(audit.body)).not.toContain('sk-ant');
    expect(audit.body.events[1].changes.apiKey).toEqual({ from: null, to: 'replaced' });

    expect((await team.editor.get(`/api/orgs/${team.slug}/llm`)).status).toBe(403);
    expect((await team.editor.get(`/api/orgs/${team.slug}/llm/status`)).body).toEqual({
      configured: true,
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
    });
  });

  it('validates provider settings and tests the connection', async () => {
    const missing = await team.owner.put(`/api/orgs/${team.slug}/llm`, {
      provider: 'openai_compatible',
      model: 'llama3.1',
    });
    expect(missing.body.issues).toEqual([{ path: 'baseUrl', message: 'llm.baseUrlRequired' }]);
    const noKey = await team.owner.put(`/api/orgs/${team.slug}/llm`, {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
    });
    expect(noKey.body.issues).toEqual([{ path: 'apiKey', message: 'llm.keyRequired' }]);
    await configure({
      provider: 'openai_compatible',
      model: 'llama3.1',
      baseUrl: 'http://ollama:11434/v1',
      apiKey: undefined,
    });

    const ok = await team.owner.post(`/api/orgs/${team.slug}/llm/test`);
    expect(ok.body).toEqual({ ok: true, model: 'llama3.1', message: 'Fake llama3.1' });
    expect(calls).toEqual([]);
    failure = new LlmError('AI_AUTH', 'The provider rejected the credentials.');
    const rejected = await team.owner.post(`/api/orgs/${team.slug}/llm/test`);
    expect(rejected.body).toEqual({
      ok: false,
      model: 'llama3.1',
      message: 'The provider rejected the credentials.',
    });
  });
});

describe('AI assistance', () => {
  it('answers AI_NOT_CONFIGURED without a provider', async () => {
    const res = await team.editor.post(`${team.chk}/ai/test-cases/generate`, {
      scenarioId: checkout.id,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('AI_NOT_CONFIGURED');
  });

  it('generates proposals from the scenario and drops invalid steps with issues', async () => {
    await configure();
    answers = [
      {
        testCases: [
          wireCase('Apply SAVE10', [
            wireStep({ value: '/cart' }),
            wireStep({
              action: 'fill',
              target: { strategy: 'label', value: 'Coupon', name: '', exact: false, nth: null },
              value: 'SAVE10',
            }),
            wireStep({ action: 'click', target: null, value: '' }),
            wireStep({ action: 'manual', description: 'Look' }),
            wireStep({
              action: 'expectText',
              target: { strategy: 'testId', value: 'total', name: '', exact: false, nth: null },
              value: '-10%',
              expected: 'The discount is shown',
            }),
          ]),
        ],
      },
    ];
    const res = await team.editor.post(`${team.chk}/ai/test-cases/generate`, {
      scenarioId: checkout.id,
      count: 1,
      instructions: 'Focus on coupons',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [proposal] = res.body.proposals;
    expect(proposal).toMatchObject({
      title: 'Apply SAVE10',
      priority: 'high',
      executionMode: 'automated',
      tags: ['smoke'],
    });
    expect(proposal.steps.map((s: Loose) => s.action)).toEqual(['goto', 'fill', 'expectText']);
    expect(proposal.issues).toEqual([
      'Step 3 (click) was dropped: step.targetRequired.',
      'Step 4 (manual) was dropped: automated test cases cannot have manual steps.',
      'Tag "not valid!" was dropped: invalid tag.',
    ]);
    expect(calls[0]!.config).toMatchObject({
      provider: 'anthropic',
      apiKey: 'sk-ant-secret-key-123',
    });
    expect(calls[0]!.prompt).toContain('coupon **SAVE10**');
    expect(calls[0]!.prompt).toContain('Focus on coupons');
    expect(
      (await team.tester.post(`${team.chk}/ai/test-cases/generate`, { scenarioId: checkout.id }))
        .status,
    ).toBe(403);
  });

  it('revises a test case keeping the ids of steps it keeps', async () => {
    await configure();
    const created = await team.editor.post(`${team.chk}/test-cases`, {
      title: 'Coupon',
      scenarioIds: [checkout.id],
      steps: [
        { id: 'open', action: 'goto', value: '/cart' },
        {
          id: 'apply',
          action: 'click',
          target: { strategy: 'role', value: 'button', name: 'Apply' },
        },
      ],
    });
    answers = [
      {
        summary: 'Added a check of the total.',
        testCase: wireCase('Coupon', [
          wireStep({ id: 'open', value: '/cart' }),
          wireStep({
            id: 'apply',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Apply', exact: false, nth: null },
            value: '',
          }),
          wireStep({ id: 'made-up', action: 'expectTitle', value: 'Cart' }),
        ]),
      },
    ];
    const res = await team.editor.post(`${team.chk}/ai/test-cases/${created.body.key}/revise`, {
      instructions: 'Check the page title',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ summary: 'Added a check of the total.', baseVersion: 1 });
    const ids = res.body.proposal.steps.map((s: Loose) => s.id);
    expect(ids.slice(0, 2)).toEqual(['open', 'apply']);
    expect(ids[2]).not.toBe('made-up');
    expect(calls[0]!.prompt).toContain('Check the page title');
  });

  it('fixes a failed automated item with its failure context; provider errors are 502', async () => {
    await configure();
    const created = await team.editor.post(`${team.chk}/test-cases`, {
      title: 'Pay',
      scenarioIds: [checkout.id],
      steps: [
        { id: 'pay', action: 'click', target: { strategy: 'role', value: 'button', name: 'Pay' } },
      ],
    });
    const run = (await team.tester.post(`${team.chk}/runs`, { testCaseIds: [created.body.id] }))
      .body;
    const notFailed = await team.editor.post(
      `${team.chk}/ai/runs/${run.key}/items/${run.items[0].id}/fix`,
      {},
    );
    expect(notFailed.body.code).toBe('ITEM_NOT_FAILED');
    await harness.superPool.query(
      `UPDATE test_run_items SET status = 'failed', error = 'Timeout waiting for button "Pay"',
              iterations = $2::jsonb WHERE id = $1`,
      [
        run.items[0].id,
        JSON.stringify([
          {
            index: 0,
            data: null,
            status: 'failed',
            startedAt: null,
            finishedAt: null,
            durationMs: 10000,
            steps: [{ stepId: 'pay', status: 'failed', error: 'Timeout' }],
            hooks: [],
            error: { message: 'Timeout waiting for button "Pay"', stepId: 'pay' },
            url: 'https://shop.example.com/checkout',
            ariaSnapshot: '- button "Pay now"',
            consoleErrors: [],
          },
        ]),
      ],
    );
    answers = [
      {
        summary: 'The button is now named "Pay now".',
        testCase: wireCase('Pay', [
          wireStep({
            id: 'pay',
            action: 'click',
            target: { strategy: 'role', value: 'button', name: 'Pay now', exact: false, nth: null },
            value: '',
          }),
        ]),
      },
    ];
    const fixed = await team.editor.post(
      `${team.chk}/ai/runs/${run.key}/items/${run.items[0].id}/fix`,
      {},
    );
    expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
    expect(fixed.body.proposal.steps[0]).toMatchObject({
      id: 'pay',
      target: { strategy: 'role', value: 'button', name: 'Pay now' },
    });
    expect(calls[0]!.prompt).toContain('- button "Pay now"');
    expect(calls[0]!.prompt).toContain('Failed step: 1. Click button "Pay"');

    failure = new LlmError('AI_AUTH', 'The provider rejected the credentials.');
    const upstream = await team.editor.post(
      `${team.chk}/ai/runs/${run.key}/items/${run.items[0].id}/fix`,
      {},
    );
    expect(upstream.status).toBe(502);
    expect(upstream.body.code).toBe('AI_AUTH');
  });
});
