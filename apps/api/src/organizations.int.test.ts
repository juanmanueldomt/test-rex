import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  addMember,
  createHarness,
  createOrg,
  signedUp,
  type Harness,
  type TestClient,
} from './testing/harness';

let container: StartedPostgreSqlContainer;
let harness: Harness;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await container?.stop();
});

beforeEach(async () => {
  await harness?.close();
  harness = await createHarness(container);
});

describe('organization context (404 for non-members)', () => {
  it('members get the context; non-members and missing orgs get the same 404', async () => {
    const ana = await signedUp(harness, 'Ana');
    const ben = await signedUp(harness, 'Ben');
    const slug = await createOrg(ana, 'Acme QA');

    const member = await ana.get(`/api/orgs/${slug}`);
    expect(member.status).toBe(200);
    expect(member.body).toMatchObject({
      slug,
      name: 'Acme QA',
      role: 'owner',
      plan: 'self_hosted',
    });
    expect(member.body.permissions).toContain('members.manage');

    const nonMember = await ben.get(`/api/orgs/${slug}/apps`);
    const missing = await ben.get('/api/orgs/does-not-exist/apps');
    expect(nonMember.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(nonMember.body).toEqual(missing.body);
  });

  it('requires a session', async () => {
    const ana = await signedUp(harness, 'Ana');
    const slug = await createOrg(ana, 'Acme QA');
    expect((await harness.client().get(`/api/orgs/${slug}`)).status).toBe(401);
  });
});

describe('creating organizations', () => {
  it('suggests a slug from the name and makes the creator owner', async () => {
    const ana = await signedUp(harness, 'Ana');
    expect((await ana.get('/api/suggestions/org-slug?name=Acme%20QA')).body).toEqual({
      slug: 'acme-qa',
    });
    const res = await ana.post('/api/orgs', { name: 'Acme QA' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ slug: 'acme-qa', role: 'owner' });
    const me = await ana.get('/api/me');
    expect(me.body.organizations).toEqual([
      expect.objectContaining({ slug: 'acme-qa', name: 'Acme QA', role: 'owner' }),
    ]);
  });

  it('rejects a taken slug and suggests an available alternative', async () => {
    const ana = await signedUp(harness, 'Ana');
    const ben = await signedUp(harness, 'Ben');
    await createOrg(ana, 'Acme QA', 'acme-qa');
    const res = await ben.post('/api/orgs', { name: 'Acme QA', slug: 'acme-qa' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'SLUG_TAKEN', suggestion: 'acme-qa-2' });
    expect((await ben.get('/api/suggestions/org-slug?name=Acme%20QA')).body.slug).toBe('acme-qa-2');
  });

  it('validates slugs', async () => {
    const ana = await signedUp(harness, 'Ana');
    const res = await ana.post('/api/orgs', { name: 'Acme', slug: 'Not Valid' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.issues[0].path).toBe('slug');
  });

  it('lets a user belong to several organizations', async () => {
    const ana = await signedUp(harness, 'Ana');
    await createOrg(ana, 'Acme QA');
    await createOrg(ana, 'Beta Labs');
    const me = await ana.get('/api/me');
    expect(me.body.organizations.map((o: { slug: string }) => o.slug)).toEqual([
      'acme-qa',
      'beta-labs',
    ]);
    await ana.post('/api/orgs/beta-labs/apps', { name: 'Billing', key: 'BIL' });
    // Each organization only shows its own data.
    expect((await ana.get('/api/orgs/acme-qa/apps')).body).toEqual([]);
    expect((await ana.get('/api/orgs/beta-labs/apps')).body).toHaveLength(1);
  });

  it('renames an organization (owners/admins only)', async () => {
    const ana = await signedUp(harness, 'Ana');
    const ben = await signedUp(harness, 'Ben');
    const slug = await createOrg(ana, 'Acme QA');
    await addMember(ana, slug, ben, 'member');
    expect((await ben.patch(`/api/orgs/${slug}`, { name: 'Nope' })).status).toBe(403);
    const res = await ana.patch(`/api/orgs/${slug}`, { name: 'Acme Quality' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Quality');
  });
});

describe('organization roles', () => {
  let owner: TestClient;
  let admin: TestClient;
  let member: TestClient;
  let slug: string;

  beforeEach(async () => {
    owner = await signedUp(harness, 'Olivia Owner');
    admin = await signedUp(harness, 'Adam Admin');
    member = await signedUp(harness, 'Luis Member');
    slug = await createOrg(owner, 'Acme QA');
    await addMember(owner, slug, admin, 'admin');
    await addMember(owner, slug, member, 'member');
  });

  it('lists members with roles', async () => {
    const res = await member.get(`/api/orgs/${slug}/members`);
    expect(res.status).toBe(200);
    expect(res.body.map((m: { name: string; role: string }) => [m.name, m.role])).toEqual([
      ['Adam Admin', 'admin'],
      ['Luis Member', 'member'],
      ['Olivia Owner', 'owner'],
    ]);
  });

  it('an admin promotes a member to admin, and it is audited', async () => {
    const res = await admin.patch(`/api/orgs/${slug}/members/${member.user!.id}`, {
      role: 'admin',
    });
    expect(res.status).toBe(200);
    const audit = await owner.get(`/api/orgs/${slug}/audit?action=member.role_changed`);
    expect(audit.body.events[0]).toMatchObject({
      actor: { id: admin.user!.id },
      target: { type: 'user', id: member.user!.id },
      changes: { role: { from: 'member', to: 'admin' } },
    });
  });

  it('an admin cannot demote or remove an owner, nor grant ownership', async () => {
    const demote = await admin.patch(`/api/orgs/${slug}/members/${owner.user!.id}`, {
      role: 'member',
    });
    expect(demote.status).toBe(403);
    expect(demote.body.code).toBe('OWNER_REQUIRED');
    expect((await admin.delete(`/api/orgs/${slug}/members/${owner.user!.id}`)).status).toBe(403);
    const grant = await admin.patch(`/api/orgs/${slug}/members/${member.user!.id}`, {
      role: 'owner',
    });
    expect(grant.status).toBe(403);
  });

  it('members cannot change roles or remove others', async () => {
    expect(
      (await member.patch(`/api/orgs/${slug}/members/${admin.user!.id}`, { role: 'member' }))
        .status,
    ).toBe(403);
    expect((await member.delete(`/api/orgs/${slug}/members/${admin.user!.id}`)).status).toBe(403);
  });

  it('the last owner cannot demote themself or leave', async () => {
    const demote = await owner.patch(`/api/orgs/${slug}/members/${owner.user!.id}`, {
      role: 'admin',
    });
    expect(demote.status).toBe(409);
    expect(demote.body.code).toBe('LAST_OWNER');
    const leave = await owner.delete(`/api/orgs/${slug}/members/${owner.user!.id}`);
    expect(leave.status).toBe(409);
    expect(leave.body.code).toBe('LAST_OWNER');
  });

  it('with two owners, one may step down', async () => {
    await owner.patch(`/api/orgs/${slug}/members/${admin.user!.id}`, { role: 'owner' });
    expect(
      (await owner.patch(`/api/orgs/${slug}/members/${owner.user!.id}`, { role: 'admin' })).status,
    ).toBe(200);
  });

  it('a member can leave', async () => {
    expect((await member.delete(`/api/orgs/${slug}/members/${member.user!.id}`)).status).toBe(204);
    expect((await member.get(`/api/orgs/${slug}`)).status).toBe(404);
  });

  it('a removed member immediately loses access to the organization and its applications', async () => {
    await owner.post(`/api/orgs/${slug}/apps`, { name: 'Checkout', key: 'CHK' });
    await owner.put(`/api/orgs/${slug}/apps/CHK/members/${member.user!.id}`, { role: 'tester' });
    expect((await member.get(`/api/orgs/${slug}/apps/CHK`)).status).toBe(200);

    expect((await admin.delete(`/api/orgs/${slug}/members/${member.user!.id}`)).status).toBe(204);

    expect((await member.get(`/api/orgs/${slug}`)).status).toBe(404);
    expect((await member.get(`/api/orgs/${slug}/apps/CHK`)).status).toBe(404);
    const leftover = await harness.superPool.query(
      'SELECT count(*)::int AS n FROM application_members WHERE user_id = $1',
      [member.user!.id],
    );
    expect(leftover.rows[0].n).toBe(0);
  });
});

describe('cross-site protection', () => {
  it('rejects writes from another origin', async () => {
    const ana = await signedUp(harness, 'Ana');
    const res = await ana.request(
      'POST',
      '/api/orgs',
      { name: 'Evil' },
      { origin: 'https://evil.example' },
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ORIGIN_NOT_ALLOWED');
  });
});

afterAll(async () => {
  await harness?.close();
});
