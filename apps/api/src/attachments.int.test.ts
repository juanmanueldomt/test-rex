import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startPostgres } from '@testrex/db/testing';
import type { LocalStorage } from '@testrex/storage';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { QuotaAction, QuotaContext, QuotaService } from './services/quota';
import {
  createHarness,
  createOrg,
  scenarioTeam,
  signedUp,
  type Harness,
  type Loose,
  type ScenarioTeam,
} from './testing/harness';

const MAX_BYTES = 1024 * 1024;
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const pdf = (bytes: number) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(bytes - 9, 0x20)]);

let container: StartedPostgreSqlContainer;
let harness: Harness;
let team: ScenarioTeam;
let quotaCalls: { action: QuotaAction; context: QuotaContext }[];
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
  quotaCalls = [];
  const quota: QuotaService = {
    async check(action, context) {
      quotaCalls.push({ action, context });
    },
  };
  harness = await createHarness(container, { attachmentMaxBytes: MAX_BYTES, quota });
  team = await scenarioTeam(harness);
  url = `${team.chk}/scenarios/CHK-TS-1`;
  expect((await team.editor.post(`${team.chk}/scenarios`, { title: 'Checkout' })).status).toBe(201);
});

function storageFiles(): string[] {
  const root = (harness.services.storage as LocalStorage).root;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else files.push(entry.name);
    }
  };
  walk(join(root, 'org'));
  return files;
}

describe('uploading', () => {
  it('Upload: listed with name, size, detected type, uploader and time', async () => {
    const res = await team.editor.upload(`${url}/attachments`, {
      name: 'checkout-flow.pdf',
      content: pdf(200_000),
      type: 'application/pdf',
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      fileName: 'checkout-flow.pdf',
      sizeBytes: 200_000,
      contentType: 'application/pdf',
      uploadedBy: { id: team.editor.user!.id, name: 'Ana Editor' },
      url: `${team.chk}/attachments/${res.body.id}`,
    });
    expect((await team.viewer.get(`${url}/attachments`)).body).toEqual([res.body]);
    expect((await team.viewer.get(url)).body.counts.attachments).toBe(1);
    const events = (await team.owner.get(`/api/orgs/${team.slug}/audit?action=attachment.uploaded`))
      .body.events;
    expect(events[0]).toMatchObject({
      target: { type: 'scenario', label: 'CHK-TS-1 · Checkout' },
      changes: { file: { to: 'checkout-flow.pdf' } },
    });
  });

  it('File too large: rejected with the limit and nothing is kept', async () => {
    const res = await team.editor.upload(`${url}/attachments`, {
      name: 'huge.pdf',
      content: pdf(MAX_BYTES + 100_000),
    });
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: 'FILE_TOO_LARGE', maxBytes: MAX_BYTES });
    expect(res.body.message).toContain('1 MB');
    expect((await team.viewer.get(`${url}/attachments`)).body).toEqual([]);
    expect(storageFiles()).toEqual([]);
    expect((await team.viewer.get(`${team.chk}/attachments/limits`)).body).toEqual({
      maxBytes: MAX_BYTES,
    });
  });

  it('only editors and managers can upload', async () => {
    for (const client of [team.tester, team.viewer]) {
      const res = await client.upload(`${url}/attachments`, { name: 'a.png', content: PNG });
      expect(res.status).toBe(403);
    }
    expect(
      (await team.manager.upload(`${url}/attachments`, { name: 'a.png', content: PNG })).status,
    ).toBe(201);
  });

  it('determines the type from the content, not the name or the browser', async () => {
    const res = await team.editor.upload(`${url}/attachments`, {
      name: 'innocent.png',
      content: '<html><script>alert(1)</script></html>',
      type: 'image/png',
    });
    expect(res.body.contentType).toBe('text/plain');
    const binary = await team.editor.upload(`${url}/attachments`, {
      name: 'data.bin',
      content: Buffer.from([0, 1, 2, 3, 255]),
    });
    expect(binary.body.contentType).toBe('application/octet-stream');
  });

  it('keeps only a safe file name', async () => {
    const res = await team.editor.upload(`${url}/attachments`, {
      name: '../../etc/passwd',
      content: 'x',
    });
    expect(res.body.fileName).toBe('passwd');
  });

  it('checks the storage quota with the organization usage before storing', async () => {
    await team.editor.upload(`${url}/attachments`, { name: 'a.pdf', content: pdf(1000) });
    await team.editor.upload(`${url}/attachments`, { name: 'b.pdf', content: pdf(3000) });
    const uploads = quotaCalls.filter((call) => call.action === 'storage.upload');
    expect(uploads.map((call) => call.context.usageBytes)).toEqual([0, 1000]);
    expect(uploads[0]!.context).toMatchObject({ plan: 'self_hosted' });
    expect(uploads[0]!.context.bytes).toBeGreaterThan(1000);

    // Usage is per organization.
    const stranger = await signedUp(harness, 'Stranger');
    const other = await createOrg(stranger, 'Other Org', 'other');
    await stranger.post(`/api/orgs/${other}/apps`, { name: 'Other', key: 'OTH' });
    await stranger.post(`/api/orgs/${other}/apps/OTH/scenarios`, { title: 'Theirs' });
    await stranger.upload(`/api/orgs/${other}/apps/OTH/scenarios/OTH-TS-1/attachments`, {
      name: 'c.pdf',
      content: pdf(500),
    });
    expect(
      quotaCalls.filter((call) => call.action === 'storage.upload').at(-1)!.context,
    ).toMatchObject({ usageBytes: 0 });
  });
});

describe('downloading', () => {
  it('Viewer downloads; images are shown inline with safe headers', async () => {
    const png = (await team.editor.upload(`${url}/attachments`, { name: 'shot.png', content: PNG }))
      .body;
    const res = await team.viewer.get(png.url);
    expect(res.status).toBe(200);
    expect(res.raw.equals(PNG)).toBe(true);
    expect(res.headers).toMatchObject({
      'content-type': 'image/png',
      'x-content-type-options': 'nosniff',
      'cache-control': 'private, max-age=31536000, immutable',
    });
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="shot.png"/);
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
  });

  it('HTML file: downloaded instead of rendered', async () => {
    const html = (
      await team.editor.upload(`${url}/attachments`, {
        name: 'report.html',
        content: '<!doctype html><h1>Report</h1>',
        type: 'text/html',
      })
    ).body;
    const res = await team.viewer.get(html.url);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="report.html"/);
    expect(res.headers['content-type']).not.toMatch(/html/);
    const svg = (
      await team.editor.upload(`${url}/attachments`, {
        name: 'logo.svg',
        content: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      })
    ).body;
    expect((await team.viewer.get(svg.url)).headers['content-disposition']).toMatch(/^attachment/);
  });

  it('non-ASCII names are encoded in the header', async () => {
    const file = (
      await team.editor.upload(`${url}/attachments`, { name: 'señal ✓.txt', content: 'x' })
    ).body;
    expect((await team.viewer.get(file.url)).headers['content-disposition']).toBe(
      `attachment; filename="se_al _.txt"; filename*=UTF-8''se%C3%B1al%20%E2%9C%93.txt`,
    );
  });

  it('Other organization and other application: 404', async () => {
    const png = (await team.editor.upload(`${url}/attachments`, { name: 'shot.png', content: PNG }))
      .body;
    const stranger = await signedUp(harness, 'Stranger');
    await createOrg(stranger, 'Other Org', 'other');
    expect((await stranger.get(png.url)).status).toBe(404);
    expect((await team.editor.get(`${team.pay}/attachments/${png.id}`)).status).toBe(404);
    expect((await team.editor.get(`${team.chk}/attachments/not-a-uuid`)).status).toBe(404);
  });

  it('Remove embedded image: gone from the list, still downloadable for old revisions', async () => {
    const png = (await team.editor.upload(`${url}/attachments`, { name: 'shot.png', content: PNG }))
      .body;
    // r2 embeds the image; r3 no longer does.
    await team.editor.patch(url, {
      baseRevision: 1,
      stepsToReach: `![shot](attachment:${png.id})`,
    });
    await team.editor.patch(url, { baseRevision: 2, stepsToReach: 'no image' });
    expect((await team.tester.delete(`${url}/attachments/${png.id}`)).status).toBe(403);
    expect((await team.editor.delete(`${url}/attachments/${png.id}`)).status).toBe(204);
    expect((await team.viewer.get(`${url}/attachments`)).body).toEqual([]);
    expect((await team.viewer.get(`${url}/revisions/2`)).body.stepsToReach).toContain(png.id);
    const res = await team.viewer.get(png.url);
    expect(res.status).toBe(200);
    expect(res.raw.equals(PNG)).toBe(true);
    const [event] = (await team.owner.get(`/api/orgs/${team.slug}/audit?action=attachment.removed`))
      .body.events;
    expect(event.changes).toEqual({ file: { from: 'shot.png', to: null } });
  });
});

describe('images in rich text', () => {
  it('Paste before first save: the pending upload is claimed by the new scenario', async () => {
    const pending = await team.editor.upload(`${team.chk}/attachments`, {
      name: 'paste.png',
      content: PNG,
    });
    expect(pending.status).toBe(201);
    const created = await team.editor.post(`${team.chk}/scenarios`, {
      title: 'With image',
      description: `Look: ![paste](attachment:${pending.body.id})`,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const list = (await team.viewer.get(`${team.chk}/scenarios/${created.body.key}/attachments`))
      .body;
    expect(list.map((a: Loose) => a.id)).toEqual([pending.body.id]);
  });

  it("rejects another user's pending upload", async () => {
    const theirs = (
      await team.editor2.upload(`${team.chk}/attachments`, { name: 'p.png', content: PNG })
    ).body;
    const res = await team.editor.post(`${team.chk}/scenarios`, {
      title: 'Stolen',
      description: `![x](attachment:${theirs.id})`,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'ATTACHMENT_NOT_ALLOWED', attachmentIds: [theirs.id] });
  });

  it('Paste screenshot while editing: an attachment of the scenario can be embedded', async () => {
    const png = (await team.editor.upload(`${url}/attachments`, { name: 's.png', content: PNG }))
      .body;
    const res = await team.editor.patch(url, {
      baseRevision: 1,
      stepsToReach: `## Navigation\n\n![s](attachment:${png.id})`,
    });
    expect(res.status).toBe(200);
  });

  it('rejects a foreign attachment id in Markdown (another scenario or application)', async () => {
    await team.editor.post(`${team.chk}/scenarios`, { title: 'Other' });
    const other = (
      await team.editor.upload(`${team.chk}/scenarios/CHK-TS-2/attachments`, {
        name: 'o.png',
        content: PNG,
      })
    ).body;
    const edit = await team.editor.patch(url, {
      baseRevision: 1,
      description: `![o](attachment:${other.id})`,
    });
    expect(edit.status).toBe(400);
    expect(edit.body.code).toBe('ATTACHMENT_NOT_ALLOWED');

    const payPending = (
      await team.editor.upload(`${team.pay}/attachments`, { name: 'p.png', content: PNG })
    ).body;
    const cross = await team.editor.patch(url, {
      baseRevision: 1,
      description: `![p](attachment:${payPending.id})`,
    });
    expect(cross.status).toBe(400);
    expect((await team.viewer.get(url)).body.revision).toBe(1);
  });
});
