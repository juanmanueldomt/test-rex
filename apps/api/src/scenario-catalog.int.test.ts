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
let clock: Date;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await harness?.close();
  await container?.stop();
});

beforeEach(async () => {
  await harness?.close();
  clock = new Date('2026-09-01T10:00:00Z');
  harness = await createHarness(container, { now: () => clock });
  team = await scenarioTeam(harness);
});

/** Advances the injected clock so every write gets a distinct time. */
function tick() {
  clock = new Date(clock.getTime() + 60_000);
}

async function create(body: Record<string, unknown>, client = team.editor, base = team.chk) {
  tick();
  const res = await client.post(`${base}/scenarios`, body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as Loose;
}

async function list(query = '', client = team.viewer) {
  const res = await client.get(`${team.chk}/scenarios${query ? `?${query}` : ''}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { items: Loose[]; total: number; page: number; size: number };
}

const keys = (page: { items: Loose[] }) => page.items.map((item) => item.key);

describe('grid rows', () => {
  it('Grid columns: key, title, status, module, priority, tags, test cases, author, updated', async () => {
    const module = (await team.editor.post(`${team.chk}/modules`, { name: 'Checkout' })).body;
    await create({ title: 'Row', moduleId: module.id, tags: ['b', 'a'], priority: 'high' });
    const [item] = (await list()).items;
    expect(item).toEqual({
      id: expect.any(String),
      key: 'CHK-TS-1',
      number: 1,
      title: 'Row',
      status: 'draft',
      priority: 'high',
      module: { id: module.id, name: 'Checkout' },
      tags: ['a', 'b'],
      testCaseCount: 0,
      author: { id: team.editor.user!.id, name: 'Ana Editor' },
      createdAt: clock.toISOString(),
      updatedBy: { id: team.editor.user!.id, name: 'Ana Editor' },
      updatedAt: clock.toISOString(),
      deletedAt: null,
    });
  });

  it('defaults to key order, newest first', async () => {
    for (const title of ['a', 'b', 'c']) await create({ title });
    expect(keys(await list())).toEqual(['CHK-TS-3', 'CHK-TS-2', 'CHK-TS-1']);
  });
});

describe('filters', () => {
  let checkout: string;
  let search: string;

  beforeEach(async () => {
    checkout = (await team.editor.post(`${team.chk}/modules`, { name: 'Checkout' })).body.id;
    search = (await team.editor.post(`${team.chk}/modules`, { name: 'Search' })).body.id;
    await create({
      title: 'ready checkout',
      status: 'ready',
      moduleId: checkout,
      tags: ['smoke', 'cart'],
    }); // 1
    await create({ title: 'draft checkout', status: 'draft', moduleId: checkout, tags: ['smoke'] }); // 2
    await create(
      { title: 'ready search', status: 'ready', moduleId: search, priority: 'critical' },
      team.editor2,
    ); // 3
    await create(
      { title: 'no module', status: 'deprecated', priority: 'low', tags: ['cart'] },
      team.editor2,
    ); // 4
  });

  it('Filter by status and module', async () => {
    expect(keys(await list(`status=ready&module=${checkout}`))).toEqual(['CHK-TS-1']);
  });

  it('multi-value filters match any selected value', async () => {
    expect(keys(await list('status=ready,deprecated'))).toEqual([
      'CHK-TS-4',
      'CHK-TS-3',
      'CHK-TS-1',
    ]);
    expect(keys(await list('priority=critical,low'))).toEqual(['CHK-TS-4', 'CHK-TS-3']);
    expect(keys(await list(`module=none,${search}`))).toEqual(['CHK-TS-4', 'CHK-TS-3']);
    expect(keys(await list('module=none'))).toEqual(['CHK-TS-4']);
    expect(keys(await list(`author=${team.editor2.user!.id}`))).toEqual(['CHK-TS-4', 'CHK-TS-3']);
  });

  it('Filter by tags: rows must have every selected tag', async () => {
    expect(keys(await list('tag=smoke,cart'))).toEqual(['CHK-TS-1']);
    expect(keys(await list('tag=@SMOKE'))).toEqual(['CHK-TS-2', 'CHK-TS-1']);
    expect(keys(await list('tag=unknown'))).toEqual([]);
  });

  it('Show deleted: deleted scenarios are listed and marked', async () => {
    await team.editor.delete(`${team.chk}/scenarios/CHK-TS-2`);
    expect(keys(await list())).toEqual(['CHK-TS-4', 'CHK-TS-3', 'CHK-TS-1']);
    const all = await list('deleted=true');
    expect(keys(all)).toEqual(['CHK-TS-4', 'CHK-TS-3', 'CHK-TS-2', 'CHK-TS-1']);
    expect(all.items.find((item) => item.key === 'CHK-TS-2')!.deletedAt).not.toBeNull();
  });

  it('rejects invalid parameters', async () => {
    for (const query of ['status=open', 'size=30', 'sort=password', 'version=v3', 'module=x']) {
      expect((await team.viewer.get(`${team.chk}/scenarios?${query}`)).status).toBe(400);
    }
  });
});

describe('Filter by supported version', () => {
  it('lists rows whose range contains the version; empty bounds are unlimited', async () => {
    await create({ title: '2.4–3.0', versionFrom: '2.4', versionTo: '3.0' }); // 1
    await create({ title: '3.0–', versionFrom: '3.0' }); // 2
    await create({ title: 'no range' }); // 3
    await create({ title: '–3.1', versionTo: '3.1' }); // 4
    await create({ title: '3.10–', versionFrom: '3.10' }); // 5
    expect(keys(await list('version=3.1'))).toEqual(['CHK-TS-4', 'CHK-TS-3', 'CHK-TS-2']);
    // Numeric comparison: 3.9 is below 3.10.
    expect(keys(await list('version=3.9'))).toEqual(['CHK-TS-3', 'CHK-TS-2']);
    expect(keys(await list('version=3.10'))).toEqual(['CHK-TS-5', 'CHK-TS-3', 'CHK-TS-2']);
    expect(keys(await list('version=3'))).toEqual(['CHK-TS-4', 'CHK-TS-3', 'CHK-TS-2', 'CHK-TS-1']);
  });
});

describe('search', () => {
  it('Search by title word, in rich text too, ignoring case and accents', async () => {
    await create({ title: 'Guest checkout with Coupon' }); // 1
    await create({ title: 'Other', stepsToReach: '## Test data\n- a cupón code' }); // 2
    await create({ title: 'Unrelated', description: 'nothing here' }); // 3
    expect(keys(await list('q=coupon'))).toEqual(['CHK-TS-1']);
    expect(keys(await list('q=CUPON'))).toEqual(['CHK-TS-2']);
    expect(keys(await list('q=test%20data'))).toEqual(['CHK-TS-2']);
  });

  it('treats LIKE wildcards literally', async () => {
    await create({ title: '100% off' });
    await create({ title: '100 off' });
    expect(keys(await list('q=100%25'))).toEqual(['CHK-TS-1']);
    expect(keys(await list('q=_'))).toEqual([]);
  });

  it('Search by key number: CHK-TS-12 is listed first', async () => {
    for (let i = 1; i <= 13; i++) {
      await create({ title: i === 3 ? 'mentions 12 items' : `Scenario ${i}` });
    }
    const byNumber = await list('q=12');
    expect(keys(byNumber)[0]).toBe('CHK-TS-12');
    expect(keys(byNumber)).toEqual(['CHK-TS-12', 'CHK-TS-3']);
    expect(keys(await list('q=CHK-TS-12'))).toEqual(['CHK-TS-12']);
    expect(keys(await list('q=chk-ts-12'))).toEqual(['CHK-TS-12']);
  });
});

describe('sorting', () => {
  it('Sort by updated: ascending lists the oldest update first', async () => {
    await create({ title: 'first' });
    await create({ title: 'second' });
    await create({ title: 'third' });
    tick();
    await team.editor.patch(`${team.chk}/scenarios/CHK-TS-1`, { baseRevision: 1, title: 'edited' });
    expect(keys(await list('sort=-updated'))).toEqual(['CHK-TS-1', 'CHK-TS-3', 'CHK-TS-2']);
    expect(keys(await list('sort=updated'))).toEqual(['CHK-TS-2', 'CHK-TS-3', 'CHK-TS-1']);
  });

  it('sorts keys numerically (CHK-TS-9 before CHK-TS-10)', async () => {
    for (let i = 1; i <= 10; i++) await create({ title: `S${i}` });
    const ascending = keys(await list('sort=key'));
    expect(ascending.indexOf('CHK-TS-9')).toBeLessThan(ascending.indexOf('CHK-TS-10'));
    expect(ascending[0]).toBe('CHK-TS-1');
  });

  it('sorts priority by severity, and title/module/author/status alphabetically', async () => {
    const zeta = (await team.editor.post(`${team.chk}/modules`, { name: 'zeta' })).body.id;
    const alpha = (await team.editor.post(`${team.chk}/modules`, { name: 'Alpha' })).body.id;
    await create({ title: 'b', priority: 'low', moduleId: zeta, status: 'ready' }); // 1
    await create({ title: 'C', priority: 'critical', status: 'deprecated' }, team.editor2); // 2
    await create({ title: 'a', priority: 'high', moduleId: alpha }); // 3
    await create({ title: 'd', priority: 'medium', moduleId: alpha }, team.editor2); // 4
    expect(keys(await list('sort=priority'))).toEqual([
      'CHK-TS-2',
      'CHK-TS-3',
      'CHK-TS-4',
      'CHK-TS-1',
    ]);
    expect(keys(await list('sort=-priority'))).toEqual([
      'CHK-TS-1',
      'CHK-TS-4',
      'CHK-TS-3',
      'CHK-TS-2',
    ]);
    expect(keys(await list('sort=title'))).toEqual([
      'CHK-TS-3',
      'CHK-TS-1',
      'CHK-TS-2',
      'CHK-TS-4',
    ]);
    // Ties break on the key; scenarios without a module come last.
    expect(keys(await list('sort=module'))).toEqual([
      'CHK-TS-3',
      'CHK-TS-4',
      'CHK-TS-1',
      'CHK-TS-2',
    ]);
    expect(keys(await list('sort=author'))).toEqual([
      'CHK-TS-1',
      'CHK-TS-3',
      'CHK-TS-2',
      'CHK-TS-4',
    ]);
    expect(keys(await list('sort=status'))).toEqual([
      'CHK-TS-3',
      'CHK-TS-4',
      'CHK-TS-1',
      'CHK-TS-2',
    ]);
  });
});

describe('pagination', () => {
  beforeEach(async () => {
    for (let i = 1; i <= 30; i++) await create({ title: `S${i}` });
  });

  it('returns the page, its size and the total of all matches', async () => {
    const first = await list();
    expect(first).toMatchObject({ total: 30, page: 1, size: 25 });
    expect(first.items).toHaveLength(25);
    const second = await list('page=2');
    expect(second.items).toHaveLength(5);
    expect(second.items.at(-1).key).toBe('CHK-TS-1');
    expect((await list('size=50')).items).toHaveLength(30);
  });

  it('a page beyond the end returns the last page', async () => {
    const res = await list('page=9');
    expect(res).toMatchObject({ total: 30, page: 2 });
    expect(res.items).toHaveLength(5);
    expect(await list('page=3&q=nothing-matches')).toMatchObject({ total: 0, page: 1, items: [] });
  });
});

describe('authors', () => {
  it('are the distinct creators of scenarios in this application only', async () => {
    await create({ title: 'a' });
    await create({ title: 'b' });
    await create({ title: 'c' }, team.editor2);
    await create({ title: 'pay' }, team.editor, team.pay);
    await team.owner.post(`${team.pay}/scenarios`, { title: 'owner in PAY' });
    const res = await team.viewer.get(`${team.chk}/scenarios/authors`);
    expect(res.body).toEqual([
      { id: team.editor.user!.id, name: 'Ana Editor' },
      { id: team.editor2.user!.id, name: 'Luis Editor' },
    ]);
  });
});
