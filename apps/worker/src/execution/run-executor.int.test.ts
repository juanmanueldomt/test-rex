// A run executed end to end: database fixtures, a real Chromium and the fixture site.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@testrex/config';
import {
  DEFAULT_AUTOMATION_SETTINGS,
  type DatasetSnapshot,
  type HookSnapshot,
  type TestStep,
} from '@testrex/contracts';
import { createDb, schema, withOrg, type DbHandle } from '@testrex/db';
import { createTestDatabase, startPostgres, type TestDatabase } from '@testrex/db/testing';
import { LocalStorage } from '@testrex/storage';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startSite, type FixtureSite } from '../testing/site';
import { launchBrowser } from './browsers';
import { executeRun, type InOrg } from './run-executor';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let handle: DbHandle;
let site: FixtureSite;
let storageDir: string;
let storage: LocalStorage;
const logger = createLogger({ level: 'silent' });
const orgId = schema.newId();
const appId = schema.newId();
const inOrg: InOrg = (fn) => withOrg(handle.db, orgId, fn);
let runNumber = 0;
let caseNumber = 0;

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  handle = createDb(database.appUrl);
  site = await startSite();
  storageDir = mkdtempSync(join(tmpdir(), 'testrex-worker-storage-'));
  storage = new LocalStorage(storageDir);
  const pg = (await import('pg')).default;
  const admin = new pg.Client({ connectionString: database.superUrl });
  await admin.connect();
  await admin.query(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acme', 'acme')`, [
    orgId,
  ]);
  await admin.query(
    `INSERT INTO applications (id, organization_id, name, key) VALUES ($1, $2, 'Shop', 'SHOP')`,
    [appId, orgId],
  );
  await admin.end();
});

afterAll(async () => {
  await handle?.close();
  await site?.close();
  await container?.stop();
  if (storageDir) rmSync(storageDir, { recursive: true, force: true });
});

interface ItemSpec {
  title: string;
  steps: Omit<TestStep, 'id'>[];
  mode?: 'automated' | 'manual';
  dataset?: Omit<DatasetSnapshot, 'id'>;
}

const withIds = (steps: Omit<TestStep, 'id'>[]): TestStep[] =>
  steps.map((step, index) => ({ id: `s${index + 1}`, ...step }) as TestStep);

/** Inserts test cases, a queued run and its items, as the API would. */
async function createRun(items: ItemSpec[], hooks: HookSnapshot[] = [], settings = {}) {
  const runId = schema.newId();
  const number = ++runNumber;
  const itemIds = await inOrg(async (tx) => {
    await tx.insert(schema.testRuns).values({
      id: runId,
      organizationId: orgId,
      applicationId: appId,
      number,
      title: `Run ${number}`,
      status: 'queued',
      baseUrl: site.url,
      browser: 'chromium',
      settings: {
        ...DEFAULT_AUTOMATION_SETTINGS,
        baseUrl: site.url,
        actionTimeoutMs: 2_000,
        assertionTimeoutMs: 1_500,
        ...settings,
      },
      hooks,
    });
    const ids: string[] = [];
    for (const [position, item] of items.entries()) {
      const testCaseId = schema.newId();
      const versionId = schema.newId();
      const steps = withIds(item.steps);
      const mode = item.mode ?? 'automated';
      await tx.insert(schema.testCases).values({
        id: testCaseId,
        organizationId: orgId,
        applicationId: appId,
        number: ++caseNumber,
        title: item.title,
        executionMode: mode,
        steps,
        currentVersion: 1,
        currentVersionId: versionId,
      });
      await tx.insert(schema.testCaseVersions).values({
        id: versionId,
        organizationId: orgId,
        testCaseId,
        number: 1,
        title: item.title,
        status: 'ready',
        priority: 'medium',
        executionMode: mode,
        descriptionMd: '',
        preconditionsMd: '',
        steps,
        scenarioIds: [],
        source: 'editor',
        authorLabel: 'Ana',
      });
      const [row] = await tx
        .insert(schema.testRunItems)
        .values({
          organizationId: orgId,
          runId,
          testCaseId,
          testCaseVersionId: versionId,
          versionNumber: 1,
          position,
          executionMode: mode,
          title: item.title,
          scenarioIds: [],
          steps,
          dataset: item.dataset ? { id: schema.newId(), ...item.dataset } : null,
          status: mode === 'automated' ? 'queued' : 'untested',
        })
        .returning({ id: schema.testRunItems.id });
      ids.push(row!.id);
    }
    return ids;
  });
  return { runId, itemIds };
}

async function load(runId: string) {
  return inOrg(async (tx) => {
    const [run] = await tx.select().from(schema.testRuns).where(eq(schema.testRuns.id, runId));
    const items = await tx
      .select()
      .from(schema.testRunItems)
      .where(eq(schema.testRunItems.runId, runId))
      .orderBy(schema.testRunItems.position);
    const artifacts = await tx
      .select()
      .from(schema.runArtifacts)
      .where(eq(schema.runArtifacts.runId, runId));
    return { run: run!, items, artifacts };
  });
}

const deps = () => ({ logger, storage, launch: launchBrowser });

describe('executeRun', () => {
  it('shares the before-run sign-in, iterates datasets, keeps failure artifacts and waits for manual items', async () => {
    const signIn: HookSnapshot = {
      id: 'hook-sign-in',
      name: 'Sign in',
      phase: 'beforeRun',
      steps: withIds([
        { action: 'goto', value: '/login' },
        { action: 'fill', target: { strategy: 'label', value: 'Email' }, value: 'ana@example.com' },
        { action: 'fill', target: { strategy: 'label', value: 'Password' }, value: 'secret' },
        { action: 'click', target: { strategy: 'role', value: 'button', name: 'Sign in' } },
        { action: 'expectUrl', value: '/account' },
      ]),
    };
    const openCart: HookSnapshot = {
      id: 'hook-cart',
      name: 'Open the cart',
      phase: 'beforeEach',
      steps: withIds([{ action: 'goto', value: '/cart' }]),
    };
    const { runId, itemIds } = await createRun(
      [
        {
          title: 'Account greets the user',
          steps: [
            { action: 'goto', value: '/account' },
            {
              action: 'expectText',
              target: { strategy: 'role', value: 'heading' },
              value: 'Welcome ana@example.com',
            },
          ],
        },
        {
          title: 'Coupons',
          dataset: {
            name: 'Coupons',
            columns: ['code', 'total'],
            rows: [
              ['SAVE10', '90'],
              ['SAVE10', '80'],
            ],
          },
          steps: [
            { action: 'fill', target: { strategy: 'label', value: 'Coupon' }, value: '{{code}}' },
            { action: 'click', target: { strategy: 'role', value: 'button', name: 'Apply' } },
            {
              action: 'expectText',
              target: { strategy: 'testId', value: 'total' },
              value: '{{total}}',
            },
          ],
        },
        {
          title: 'Ambiguous remove',
          steps: [
            { action: 'click', target: { strategy: 'role', value: 'button', name: 'Remove' } },
          ],
        },
        {
          title: 'Look at the receipt',
          mode: 'manual',
          steps: [{ action: 'manual', description: 'Look at the receipt' }],
        },
      ],
      [signIn, openCart],
    );

    const result = await executeRun(deps(), inOrg, { organizationId: orgId, runId });
    expect(result.executed).toBe(3);
    const { run, items, artifacts } = await load(runId);
    expect(run.status).toBe('running');
    expect(run.startedAt).not.toBeNull();
    expect(run.hookResults).toMatchObject([
      { hookId: 'hook-sign-in', status: 'passed', scope: 'run' },
    ]);

    const [account, coupons, ambiguous, manual] = items;
    expect(account).toMatchObject({ status: 'passed', error: null });
    expect(account!.iterations[0]!.hooks).toMatchObject([
      { name: 'Open the cart', status: 'passed' },
    ]);

    expect(coupons!.status).toBe('failed');
    expect(coupons!.iterations.map((i) => [i.status, i.data])).toEqual([
      ['passed', { code: 'SAVE10', total: '90' }],
      ['failed', { code: 'SAVE10', total: '80' }],
    ]);
    const failure = coupons!.iterations[1]!;
    expect(failure.error).toEqual({
      message: 'Expected test id "total" to contain "80", but it was "90".',
      stepId: 's3',
    });
    expect(coupons!.failedStepId).toBe('s3');
    expect(failure.url).toBe(`${site.url}/cart`);
    expect(failure.ariaSnapshot).toContain('button "Apply"');
    expect(failure.artifacts?.map((a) => a.kind).sort()).toEqual(['screenshot', 'trace']);
    expect(coupons!.durationMs).toBeGreaterThan(0);

    expect(ambiguous!.status).toBe('failed');
    expect(ambiguous!.error).toMatch(/strict mode violation/);
    expect(manual!.status).toBe('untested');

    // Each artifact row owns a stored object.
    expect(artifacts).toHaveLength(4);
    for (const artifact of artifacts) {
      const stream = await storage.get(artifact.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk as Buffer);
      expect(Buffer.concat(chunks).length).toBe(artifact.sizeBytes);
    }
    expect(itemIds).toHaveLength(4);
  });

  it('blocks automated items when the before-run step fails, and still completes the run', async () => {
    const { runId } = await createRun(
      [{ title: 'Anything', steps: [{ action: 'goto', value: '/' }] }],
      [
        {
          id: 'broken-login',
          name: 'Sign in',
          phase: 'beforeRun',
          steps: withIds([
            { action: 'click', target: { strategy: 'text', value: 'No such button' } },
          ]),
        },
      ],
    );
    await executeRun(deps(), inOrg, { organizationId: orgId, runId });
    const { run, items } = await load(runId);
    expect(run.status).toBe('completed');
    expect(items[0]!.status).toBe('blocked');
    expect(items[0]!.error).toMatch(/^Global step "Sign in" \(before test run\) failed: /);
  });

  it('marks items blocked when the browser cannot start', async () => {
    const { runId } = await createRun([
      { title: 'Anything', steps: [{ action: 'goto', value: '/' }] },
    ]);
    await executeRun(
      { ...deps(), launch: async () => Promise.reject(new Error('missing executable')) },
      inOrg,
      { organizationId: orgId, runId },
    );
    const { run, items } = await load(runId);
    expect(run).toMatchObject({
      status: 'completed',
      error: 'The chromium browser could not start: missing executable',
    });
    expect(items[0]!.status).toBe('blocked');
  });

  it('stops between steps when the run is cancelled', async () => {
    const { runId } = await createRun([
      {
        title: 'Slow',
        steps: [
          { action: 'goto', value: '/' },
          { action: 'wait', value: '1500' },
          { action: 'wait', value: '1500' },
        ],
      },
      { title: 'Never', steps: [{ action: 'goto', value: '/' }] },
    ]);
    const running = executeRun(deps(), inOrg, { organizationId: orgId, runId });
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    // What the API does when someone cancels.
    await inOrg(async (tx) => {
      await tx
        .update(schema.testRuns)
        .set({ status: 'cancelled' })
        .where(eq(schema.testRuns.id, runId));
      await tx
        .update(schema.testRunItems)
        .set({ status: 'skipped' })
        .where(eq(schema.testRunItems.runId, runId));
    });
    await running;
    const { run, items } = await load(runId);
    expect(run.status).toBe('cancelled');
    expect(items.map((item) => item.status)).toEqual(['skipped', 'skipped']);
    expect(items[1]!.startedAt).toBeNull();
  });
});
