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
let url: string;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await harness?.close();
  await container?.stop();
});

async function edit(body: Record<string, unknown>, client = team.editor) {
  const current = (await client.get(url)).body;
  const res = await client.patch(url, { baseRevision: current.revision, ...body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Loose;
}

/** CHK-TS-1 with four revisions:
 *  r1 created (module Checkout, tag smoke), r2 status → ready, r3 description changed,
 *  r4 title + tags changed (by Luis). */
beforeEach(async () => {
  await harness?.close();
  harness = await createHarness(container);
  team = await scenarioTeam(harness);
  url = `${team.chk}/scenarios/CHK-TS-1`;
  const checkout = (await team.editor.post(`${team.chk}/modules`, { name: 'Checkout' })).body;
  const created = await team.editor.post(`${team.chk}/scenarios`, {
    title: 'Guest checkout',
    moduleId: checkout.id,
    tags: ['smoke'],
    description: 'line one\nline two',
  });
  expect(created.status).toBe(201);
  await edit({ status: 'ready' });
  await edit({ description: 'line one\nline 2' });
  await edit({ title: 'Guest checkout with coupon', tags: ['smoke', 'cart'] }, team.editor2);
});

describe('history', () => {
  it('History list: r4..r1 with author, time and changed fields', async () => {
    const res = await team.viewer.get(`${url}/revisions`);
    expect(res.status).toBe(200);
    expect(res.body.map((r: Loose) => r.number)).toEqual([4, 3, 2, 1]);
    const [r4, r3, r2, r1] = res.body;
    expect(r4).toMatchObject({
      author: { id: team.editor2.user!.id, name: 'Luis Editor' },
      changedFields: ['title', 'tags'],
      changes: {
        title: { from: 'Guest checkout', to: 'Guest checkout with coupon' },
        tags: { from: ['smoke'], to: ['cart', 'smoke'] },
      },
      restoredFrom: null,
    });
    expect(r3).toMatchObject({ changedFields: ['description'], changes: {} });
    expect(r2).toMatchObject({ changes: { status: { from: 'draft', to: 'ready' } } });
    expect(r1).toMatchObject({ author: { name: 'Ana Editor' }, changedFields: [] });
    expect(Number.isNaN(Date.parse(r1.createdAt))).toBe(false);
  });

  it('the scenario reports its current revision', async () => {
    expect((await team.viewer.get(url)).body.revision).toBe(4);
  });
});

describe('viewing a revision', () => {
  it('Open old revision: r2 as it was, with the latest revision number', async () => {
    const res = await team.viewer.get(`${url}/revisions/2`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      number: 2,
      latest: 4,
      scenarioKey: 'CHK-TS-1',
      title: 'Guest checkout',
      status: 'ready',
      module: { name: 'Checkout' },
      tags: ['smoke'],
      description: 'line one\nline two',
    });
  });

  it('Unknown revision: r9 is not found', async () => {
    expect((await team.viewer.get(`${url}/revisions/9`)).status).toBe(404);
    expect((await team.viewer.get(`${url}/revisions/abc`)).status).toBe(404);
  });

  it('Content preserved after deletion, and retrievable by revision id', async () => {
    const r4 = (await team.viewer.get(`${url}/revisions/4`)).body;
    await team.editor.delete(url);
    const after = await team.viewer.get(`${url}/revisions/4`);
    expect(after.status).toBe(200);
    expect(after.body).toEqual(r4);
    const byId = await team.viewer.get(`${team.chk}/scenario-revisions/${r4.id}`);
    expect(byId.body).toEqual(r4);
    // Another application cannot reach it by id.
    expect((await team.editor.get(`${team.pay}/scenario-revisions/${r4.id}`)).status).toBe(404);
  });

  it('keeps the module name after the module is renamed or deleted', async () => {
    const moduleId = (await team.viewer.get(url)).body.module.id;
    await edit({ moduleId: null });
    await team.editor.patch(`${team.chk}/modules/${moduleId}`, { name: 'Renamed' });
    expect((await team.editor.delete(`${team.chk}/modules/${moduleId}`)).status).toBe(204);
    const r1 = (await team.viewer.get(`${url}/revisions/1`)).body;
    expect(r1.module).toEqual({ id: moduleId, name: 'Renamed' });
  });

  it('Revisions cannot be modified: no update or delete operation exists', async () => {
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const res = await team.manager.request(method, `${url}/revisions/2`, {});
      expect(res.status).toBe(404);
    }
  });
});

describe('restoring a revision', () => {
  it('Restore r2: r5 has the content of r2 and r1–r4 are unchanged', async () => {
    const before = (await team.viewer.get(`${url}/revisions`)).body;
    const res = await team.editor.post(`${url}/revisions/2/restore`, { baseRevision: 4 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      revision: 5,
      title: 'Guest checkout',
      status: 'ready',
      tags: ['smoke'],
      description: 'line one\nline two',
    });
    const history = (await team.viewer.get(`${url}/revisions`)).body;
    expect(history.slice(1)).toEqual(before);
    expect(history[0]).toMatchObject({
      number: 5,
      restoredFrom: 2,
      changedFields: ['title', 'tags', 'description'],
    });
    const r5 = (await team.viewer.get(`${url}/revisions/5`)).body;
    const r2 = (await team.viewer.get(`${url}/revisions/2`)).body;
    for (const field of ['title', 'status', 'priority', 'module', 'tags', 'description'] as const) {
      expect(r5[field]).toEqual(r2[field]);
    }
    const [event] = (
      await team.owner.get(`/api/orgs/${team.slug}/audit?action=scenario.revision_restored`)
    ).body.events;
    expect(event.changes.revision).toEqual({ from: 'r2', to: 'r5' });
  });

  it('brings back a module deleted since', async () => {
    const moduleId = (await team.viewer.get(url)).body.module.id;
    await edit({ moduleId: null });
    await team.editor.delete(`${team.chk}/modules/${moduleId}`);
    const res = await team.editor.post(`${url}/revisions/1/restore`, { baseRevision: 5 });
    expect(res.body.module).toEqual({ id: moduleId, name: 'Checkout' });
    expect((await team.viewer.get(`${team.chk}/modules`)).body.map((m: Loose) => m.id)).toEqual([
      moduleId,
    ]);
  });

  it('is subject to the same conflict check as an edit', async () => {
    const res = await team.editor.post(`${url}/revisions/2/restore`, { baseRevision: 3 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'SCENARIO_CHANGED', changedBy: 'Luis Editor' });
  });

  it('Viewer cannot restore (403)', async () => {
    expect((await team.viewer.post(`${url}/revisions/2/restore`, { baseRevision: 4 })).status).toBe(
      403,
    );
    expect((await team.tester.post(`${url}/revisions/2/restore`, { baseRevision: 4 })).status).toBe(
      403,
    );
  });
});
