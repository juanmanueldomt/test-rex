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
let owner: TestClient;
let admin: TestClient;
let luis: TestClient;
let slug: string;

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
  owner = await signedUp(harness, 'Olivia Owner');
  admin = await signedUp(harness, 'Adam Admin');
  luis = await signedUp(harness, 'Luis Member');
  slug = await createOrg(owner, 'Acme QA');
  await addMember(owner, slug, admin, 'admin');
  await addMember(owner, slug, luis, 'member');
});

const apps = (s: string) => `/api/orgs/${s}/apps`;

describe('creating applications', () => {
  it('an admin creates an application reachable by its key', async () => {
    const res = await admin.post(apps(slug), { name: 'Checkout Web', key: 'CHK' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ key: 'CHK', name: 'Checkout Web', role: 'manager' });
    const get = await admin.get(`${apps(slug)}/CHK`);
    expect(get.status).toBe(200);
    expect(get.body.permissions).toEqual([
      'app.read',
      'execution.write',
      'testcase.write',
      'scenario.write',
      'comment.write',
      'comment.moderate',
      'app.manage',
    ]);
  });

  it('suggests a key from the name, skipping keys in use', async () => {
    expect(
      (await admin.get(`/api/orgs/${slug}/suggestions/app-key?name=Checkout%20Web`)).body,
    ).toEqual({ key: 'CW' });
    await admin.post(apps(slug), { name: 'Checkout Web', key: 'CW' });
    expect(
      (await admin.get(`/api/orgs/${slug}/suggestions/app-key?name=Checkout%20Web`)).body,
    ).toEqual({ key: 'CW2' });
  });

  it('rejects a duplicate key within the organization', async () => {
    await admin.post(apps(slug), { name: 'Checkout', key: 'CHK' });
    const res = await admin.post(apps(slug), { name: 'Checkout 2', key: 'CHK' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'KEY_TAKEN', suggestion: 'CHK2' });
    expect(res.body.message).toContain('already in use');
  });

  it('allows the same key in different organizations', async () => {
    const other = await createOrg(owner, 'Beta Labs');
    expect((await owner.post(apps(slug), { name: 'Checkout', key: 'CHK' })).status).toBe(201);
    expect((await owner.post(apps(other), { name: 'Checkout', key: 'CHK' })).status).toBe(201);
  });

  it('validates keys', async () => {
    for (const key of ['c', 'chk', '1AB', 'TOOLONGKEY1']) {
      expect((await admin.post(apps(slug), { name: 'X', key })).status).toBe(400);
    }
  });

  it('members cannot create applications', async () => {
    expect((await luis.post(apps(slug), { name: 'Nope', key: 'NOPE' })).status).toBe(403);
  });
});

describe('editing and archiving', () => {
  beforeEach(async () => {
    await admin.post(apps(slug), { name: 'Checkout Web', key: 'CHK' });
  });

  it('renames without changing the key; the key itself cannot change', async () => {
    const res = await admin.patch(`${apps(slug)}/CHK`, { name: 'Checkout' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Checkout', key: 'CHK' });
    const key = await admin.patch(`${apps(slug)}/CHK`, { key: 'NEW' });
    expect(key.status).toBe(400);
    expect(key.body.code).toBe('KEY_IMMUTABLE');
    expect((await admin.get(`${apps(slug)}/CHK`)).status).toBe(200);
  });

  it('archived applications are hidden by default and read-only until restored', async () => {
    const archived = await admin.post(`${apps(slug)}/CHK/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.archivedAt).not.toBeNull();

    expect((await admin.get(apps(slug))).body).toEqual([]);
    expect(
      (await admin.get(`${apps(slug)}?status=archived`)).body.map((a: { key: string }) => a.key),
    ).toEqual(['CHK']);
    expect((await admin.get(`${apps(slug)}/CHK`)).status).toBe(200);

    const edit = await admin.patch(`${apps(slug)}/CHK`, { name: 'Changed' });
    expect(edit.status).toBe(409);
    expect(edit.body.code).toBe('APP_ARCHIVED');
    expect(edit.body.message).toMatch(/archived/);
    expect(
      (await admin.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'tester' })).status,
    ).toBe(409);

    expect((await admin.post(`${apps(slug)}/CHK/restore`)).status).toBe(200);
    expect((await admin.get(apps(slug))).body).toHaveLength(1);
    expect((await admin.patch(`${apps(slug)}/CHK`, { name: 'Changed' })).status).toBe(200);
  });

  it('only owners and admins can archive', async () => {
    await admin.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'manager' });
    expect((await luis.post(`${apps(slug)}/CHK/archive`)).status).toBe(403);
  });
});

describe('application access', () => {
  beforeEach(async () => {
    await owner.post(apps(slug), { name: 'Checkout', key: 'CHK' });
    await owner.post(apps(slug), { name: 'Billing', key: 'BIL' });
  });

  it('a member only sees and opens the applications granted to them', async () => {
    expect((await luis.get(apps(slug))).body).toEqual([]);
    expect((await luis.get(`${apps(slug)}/CHK`)).status).toBe(404);

    await admin.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'viewer' });
    const list = await luis.get(apps(slug));
    expect(list.body.map((a: { key: string; role: string }) => [a.key, a.role])).toEqual([
      ['CHK', 'viewer'],
    ]);
    expect((await luis.get(`${apps(slug)}/BIL`)).status).toBe(404);
  });

  it('a viewer cannot write (403)', async () => {
    await admin.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'viewer' });
    expect((await luis.patch(`${apps(slug)}/CHK`, { name: 'Hacked' })).status).toBe(403);
    expect(
      (await luis.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'manager' })).status,
    ).toBe(403);
  });

  it('organization admins are implicit managers of every application', async () => {
    const res = await admin.get(`${apps(slug)}/BIL`);
    expect(res.body).toMatchObject({ role: 'manager' });
    expect(res.body.permissions).toContain('app.manage');
    expect((await admin.get(apps(slug))).body).toHaveLength(2);
    const grant = await admin.put(`${apps(slug)}/BIL/members/${owner.user!.id}`, {
      role: 'viewer',
    });
    expect(grant.status).toBe(400);
    expect(grant.body.code).toBe('IMPLICIT_MANAGER');
  });

  it('an application manager grants access, which is audited', async () => {
    const carla = await signedUp(harness, 'Carla Member');
    await addMember(owner, slug, carla, 'member');
    await admin.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'manager' });

    const grant = await luis.put(`${apps(slug)}/CHK/members/${carla.user!.id}`, { role: 'tester' });
    expect(grant.status).toBe(200);
    expect((await carla.get(`${apps(slug)}/CHK`)).body.role).toBe('tester');

    const members = await luis.get(`${apps(slug)}/CHK/members`);
    const carlaRow = members.body.find((m: { userId: string }) => m.userId === carla.user!.id);
    expect(carlaRow).toMatchObject({ appRole: 'tester', effectiveRole: 'tester', implicit: false });
    const adminRow = members.body.find((m: { userId: string }) => m.userId === admin.user!.id);
    expect(adminRow).toMatchObject({ appRole: null, effectiveRole: 'manager', implicit: true });

    const audit = await owner.get(`/api/orgs/${slug}/audit?action=application.member_role_changed`);
    expect(audit.body.events[0]).toMatchObject({
      actor: { id: luis.user!.id },
      target: { id: carla.user!.id },
      changes: { 'role:CHK': { from: null, to: 'tester' } },
    });
  });

  it('revoking access removes the application', async () => {
    await admin.put(`${apps(slug)}/CHK/members/${luis.user!.id}`, { role: 'editor' });
    expect((await admin.delete(`${apps(slug)}/CHK/members/${luis.user!.id}`)).status).toBe(204);
    expect((await luis.get(`${apps(slug)}/CHK`)).status).toBe(404);
  });

  it('cannot grant access to someone outside the organization', async () => {
    const outsider = await signedUp(harness, 'Outsider');
    expect(
      (await admin.put(`${apps(slug)}/CHK/members/${outsider.user!.id}`, { role: 'viewer' }))
        .status,
    ).toBe(404);
  });
});
