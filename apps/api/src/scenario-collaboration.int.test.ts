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

beforeEach(async () => {
  await harness?.close();
  harness = await createHarness(container);
  team = await scenarioTeam(harness);
  url = `${team.chk}/scenarios/CHK-TS-1`;
  expect((await team.editor.post(`${team.chk}/scenarios`, { title: 'Coupon' })).status).toBe(201);
  // Bring the scenario to r4.
  for (const [baseRevision, status] of [
    [1, 'ready'],
    [2, 'draft'],
    [3, 'ready'],
  ] as const) {
    await team.editor.patch(url, { baseRevision, status });
  }
});

async function auditActions() {
  const res = await team.owner.get(`/api/orgs/${team.slug}/audit`);
  return (res.body.events as Loose[]).map((event) => event.action);
}

describe('comments', () => {
  it('Tester comments: shown with the name, time and "on r4"', async () => {
    const res = await team.tester.post(`${url}/comments`, {
      body: 'Coupon field is hidden on mobile',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      body: 'Coupon field is hidden on mobile',
      revision: 4,
      author: { id: team.tester.user!.id, name: 'Tom Tester' },
      editedAt: null,
    });
    const thread = await team.viewer.get(`${url}/comments`);
    expect(thread.body).toEqual([res.body]);
    expect((await team.viewer.get(url)).body.counts.comments).toBe(1);
    expect(await auditActions()).toContain('comment.created');
  });

  it('lists the thread oldest first and stores Markdown as written', async () => {
    await team.editor.post(`${url}/comments`, { body: 'first' });
    await team.tester.post(`${url}/comments`, { body: '<script>alert(1)</script>' });
    const thread = (await team.viewer.get(`${url}/comments`)).body;
    expect(thread.map((c: Loose) => c.body)).toEqual(['first', '<script>alert(1)</script>']);
  });

  it('Viewer cannot comment (403); empty and too long comments are rejected', async () => {
    expect((await team.viewer.post(`${url}/comments`, { body: 'hi' })).status).toBe(403);
    expect((await team.tester.post(`${url}/comments`, { body: '   ' })).status).toBe(400);
    expect((await team.tester.post(`${url}/comments`, { body: 'x'.repeat(10_001) })).status).toBe(
      400,
    );
  });

  it('Edit own comment: new text with an edited marker', async () => {
    const created = (await team.tester.post(`${url}/comments`, { body: 'typo' })).body;
    const res = await team.tester.patch(`${url}/comments/${created.id}`, { body: 'fixed' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ body: 'fixed', revision: 4 });
    expect(res.body.editedAt).not.toBeNull();
    expect(await auditActions()).toContain('comment.edited');
  });

  it("Cannot edit others' comments (403), not even as a manager", async () => {
    const created = (await team.tester.post(`${url}/comments`, { body: 'mine' })).body;
    for (const client of [team.editor, team.manager]) {
      const res = await client.patch(`${url}/comments/${created.id}`, { body: 'hijacked' });
      expect(res.status).toBe(403);
    }
    expect((await team.editor.delete(`${url}/comments/${created.id}`)).status).toBe(403);
  });

  it('Manager moderation: deletes a tester comment, recorded in the audit log', async () => {
    const created = (await team.tester.post(`${url}/comments`, { body: 'off topic' })).body;
    expect((await team.manager.delete(`${url}/comments/${created.id}`)).status).toBe(204);
    expect((await team.viewer.get(`${url}/comments`)).body).toEqual([]);
    const events = (await team.owner.get(`/api/orgs/${team.slug}/audit?action=comment.deleted`))
      .body.events;
    expect(events[0]).toMatchObject({
      actor: { id: team.manager.user!.id },
      changes: { comment: { from: 'off topic', to: null }, author: { from: 'Tom Tester' } },
    });
  });

  it('authors delete their own comments', async () => {
    const created = (await team.tester.post(`${url}/comments`, { body: 'oops' })).body;
    expect((await team.tester.delete(`${url}/comments/${created.id}`)).status).toBe(204);
    expect((await team.tester.patch(`${url}/comments/${created.id}`, { body: 'x' })).status).toBe(
      404,
    );
  });

  it('comments of another scenario or application are 404', async () => {
    const created = (await team.tester.post(`${url}/comments`, { body: 'here' })).body;
    await team.editor.post(`${team.chk}/scenarios`, { title: 'Other' });
    expect(
      (
        await team.tester.patch(`${team.chk}/scenarios/CHK-TS-2/comments/${created.id}`, {
          body: 'x',
        })
      ).status,
    ).toBe(404);
    await team.editor.post(`${team.pay}/scenarios`, { title: 'Pay' });
    expect(
      (await team.editor.delete(`${team.pay}/scenarios/PAY-TS-1/comments/${created.id}`)).status,
    ).toBe(404);
  });
});

describe('requirement links', () => {
  it('Add a link: listed with provider and issue key', async () => {
    const res = await team.editor.post(`${url}/links`, {
      url: 'https://acme.atlassian.net/browse/SHOP-481',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      url: 'https://acme.atlassian.net/browse/SHOP-481',
      label: null,
      provider: 'jira',
      issueKey: 'SHOP-481',
      createdBy: { name: 'Ana Editor' },
    });
    expect((await team.viewer.get(`${url}/links`)).body).toEqual([res.body]);
    expect(await auditActions()).toContain('requirement_link.added');
    // Links are not part of revisions.
    expect((await team.viewer.get(url)).body.revision).toBe(4);
  });

  it('Reject unsafe scheme', async () => {
    const res = await team.editor.post(`${url}/links`, { url: 'javascript:alert(1)' });
    expect(res.status).toBe(400);
    expect(res.body.issues).toEqual([{ path: 'url', message: 'url.httpOnly' }]);
  });

  it('Duplicate link', async () => {
    const link = { url: 'https://github.com/acme/shop/issues/42' };
    expect((await team.editor.post(`${url}/links`, link)).status).toBe(201);
    const res = await team.editor.post(`${url}/links`, { ...link, label: 'again' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LINK_DUPLICATE');
  });

  it('allows at most 50 links', async () => {
    for (let i = 0; i < 50; i++) {
      expect((await team.editor.post(`${url}/links`, { url: `https://x.test/${i}` })).status).toBe(
        201,
      );
    }
    const res = await team.editor.post(`${url}/links`, { url: 'https://x.test/51' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('LINK_LIMIT');
  });

  it('edits and removes links; only editors may change them', async () => {
    const link = (
      await team.editor.post(`${url}/links`, {
        url: 'https://wiki.acme.com/checkout',
        label: 'Checkout rules',
      })
    ).body;
    expect(link).toMatchObject({ provider: 'other', issueKey: null, label: 'Checkout rules' });
    expect((await team.tester.post(`${url}/links`, { url: 'https://x.test' })).status).toBe(403);
    expect((await team.tester.delete(`${url}/links/${link.id}`)).status).toBe(403);

    const edited = await team.editor.patch(`${url}/links/${link.id}`, {
      url: 'https://dev.azure.com/acme/Shop/_workitems/edit/123',
      label: '',
    });
    expect(edited.body).toMatchObject({ provider: 'azure_devops', issueKey: '#123', label: null });
    expect((await team.editor.delete(`${url}/links/${link.id}`)).status).toBe(204);
    expect((await team.viewer.get(`${url}/links`)).body).toEqual([]);
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['requirement_link.updated', 'requirement_link.removed']),
    );
  });

  it('Search by requirement: the linked issue key finds the scenario', async () => {
    await team.editor.post(`${team.chk}/scenarios`, { title: 'Unlinked' });
    const search = async (q: string) =>
      (await team.viewer.get(`${team.chk}/scenarios?q=${encodeURIComponent(q)}`)).body.items.map(
        (item: Loose) => item.key,
      );
    expect(await search('SHOP-481')).toEqual([]);
    const link = (
      await team.editor.post(`${url}/links`, {
        url: 'https://acme.atlassian.net/browse/SHOP-481',
      })
    ).body;
    expect(await search('SHOP-481')).toEqual(['CHK-TS-1']);
    expect(await search('shop-481')).toEqual(['CHK-TS-1']);
    await team.editor.delete(`${url}/links/${link.id}`);
    expect(await search('SHOP-481')).toEqual([]);
    // Search still matches the title after the link changes.
    expect(await search('coupon')).toEqual(['CHK-TS-1']);
  });
});
