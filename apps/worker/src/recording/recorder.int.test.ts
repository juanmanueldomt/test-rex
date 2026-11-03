// The recorder against a real Chromium: input arrives as queued commands, steps come out with
// locators that match exactly the element that was used.
import { createLogger } from '@testrex/config';
import type { RecordingCommand } from '@testrex/contracts';
import { createDb, schema, withOrg, type DbHandle } from '@testrex/db';
import { createTestDatabase, startPostgres, type TestDatabase } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { launchBrowser } from '../execution/browsers';
import type { InOrg } from '../execution/run-executor';
import { startSite, type FixtureSite } from '../testing/site';
import { runRecordingSession } from './recorder';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let handle: DbHandle;
let site: FixtureSite;
let browser: Browser;
const logger = createLogger({ level: 'silent' });
const orgId = schema.newId();
const appId = schema.newId();
const inOrg: InOrg = (fn) => withOrg(handle.db, orgId, fn);

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  handle = createDb(database.appUrl);
  site = await startSite();
  browser = await launchBrowser('chromium');
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
  await browser?.close();
  await handle?.close();
  await site?.close();
  await container?.stop();
});

/** Centre of an element of the cart page, as the live view would send it. */
async function centre(selector: string, path = '/cart') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await page.goto(`${site.url}${path}`);
    const box = (await page.locator(selector).boundingBox())!;
    return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  } finally {
    await page.close();
  }
}

async function session(sessionId: string) {
  const [row] = await inOrg((tx) =>
    tx.select().from(schema.recordingSessions).where(eq(schema.recordingSessions.id, sessionId)),
  );
  return row!;
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** Sends commands one at a time and waits until the recorder consumed each one. */
async function send(sessionId: string, command: RecordingCommand) {
  await inOrg((tx) =>
    tx
      .insert(schema.recordingCommands)
      .values({ organizationId: orgId, sessionId, payload: command }),
  );
  await waitFor(async () => {
    const pending = await inOrg((tx) =>
      tx
        .select({ id: schema.recordingCommands.id })
        .from(schema.recordingCommands)
        .where(eq(schema.recordingCommands.sessionId, sessionId)),
    );
    return pending.length === 0;
  });
  // Let the recorder finish applying the command and storing the result.
  await new Promise((resolve) => setTimeout(resolve, 600));
}

describe('runRecordingSession', () => {
  it('records clicks, typing, checkboxes, selects and assertions with unique locators', async () => {
    // Addresses on the base URL's origin are recorded as paths, so the test stays portable.
    await inOrg((tx) =>
      tx
        .insert(schema.automationSettings)
        .values({ applicationId: appId, organizationId: orgId, baseUrl: site.url }),
    );
    const coupon = await centre('#coupon');
    const apply = await centre('#apply');
    const total = await centre('[data-testid=total]');
    const gift = await centre('#gift');
    const country = await centre('#country');
    const secondRemove = await centre('li:nth-child(2) button');
    const sessionId = schema.newId();
    await inOrg((tx) =>
      tx.insert(schema.recordingSessions).values({
        id: sessionId,
        organizationId: orgId,
        applicationId: appId,
        startUrl: `${site.url}/cart`,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    );

    const recording = runRecordingSession(
      { logger, launch: () => launchBrowser('chromium'), pollMs: 50 },
      inOrg,
      { organizationId: orgId, sessionId },
    );
    await waitFor(async () => (await session(sessionId)).frameVersion > 0);
    expect((await session(sessionId)).status).toBe('active');

    await send(sessionId, { type: 'click', ...coupon });
    await send(sessionId, { type: 'type', text: 'SAV' });
    await send(sessionId, { type: 'type', text: 'E10' });
    await send(sessionId, { type: 'click', ...apply });
    await send(sessionId, { type: 'inspect', ...total });
    await send(sessionId, { type: 'assert', assertion: 'expectText' });
    await send(sessionId, { type: 'click', ...gift });
    await send(sessionId, { type: 'click', ...country });
    expect((await session(sessionId)).element?.options).toEqual([
      { value: 'es', label: 'Spain' },
      { value: 'ar', label: 'Argentina' },
    ]);
    await send(sessionId, { type: 'select', value: 'ar' });
    await send(sessionId, { type: 'click', ...secondRemove });
    await send(sessionId, { type: 'assert', assertion: 'expectTitle' });
    await send(sessionId, { type: 'assert', assertion: 'expectUrl' });
    await send(sessionId, { type: 'stop' });
    const result = await recording;
    expect(result.status).toBe('stopped');

    const stored = await session(sessionId);
    expect(stored.status).toBe('stopped');
    expect(stored.endedAt).not.toBeNull();
    expect(stored.frame?.length).toBeGreaterThan(1000);
    expect(stored.steps.map(({ id: _id, ...step }) => step)).toEqual([
      { action: 'goto', value: '/cart' },
      {
        action: 'fill',
        target: { strategy: 'role', value: 'textbox', name: 'Coupon' },
        value: 'SAVE10',
      },
      { action: 'click', target: { strategy: 'role', value: 'button', name: 'Apply' } },
      { action: 'expectText', target: { strategy: 'testId', value: 'total' }, value: '90' },
      { action: 'check', target: { strategy: 'role', value: 'checkbox', name: 'Gift wrap' } },
      {
        action: 'select',
        target: { strategy: 'role', value: 'combobox', name: 'Country' },
        value: 'Argentina',
      },
      { action: 'click', target: { strategy: 'role', value: 'button', name: 'Remove', nth: 1 } },
      { action: 'expectTitle', value: 'Cart' },
      { action: 'expectUrl', value: '/cart' },
    ]);
  });

  it('expires after the idle time', async () => {
    const sessionId = schema.newId();
    await inOrg((tx) =>
      tx.insert(schema.recordingSessions).values({
        id: sessionId,
        organizationId: orgId,
        applicationId: appId,
        startUrl: `${site.url}/`,
        viewportWidth: 800,
        viewportHeight: 600,
      }),
    );
    const result = await runRecordingSession(
      { logger, launch: () => launchBrowser('chromium'), pollMs: 50, idleMs: 800 },
      inOrg,
      { organizationId: orgId, sessionId },
    );
    expect(result).toEqual({ status: 'expired', steps: 1 });
    expect((await session(sessionId)).status).toBe('expired');
  });
});
