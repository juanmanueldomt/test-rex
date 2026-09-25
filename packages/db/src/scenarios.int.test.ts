import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withOrg, type DbHandle, type Transaction } from './client';
import { nextSequenceValue } from './sequences';
import { modules, newId, scenarioRevisions, scenarios } from './schema/index';
import { createTestDatabase, startPostgres, type TestDatabase } from './testing';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let superPool: pg.Pool;
let app: DbHandle;

const orgA = newId();
const orgB = newId();
const appChk = newId();
const appPay = newId();
const appBil = newId();

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: Error }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error('expected the database to reject the query');
}

async function insertScenario(tx: Transaction, applicationId: string, number: number) {
  const id = newId();
  const revisionId = newId();
  await tx.insert(scenarios).values({
    id,
    organizationId: orgA,
    applicationId,
    number,
    title: `Scenario ${number}`,
    currentRevision: 1,
    currentRevisionId: revisionId,
  });
  await tx.insert(scenarioRevisions).values({
    id: revisionId,
    organizationId: orgA,
    scenarioId: id,
    number: 1,
    title: `Scenario ${number}`,
    status: 'draft',
    priority: 'medium',
    descriptionMd: '',
    stepsMd: '',
    authorLabel: 'Ana',
  });
  return { id, revisionId };
}

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  superPool = new pg.Pool({ connectionString: database.superUrl });
  app = createDb(database.appUrl, { max: 12 });
  await superPool.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acme', 'acme'), ($2, 'Beta', 'beta')`,
    [orgA, orgB],
  );
  await superPool.query(
    `INSERT INTO applications (id, organization_id, name, key)
     VALUES ($1, $4, 'Checkout', 'CHK'), ($2, $4, 'Payments', 'PAY'), ($3, $5, 'Billing', 'BIL')`,
    [appChk, appPay, appBil, orgA, orgB],
  );
});

afterAll(async () => {
  await app?.close();
  await superPool?.end();
  await container?.stop();
});

describe('schema', () => {
  it('installs pg_trgm and a trigram index on search_text', async () => {
    const ext = await superPool.query(`SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'`);
    expect(ext.rowCount).toBe(1);
    const index = await superPool.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'scenarios_search_text_trgm_idx'`,
    );
    expect(index.rows[0].indexdef).toMatch(/USING gin \(search_text gin_trgm_ops\)/);
  });

  it('declares the foreign keys and unique constraints of the new tables', async () => {
    const constraints = await superPool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname IN ('scenarios', 'scenario_revisions', 'scenario_comments',
                            'scenario_requirement_links', 'attachments', 'tags', 'scenario_tags')
          AND c.contype IN ('f', 'u')`,
    );
    const names = constraints.rows.map((row) => row.conname);
    expect(names).toEqual(
      expect.arrayContaining([
        'scenarios_app_number_key',
        'scenarios_module_id_modules_id_fk',
        'scenario_revisions_scenario_number_key',
        'scenario_revisions_scenario_id_scenarios_id_fk',
        'scenario_comments_scenario_id_scenarios_id_fk',
        'scenario_requirement_links_scenario_url_key',
        'attachments_storage_key_key',
        'attachments_scenario_id_scenarios_id_fk',
        'tags_app_name_key',
        'scenario_tags_tag_id_tags_id_fk',
      ]),
    );
  });

  it('rejects an inverted version range and malformed parts', async () => {
    const insert = (from: number[], to: number[]) =>
      withOrg(app.db, orgA, (tx) =>
        tx.insert(scenarios).values({
          organizationId: orgA,
          applicationId: appChk,
          number: 900 + from[0]!,
          title: 'Range',
          versionFrom: from.join('.'),
          versionFromParts: from,
          versionTo: to.join('.'),
          versionToParts: to,
          currentRevision: 1,
          currentRevisionId: newId(),
        }),
      );
    expect(await dbError(insert([3, 2, 0, 0], [3, 1, 0, 0]))).toMatch(/scenarios_version_range/);
    expect(await dbError(insert([3, 2], [3, 3]))).toMatch(/scenarios_version_parts/);
    await expect(insert([3, 9, 0, 0], [3, 10, 0, 0])).resolves.toBeDefined();
  });

  it('module names are unique per application ignoring case, except deleted ones', async () => {
    const create = (applicationId: string, name: string, deletedAt: Date | null = null) =>
      withOrg(app.db, orgA, (tx) =>
        tx.insert(modules).values({ organizationId: orgA, applicationId, name, deletedAt }),
      );
    await create(appChk, 'Checkout');
    expect(await dbError(create(appChk, 'checkout'))).toMatch(/modules_app_name_key/);
    await expect(create(appPay, 'checkout')).resolves.toBeDefined();
    await expect(create(appChk, 'Search', new Date())).resolves.toBeDefined();
    await expect(create(appChk, 'Search')).resolves.toBeDefined();
  });
});

describe('scenario revisions', () => {
  it('are append-only for the runtime role', async () => {
    const { revisionId } = await withOrg(app.db, orgA, (tx) => insertScenario(tx, appChk, 500));
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx
            .update(scenarioRevisions)
            .set({ title: 'tampered' })
            .where(eq(scenarioRevisions.id, revisionId)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx.delete(scenarioRevisions).where(eq(scenarioRevisions.id, revisionId)),
        ),
      ),
    ).toMatch(/permission denied/);
    const [row] = await withOrg(app.db, orgA, (tx) =>
      tx.select().from(scenarioRevisions).where(eq(scenarioRevisions.id, revisionId)),
    );
    expect(row?.title).toBe('Scenario 500');
  });

  it('are invisible to other organizations', async () => {
    const rows = await withOrg(app.db, orgB, (tx) => tx.select().from(scenarioRevisions));
    expect(rows).toEqual([]);
  });
});

describe('nextSequenceValue', () => {
  it('starts at 1 and counts per application and kind', async () => {
    const next = (applicationId: string, orgId = orgA, kind: 'TS' | 'TC' = 'TS') =>
      withOrg(app.db, orgId, (tx) => nextSequenceValue(tx, applicationId, kind));
    const [bil1] = [await next(appBil, orgB)];
    expect(bil1).toBe(1);
    expect(await next(appBil, orgB)).toBe(2);
    expect(await next(appBil, orgB, 'TC')).toBe(1);
  });

  it('gives parallel transactions distinct numbers', async () => {
    const numbers = await Promise.all(
      Array.from({ length: 10 }, () =>
        withOrg(app.db, orgA, async (tx) => {
          const n = await nextSequenceValue(tx, appPay, 'TS');
          // Hold the transaction open briefly so the creators really overlap.
          await new Promise((resolve) => setTimeout(resolve, 20));
          return n;
        }),
      ),
    );
    expect(new Set(numbers).size).toBe(10);
    expect([...numbers].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('never reuses the number of a deleted scenario', async () => {
    const created = await withOrg(app.db, orgA, async (tx) => {
      const n = await nextSequenceValue(tx, appChk, 'TS');
      return { n, ...(await insertScenario(tx, appChk, n)) };
    });
    await withOrg(app.db, orgA, (tx) =>
      tx.update(scenarios).set({ deletedAt: new Date() }).where(eq(scenarios.id, created.id)),
    );
    const next = await withOrg(app.db, orgA, (tx) => nextSequenceValue(tx, appChk, 'TS'));
    expect(next).toBe(created.n + 1);
  });

  it('does not hand out a duplicate when a creating transaction rolls back', async () => {
    const before = await withOrg(app.db, orgA, (tx) => nextSequenceValue(tx, appChk, 'TS'));
    await withOrg(app.db, orgA, async (tx) => {
      await nextSequenceValue(tx, appChk, 'TS');
      tx.rollback();
    }).catch(() => {});
    const after = await withOrg(app.db, orgA, (tx) => nextSequenceValue(tx, appChk, 'TS'));
    // The rolled-back increment is undone, so the counter continues right after `before`.
    expect(after).toBe(before + 1);
  });
});
