// Database rules of test cases, runs and recordings: append-only versions, key sequences,
// serial command ids for the runtime role, and organization isolation.
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, withOrg, type DbHandle, type Transaction } from './client';
import { nextSequenceValue } from './sequences';
import {
  newId,
  recordingCommands,
  recordingSessions,
  scenarioRevisions,
  scenarios,
  testCaseScenarios,
  testCases,
  testCaseVersions,
} from './schema/index';
import { createTestDatabase, startPostgres, type TestDatabase } from './testing';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let superPool: pg.Pool;
let app: DbHandle;

const orgA = newId();
const orgB = newId();
const appChk = newId();
const appBil = newId();

async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: Error }).cause;
    return cause?.message ?? (error as Error).message;
  }
  throw new Error('expected the database to reject the query');
}

async function insertTestCase(tx: Transaction, organizationId: string, applicationId: string) {
  const scenarioId = newId();
  const revisionId = newId();
  await tx.insert(scenarios).values({
    id: scenarioId,
    organizationId,
    applicationId,
    number: 1,
    title: 'Checkout',
    currentRevision: 1,
    currentRevisionId: revisionId,
  });
  await tx.insert(scenarioRevisions).values({
    id: revisionId,
    organizationId,
    scenarioId,
    number: 1,
    title: 'Checkout',
    status: 'draft',
    priority: 'medium',
    descriptionMd: '',
    stepsMd: '',
    authorLabel: 'Ana',
  });
  const id = newId();
  const versionId = newId();
  const steps = [{ id: 's1', action: 'goto' as const, value: '/' }];
  await tx.insert(testCases).values({
    id,
    organizationId,
    applicationId,
    number: 1,
    title: 'Open home',
    steps,
    currentVersion: 1,
    currentVersionId: versionId,
  });
  await tx.insert(testCaseScenarios).values({ testCaseId: id, scenarioId, organizationId });
  await tx.insert(testCaseVersions).values({
    id: versionId,
    organizationId,
    testCaseId: id,
    number: 1,
    title: 'Open home',
    status: 'draft',
    priority: 'medium',
    executionMode: 'automated',
    descriptionMd: '',
    preconditionsMd: '',
    steps,
    scenarioIds: [scenarioId],
    source: 'editor',
    authorLabel: 'Ana',
  });
  return { id, versionId };
}

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  superPool = new pg.Pool({ connectionString: database.superUrl });
  app = createDb(database.appUrl, { max: 6 });
  await superPool.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acme', 'acme'), ($2, 'Beta', 'beta')`,
    [orgA, orgB],
  );
  await superPool.query(
    `INSERT INTO applications (id, organization_id, name, key)
     VALUES ($1, $3, 'Checkout', 'CHK'), ($2, $4, 'Billing', 'BIL')`,
    [appChk, appBil, orgA, orgB],
  );
});

afterAll(async () => {
  await app?.close();
  await superPool?.end();
  await container?.stop();
});

describe('test case versions', () => {
  it('are append-only for the runtime role', async () => {
    const { versionId } = await withOrg(app.db, orgA, (tx) => insertTestCase(tx, orgA, appChk));
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx
            .update(testCaseVersions)
            .set({ title: 'Changed' })
            .where(eq(testCaseVersions.id, versionId)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx.delete(testCaseVersions).where(eq(testCaseVersions.id, versionId)),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it('are invisible to other organizations', async () => {
    await withOrg(app.db, orgB, (tx) => insertTestCase(tx, orgB, appBil));
    const fromA = await withOrg(app.db, orgA, (tx) =>
      tx.select({ id: testCases.id, applicationId: testCases.applicationId }).from(testCases),
    );
    expect(fromA.every((row) => row.applicationId === appChk)).toBe(true);
    expect(await dbError(withOrg(app.db, orgA, (tx) => insertTestCase(tx, orgB, appBil)))).toMatch(
      /row-level security/,
    );
  });
});

describe('sequences', () => {
  it('hand out test case and run numbers independently', async () => {
    const numbers = await withOrg(app.db, orgA, async (tx) => [
      await nextSequenceValue(tx, appChk, 'TC'),
      await nextSequenceValue(tx, appChk, 'TC'),
      await nextSequenceValue(tx, appChk, 'TR'),
    ]);
    expect(numbers).toEqual([1, 2, 1]);
  });
});

describe('recording commands', () => {
  it('can be queued by the runtime role (serial id) and are consumed in order', async () => {
    const sessionId = newId();
    const ids = await withOrg(app.db, orgA, async (tx) => {
      await tx.insert(recordingSessions).values({
        id: sessionId,
        organizationId: orgA,
        applicationId: appChk,
        startUrl: 'https://example.com',
        viewportWidth: 1280,
        viewportHeight: 720,
      });
      await tx.insert(recordingCommands).values([
        { organizationId: orgA, sessionId, payload: { type: 'press', key: 'Tab' } },
        { organizationId: orgA, sessionId, payload: { type: 'stop' } },
      ]);
      return tx
        .delete(recordingCommands)
        .where(eq(recordingCommands.sessionId, sessionId))
        .returning({ id: recordingCommands.id, payload: recordingCommands.payload });
    });
    expect(ids).toHaveLength(2);
    expect(ids[0]!.id).toBeLessThan(ids[1]!.id);
  });
});
