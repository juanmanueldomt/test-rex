import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createHarness,
  createOrg,
  scenarioTeam,
  signedUp,
  type Harness,
  type Loose,
  type ScenarioTeam,
} from './testing/harness';

let container: StartedPostgreSqlContainer;
let harness: Harness;
let team: ScenarioTeam;

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
});

async function createModule(name: string, base = team.chk) {
  const res = await team.editor.post(`${base}/modules`, { name });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; name: string };
}

async function createScenario(body: Record<string, unknown>, base = team.chk) {
  const res = await team.editor.post(`${base}/scenarios`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Loose;
}

async function auditEvents(action?: string) {
  const res = await team.owner.get(
    `/api/orgs/${team.slug}/audit${action ? `?action=${action}` : ''}`,
  );
  return res.body.events as Loose[];
}

describe('creating scenarios', () => {
  it('Create a scenario: draft, medium priority, the editor as author, key CHK-TS-1', async () => {
    const checkout = await createModule('Checkout');
    const scenario = await createScenario({
      title: 'Guest checkout with coupon',
      moduleId: checkout.id,
      tags: ['smoke', 'cart'],
      description: 'A guest applies a **coupon** at checkout.',
    });
    expect(scenario).toMatchObject({
      key: 'CHK-TS-1',
      number: 1,
      title: 'Guest checkout with coupon',
      status: 'draft',
      priority: 'medium',
      module: { id: checkout.id, name: 'Checkout' },
      tags: ['cart', 'smoke'],
      description: 'A guest applies a **coupon** at checkout.',
      stepsToReach: '',
      revision: 1,
      testCaseCount: 0,
      author: { id: team.editor.user!.id, name: 'Ana Editor' },
      updatedBy: { id: team.editor.user!.id, name: 'Ana Editor' },
      deletedAt: null,
    });
    const second = await createScenario({ title: 'Second' });
    expect(second.key).toBe('CHK-TS-2');

    const [event] = await auditEvents('scenario.created');
    expect(event).toMatchObject({
      target: { type: 'scenario', label: 'CHK-TS-2 · Second' },
      changes: { title: { from: null, to: 'Second' } },
    });
  });

  it('Title required: nothing is created and the title field is reported', async () => {
    const res = await team.editor.post(`${team.chk}/scenarios`, { title: '  ' });
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([{ path: 'title', message: 'title.required' }]);
    expect((await team.editor.get(`${team.chk}/scenarios`)).body.total).toBe(0);
  });

  it('Automatic creation: @Payments creates tag payments in CHK', async () => {
    const scenario = await createScenario({ title: 'Pay', tags: ['@Payments'] });
    expect(scenario.tags).toEqual(['payments']);
    const tags = await team.editor.get(`${team.chk}/tags`);
    expect(tags.body).toEqual([{ name: 'payments', scenarioCount: 1 }]);
    const [event] = await auditEvents('tag.created');
    expect(event).toMatchObject({ target: { type: 'tag', label: 'CHK · @payments' } });
  });

  it('Reuse existing tag: SMOKE attaches the existing smoke tag', async () => {
    await createScenario({ title: 'One', tags: ['smoke'] });
    const second = await createScenario({ title: 'Two', tags: ['SMOKE'] });
    expect(second.tags).toEqual(['smoke']);
    expect((await team.editor.get(`${team.chk}/tags`)).body).toEqual([
      { name: 'smoke', scenarioCount: 2 },
    ]);
    expect(await auditEvents('tag.created')).toHaveLength(1);
  });

  it('Invalid tag: smoke test is rejected', async () => {
    const res = await team.editor.post(`${team.chk}/scenarios`, {
      title: 't',
      tags: ['smoke test'],
    });
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([{ path: 'tags.0', message: 'tag.invalid' }]);
  });

  it('Inverted range: from must not exceed up to', async () => {
    const res = await team.editor.post(`${team.chk}/scenarios`, {
      title: 't',
      versionFrom: '3.2',
      versionTo: '3.1',
    });
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([{ path: 'versionTo', message: 'version.inverted' }]);
  });

  it('Valid range is stored as entered', async () => {
    const scenario = await createScenario({ title: 't', versionFrom: '2.4', versionTo: '3.10' });
    expect(scenario).toMatchObject({ versionFrom: '2.4', versionTo: '3.10' });
  });

  it('rejects a module of another application', async () => {
    const payModule = await createModule('Wallet', team.pay);
    const res = await team.editor.post(`${team.chk}/scenarios`, {
      title: 't',
      moduleId: payModule.id,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('MODULE_NOT_FOUND');
  });
});

describe('reading scenarios', () => {
  it('Viewer can read; the key and the bare number both resolve', async () => {
    const created = await createScenario({ title: 'Readable' });
    const byKey = await team.viewer.get(`${team.chk}/scenarios/CHK-TS-1`);
    expect(byKey.status).toBe(200);
    expect(byKey.body).toMatchObject({ id: created.id, key: 'CHK-TS-1', revision: 1 });
    expect((await team.viewer.get(`${team.chk}/scenarios/1`)).body.id).toBe(created.id);
    expect((await team.viewer.get(`${team.chk}/scenarios/chk-ts-1`)).status).toBe(200);
  });

  it('is 404 for unknown keys, other applications and other organizations', async () => {
    await createScenario({ title: 'CHK one' });
    await createScenario({ title: 'PAY one' }, team.pay);
    expect((await team.editor.get(`${team.chk}/scenarios/CHK-TS-9`)).status).toBe(404);
    // PAY's scenario is not reachable through CHK, neither by its key nor by number.
    expect((await team.editor.get(`${team.chk}/scenarios/PAY-TS-1`)).status).toBe(404);
    expect((await team.editor.get(`${team.chk}/scenarios/nonsense`)).status).toBe(404);

    const stranger = await signedUp(harness, 'Stranger');
    const other = await createOrg(stranger, 'Other Org', 'other');
    expect(other).toBe('other');
    expect((await stranger.get(`${team.chk}/scenarios/CHK-TS-1`)).status).toBe(404);
    expect((await stranger.get(`${team.chk}/scenarios`)).status).toBe(404);
  });
});

describe('editing scenarios', () => {
  it('Edit and save: status changes and the last editor and update time reflect it', async () => {
    const created = await createScenario({ title: 'Edit me' });
    const res = await team.editor2.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      status: 'ready',
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'ready',
      revision: 2,
      updatedBy: { id: team.editor2.user!.id, name: 'Luis Editor' },
      author: { name: 'Ana Editor' },
    });
    expect(res.body.revisionId).not.toBe(created.revisionId);
    expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );
  });

  it("Conflicting edit: Luis's save is rejected naming Ana", async () => {
    await createScenario({ title: 'Shared' });
    // Both opened r1; Ana saves first.
    expect(
      (await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, { baseRevision: 1, title: 'A' }))
        .status,
    ).toBe(200);
    const luis = await team.editor2.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      title: 'L',
    });
    expect(luis.status).toBe(409);
    expect(luis.body).toMatchObject({
      code: 'SCENARIO_CHANGED',
      latestRevision: 2,
      changedBy: 'Ana Editor',
    });
    expect(Number.isNaN(Date.parse(luis.body.changedAt))).toBe(false);
    expect((await team.editor.get(`${team.chk}/scenarios/CHK-TS-1`)).body.title).toBe('A');
  });

  it('No-op save: nothing changes and no revision is created', async () => {
    await createScenario({ title: 'Same', tags: ['smoke'] });
    const res = await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      title: 'Same',
      tags: ['@SMOKE'],
      status: 'draft',
    });
    expect(res.status).toBe(200);
    expect(res.body.revision).toBe(1);
    expect(await auditEvents('scenario.updated')).toHaveLength(0);
  });

  it('Status change audited: draft → ready; rich text recorded as revision numbers', async () => {
    const checkout = await createModule('Checkout');
    await createScenario({ title: 'Audit me', description: 'old', tags: ['a'] });
    await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      status: 'ready',
      description: 'new text',
      moduleId: checkout.id,
      tags: ['a', 'b'],
    });
    const [event] = await auditEvents('scenario.updated');
    expect(event).toMatchObject({
      actor: { id: team.editor.user!.id },
      target: { type: 'scenario', label: 'CHK-TS-1 · Audit me' },
      changes: {
        status: { from: 'draft', to: 'ready' },
        description: { from: 'r1', to: 'r2' },
        module: { from: null, to: 'Checkout' },
        tags: { from: ['a'], to: ['a', 'b'] },
      },
    });
    expect(JSON.stringify(event.changes)).not.toContain('new text');
  });

  it('rejects an inverted range after merging with the stored values', async () => {
    await createScenario({ title: 'Range', versionFrom: '3.2' });
    const res = await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      versionTo: '3.1',
    });
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([{ path: 'versionTo', message: 'version.inverted' }]);
  });
});

describe('deleting and restoring', () => {
  it('Delete: hidden from the grid, still readable by URL; Restore brings it back', async () => {
    await createScenario({ title: 'Doomed' });
    const deleted = await team.editor.delete(`${team.chk}/scenarios/CHK-TS-1`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.deletedAt).not.toBeNull();
    expect(deleted.body.deletedBy).toMatchObject({ name: 'Ana Editor' });

    expect((await team.viewer.get(`${team.chk}/scenarios`)).body.total).toBe(0);
    const read = await team.viewer.get(`${team.chk}/scenarios/CHK-TS-1`);
    expect(read.status).toBe(200);
    expect(read.body.deletedAt).not.toBeNull();

    // Read-only while deleted.
    const edit = await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      title: 'x',
    });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('SCENARIO_DELETED');

    const restored = await team.editor.post(`${team.chk}/scenarios/CHK-TS-1/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body).toMatchObject({ key: 'CHK-TS-1', deletedAt: null, revision: 1 });
    expect((await team.viewer.get(`${team.chk}/scenarios`)).body.total).toBe(1);

    const actions = (await auditEvents()).map((event) => event.action);
    expect(actions).toEqual(expect.arrayContaining(['scenario.deleted', 'scenario.restored']));
  });

  it('Keys are not reused: after deleting CHK-TS-5 the next scenario is CHK-TS-6', async () => {
    for (let i = 1; i <= 5; i++) await createScenario({ title: `S${i}` });
    await team.editor.delete(`${team.chk}/scenarios/CHK-TS-5`);
    expect((await createScenario({ title: 'Next' })).key).toBe('CHK-TS-6');
  });

  it('Concurrent creation gives distinct keys', async () => {
    const results = await Promise.all([
      team.editor.post(`${team.chk}/scenarios`, { title: 'Ana' }),
      team.editor2.post(`${team.chk}/scenarios`, { title: 'Luis' }),
      team.editor.post(`${team.chk}/scenarios`, { title: 'Ana 2' }),
    ]);
    expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
    expect(new Set(results.map((r) => r.body.key)).size).toBe(3);
  });
});

describe('permissions', () => {
  beforeEach(async () => {
    await createScenario({ title: 'Guarded' });
  });

  it.each(['tester', 'viewer'] as const)(
    'a %s cannot create, edit or delete (403)',
    async (role) => {
      const client = team[role];
      expect((await client.post(`${team.chk}/scenarios`, { title: 'x' })).status).toBe(403);
      expect(
        (await client.patch(`${team.chk}/scenarios/CHK-TS-1`, { baseRevision: 1, title: 'x' }))
          .status,
      ).toBe(403);
      expect((await client.delete(`${team.chk}/scenarios/CHK-TS-1`)).status).toBe(403);
      expect((await client.post(`${team.chk}/modules`, { name: 'x' })).status).toBe(403);
    },
  );

  it('managers can edit', async () => {
    expect(
      (
        await team.manager.patch(`${team.chk}/scenarios/CHK-TS-1`, {
          baseRevision: 1,
          priority: 'high',
        })
      ).status,
    ).toBe(200);
  });

  it('Archived application: every change is rejected with APP_ARCHIVED', async () => {
    await team.owner.post(`${team.chk}/archive`);
    const edit = await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, {
      baseRevision: 1,
      title: 'x',
    });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('APP_ARCHIVED');
    expect((await team.editor.post(`${team.chk}/scenarios`, { title: 'x' })).status).toBe(409);
    expect((await team.editor.delete(`${team.chk}/scenarios/CHK-TS-1`)).status).toBe(409);
    // Still readable.
    expect((await team.viewer.get(`${team.chk}/scenarios/CHK-TS-1`)).status).toBe(200);
  });
});

describe('modules and tags', () => {
  it('Create module inline, then rename it', async () => {
    const payments = await createModule('Payments');
    expect(payments.name).toBe('Payments');
    const renamed = await team.editor.patch(`${team.chk}/modules/${payments.id}`, {
      name: 'Billing',
    });
    expect(renamed.body).toEqual({ id: payments.id, name: 'Billing' });
    expect((await team.viewer.get(`${team.chk}/modules`)).body).toMatchObject([
      { id: payments.id, name: 'Billing', scenarioCount: 0 },
    ]);
    expect((await auditEvents('module.renamed'))[0].changes).toEqual({
      name: { from: 'Payments', to: 'Billing' },
    });
  });

  it('Duplicate module name: rejected and the existing module is offered', async () => {
    const existing = await createModule('Checkout');
    const res = await team.editor.post(`${team.chk}/modules`, { name: 'checkout' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'MODULE_EXISTS',
      existing: { id: existing.id, name: 'Checkout' },
    });
    // Other applications may use the same name.
    expect((await team.editor.post(`${team.pay}/modules`, { name: 'Checkout' })).status).toBe(201);
  });

  it('Module in use: deletion names how many scenarios use it', async () => {
    const checkout = await createModule('Checkout');
    await createScenario({ title: 'Uses it', moduleId: checkout.id });
    const res = await team.editor.delete(`${team.chk}/modules/${checkout.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'MODULE_IN_USE', count: 1 });

    const unused = await createModule('Unused');
    expect((await team.editor.delete(`${team.chk}/modules/${unused.id}`)).status).toBe(204);
    expect((await team.viewer.get(`${team.chk}/modules`)).body.map((m: Loose) => m.name)).toEqual([
      'Checkout',
    ]);
    // A deleted module's name can be reused.
    expect((await team.editor.post(`${team.chk}/modules`, { name: 'Unused' })).status).toBe(201);
  });

  it('modules of another application are 404', async () => {
    const wallet = await createModule('Wallet', team.pay);
    expect(
      (await team.editor.patch(`${team.chk}/modules/${wallet.id}`, { name: 'x' })).status,
    ).toBe(404);
    expect((await team.editor.delete(`${team.chk}/modules/${wallet.id}`)).status).toBe(404);
  });

  it('Tags are per application and suggested by prefix', async () => {
    await createScenario({ title: 'CHK', tags: ['smoke', 'slow', 'cart'] });
    await createScenario({ title: 'PAY', tags: ['wallet'] }, team.pay);
    expect((await team.editor.get(`${team.chk}/tags?q=@S`)).body.map((t: Loose) => t.name)).toEqual(
      ['slow', 'smoke'],
    );
    expect((await team.editor.get(`${team.pay}/tags?q=sm`)).body).toEqual([]);
    expect((await team.editor.get(`${team.pay}/tags`)).body.map((t: Loose) => t.name)).toEqual([
      'wallet',
    ]);
  });
});
