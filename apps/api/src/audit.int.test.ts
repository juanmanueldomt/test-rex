import { AUDIT_ACTIONS } from '@testrex/contracts';
import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createHarness,
  createOrg,
  signedUp,
  type Harness,
  type TestClient,
} from './testing/harness';

let container: StartedPostgreSqlContainer;
let harness: Harness;
let ana: TestClient;
let ben: TestClient;
let slug: string;
let events: Array<{
  action: string;
  actor: { id: string; label: string };
  target: { id: string | null; type: string };
  changes: Record<string, unknown>;
  createdAt: string;
  id: string;
}>;

beforeAll(async () => {
  container = await startPostgres();
  harness = await createHarness(container);
  ana = await signedUp(harness, 'Ana', 'ana@example.com');
  ben = await signedUp(harness, 'Ben', 'ben@example.com');

  // Exercise every mutating route once.
  slug = await createOrg(ana, 'Acme QA');
  await ana.patch(`/api/orgs/${slug}`, { name: 'Acme Quality' });
  const invite = await ana.post(`/api/orgs/${slug}/invitations`, {
    email: 'ben@example.com',
    role: 'member',
  });
  const token = encodeURIComponent(invite.body.link.split('/invite/')[1]);
  await ben.post(`/api/invitations/${token}/accept`);
  const spare = await ana.post(`/api/orgs/${slug}/invitations`, {
    email: 'spare@example.com',
    role: 'member',
  });
  await ana.delete(`/api/orgs/${slug}/invitations/${spare.body.invitation.id}`);
  await ana.post(`/api/orgs/${slug}/apps`, { name: 'Checkout Web', key: 'CHK' });
  await ana.patch(`/api/orgs/${slug}/apps/CHK`, { name: 'Checkout' });
  await ana.patch(`/api/orgs/${slug}/apps/CHK`, { description: 'Web shop' });
  await ana.put(`/api/orgs/${slug}/apps/CHK/members/${ben.user!.id}`, { role: 'tester' });
  await ana.put(`/api/orgs/${slug}/apps/CHK/members/${ben.user!.id}`, { role: 'editor' });
  await ana.post(`/api/orgs/${slug}/apps/CHK/archive`);
  await ana.post(`/api/orgs/${slug}/apps/CHK/restore`);
  await ana.patch(`/api/orgs/${slug}/members/${ben.user!.id}`, { role: 'admin' });
  await ana.patch(`/api/orgs/${slug}/members/${ben.user!.id}`, { role: 'member' });
  await ana.delete(`/api/orgs/${slug}/members/${ben.user!.id}`);

  events = (await ana.get(`/api/orgs/${slug}/audit?limit=100`)).body.events;
});

afterAll(async () => {
  await harness?.close();
  await container?.stop();
});

describe('audit trail', () => {
  it('records an event for every mutating action, newest first', () => {
    const actions = events.map((e) => e.action).reverse();
    expect(actions).toEqual([
      'organization.created',
      'organization.renamed',
      'member.invited',
      'member.joined',
      'member.invited',
      'invitation.revoked',
      'application.created',
      'application.renamed',
      'application.updated',
      'application.member_role_changed',
      'application.member_role_changed',
      'application.archived',
      'application.restored',
      'member.role_changed',
      'member.role_changed',
      'member.removed',
    ]);
    for (const action of actions) expect(AUDIT_ACTIONS).toContain(action);
    const times = events.map((e) => e.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('includes actor, target and before/after values', () => {
    const roleChange = events.find(
      (e) =>
        e.action === 'application.member_role_changed' &&
        (e.changes['role:CHK'] as { to: string }).to === 'editor',
    );
    expect(roleChange).toMatchObject({
      actor: { id: ana.user!.id, label: 'Ana <ana@example.com>' },
      target: { type: 'user', id: ben.user!.id },
      changes: { 'role:CHK': { from: 'tester', to: 'editor' } },
    });
    const rename = events.find((e) => e.action === 'organization.renamed');
    expect(rename?.changes).toEqual({ name: { from: 'Acme QA', to: 'Acme Quality' } });
    const joined = events.find((e) => e.action === 'member.joined');
    expect(joined?.actor.id).toBe(ben.user!.id);
  });

  it('filters by actor, action and date range', async () => {
    const byBen = await ana.get(`/api/orgs/${slug}/audit?actorId=${ben.user!.id}`);
    expect(byBen.body.events.map((e: { action: string }) => e.action)).toEqual(['member.joined']);

    const archived = await ana.get(`/api/orgs/${slug}/audit?action=application.archived`);
    expect(archived.body.events).toHaveLength(1);

    const future = encodeURIComponent(new Date(Date.now() + 60_000).toISOString());
    expect((await ana.get(`/api/orgs/${slug}/audit?from=${future}`)).body.events).toEqual([]);
    const past = encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString());
    expect(
      (await ana.get(`/api/orgs/${slug}/audit?from=${past}&limit=100`)).body.events,
    ).toHaveLength(events.length);
  });

  it('paginates with a cursor', async () => {
    const first = await ana.get(`/api/orgs/${slug}/audit?limit=5`);
    expect(first.body.events).toHaveLength(5);
    expect(first.body.nextCursor).toBe(first.body.events[4].id);
    const second = await ana.get(`/api/orgs/${slug}/audit?limit=5&before=${first.body.nextCursor}`);
    expect(second.body.events[0].id).toBe(events[5]!.id);
  });

  it('is only visible to owners and admins', async () => {
    const carla = await signedUp(harness, 'Carla', 'carla@example.com');
    const invite = await ana.post(`/api/orgs/${slug}/invitations`, {
      email: 'carla@example.com',
      role: 'member',
    });
    await carla.post(
      `/api/invitations/${encodeURIComponent(invite.body.link.split('/invite/')[1])}/accept`,
    );
    const res = await carla.get(`/api/orgs/${slug}/audit`);
    expect(res.status).toBe(403);
  });

  it('offers no way to modify or delete events', async () => {
    const id = events[0]!.id;
    for (const method of ['PATCH', 'PUT', 'DELETE'] as const) {
      const res = await ana.request(
        method,
        `/api/orgs/${slug}/audit/${id}`,
        method === 'DELETE' ? undefined : {},
      );
      expect(res.status).toBe(404);
    }
    expect((await ana.request('DELETE', `/api/orgs/${slug}/audit`)).status).toBe(404);
  });

  it('keeps events of other organizations separate', async () => {
    const other = await createOrg(ben, 'Beta Labs');
    const res = await ben.get(`/api/orgs/${other}/audit`);
    expect(res.body.events.map((e: { action: string }) => e.action)).toEqual([
      'organization.created',
    ]);
  });
});
