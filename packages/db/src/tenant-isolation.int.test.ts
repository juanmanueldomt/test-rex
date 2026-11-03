import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, inspectRuntimeRole, withContext, withOrg, type DbHandle } from './client';
import { findUnprotectedTenantTables, listTenantTables } from './rls';
import { applications, auditEvents, memberships, newId } from './schema/index';
import { createTestDatabase, startPostgres, type TestDatabase } from './testing';

let container: StartedPostgreSqlContainer;
let database: TestDatabase;
let superPool: pg.Pool;
let app: DbHandle;

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

const orgA = newId();
const orgB = newId();
const userA = newId();
const userB = newId();

beforeAll(async () => {
  container = await startPostgres();
  database = await createTestDatabase(container);
  superPool = new pg.Pool({ connectionString: database.superUrl });
  app = createDb(database.appUrl);

  // Seed as superuser (bypasses RLS), as a fixture only.
  await superPool.query(
    `INSERT INTO users (id, name, email) VALUES ($1, 'Ana', 'ana@a.test'), ($2, 'Ben', 'ben@b.test')`,
    [userA, userB],
  );
  await superPool.query(
    `INSERT INTO organizations (id, name, slug) VALUES ($1, 'Acme', 'acme'), ($2, 'Beta', 'beta')`,
    [orgA, orgB],
  );
  await superPool.query(
    `INSERT INTO memberships (id, organization_id, user_id, role)
     VALUES ($1, $3, $5, 'owner'), ($2, $4, $6, 'owner'), ($7, $4, $5, 'member')`,
    [newId(), newId(), orgA, orgB, userA, userB, newId()],
  );
  await superPool.query(
    `INSERT INTO applications (id, organization_id, name, key)
     VALUES ($1, $3, 'Checkout', 'CHK'), ($2, $4, 'Billing', 'BIL')`,
    [newId(), newId(), orgA, orgB],
  );
  await superPool.query(
    `INSERT INTO audit_events (id, organization_id, actor_label, action, target_type)
     VALUES ($1, $2, 'Ana', 'organization.created', 'organization')`,
    [newId(), orgA],
  );
});

afterAll(async () => {
  await app?.close();
  await superPool?.end();
  await container?.stop();
});

describe('runtime role', () => {
  it('the application role does not bypass RLS, the superuser does', async () => {
    expect(await inspectRuntimeRole(app.pool)).toEqual({ role: 'testrex_app', bypassesRls: false });
    expect((await inspectRuntimeRole(superPool)).bypassesRls).toBe(true);
  });
});

describe('tenant isolation', () => {
  it('returns only the current organization rows even without a filter', async () => {
    const rows = await withOrg(app.db, orgA, (tx) => tx.select().from(applications));
    expect(rows.map((r) => r.key)).toEqual(['CHK']);
  });

  it('returns no rows and rejects writes without an organization context', async () => {
    expect(await app.db.select().from(applications)).toEqual([]);
    expect(await withContext(app.db, {}, (tx) => tx.select().from(applications))).toEqual([]);
    expect(
      await dbError(
        app.db.insert(applications).values({ organizationId: orgA, name: 'X', key: 'XX' }),
      ),
    ).toMatch(/row-level security/);
  });

  it('rejects inserting a row for another organization', async () => {
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx.insert(applications).values({ organizationId: orgB, name: 'Evil', key: 'EVL' }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('rejects moving a row to another organization', async () => {
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx.update(applications).set({ organizationId: orgB }).where(eq(applications.key, 'CHK')),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('cannot update or delete rows of another organization', async () => {
    const result = await withOrg(app.db, orgA, (tx) =>
      tx
        .update(applications)
        .set({ name: 'Hacked' })
        .where(eq(applications.key, 'BIL'))
        .returning(),
    );
    expect(result).toEqual([]);
    const deleted = await withOrg(app.db, orgA, (tx) =>
      tx.delete(applications).where(eq(applications.key, 'BIL')).returning(),
    );
    expect(deleted).toEqual([]);
  });

  it('lets a user list their own memberships across organizations, and nobody else', async () => {
    const mine = await withContext(app.db, { userId: userA }, (tx) =>
      tx.select().from(memberships),
    );
    expect(mine.map((m) => m.organizationId).sort()).toEqual([orgA, orgB].sort());
    expect(mine.every((m) => m.userId === userA)).toBe(true);
  });

  it('does not leak the context to the next transaction on the same connection', async () => {
    const single = createDb(database.appUrl, { max: 1 });
    try {
      await withOrg(single.db, orgA, (tx) => tx.select().from(applications));
      expect(await single.db.select().from(applications)).toEqual([]);
    } finally {
      await single.close();
    }
  });
});

describe('audit log', () => {
  it('is append-only for the application role', async () => {
    await withOrg(app.db, orgA, (tx) =>
      tx.insert(auditEvents).values({
        organizationId: orgA,
        actorLabel: 'Ana',
        action: 'test.inserted',
        targetType: 'test',
      }),
    );
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) => tx.update(auditEvents).set({ action: 'tampered' })),
      ),
    ).toMatch(/permission denied/);
    expect(await dbError(withOrg(app.db, orgA, (tx) => tx.delete(auditEvents)))).toMatch(
      /permission denied/,
    );
  });
});

describe('application keys', () => {
  it('cannot be changed once created', async () => {
    expect(
      await dbError(
        withOrg(app.db, orgA, (tx) =>
          tx.update(applications).set({ key: 'NEW' }).where(eq(applications.key, 'CHK')),
        ),
      ),
    ).toMatch(/application key cannot be changed/);
  });
});

describe('RLS coverage check', () => {
  it('every table with organization_id is protected', async () => {
    const tenantTables = await listTenantTables(superPool);
    expect(tenantTables).toEqual(
      expect.arrayContaining([
        'application_members',
        'applications',
        'attachments',
        'audit_events',
        'automation_settings',
        'datasets',
        'global_steps',
        'invitations',
        'llm_settings',
        'memberships',
        'modules',
        'recording_commands',
        'recording_sessions',
        'run_artifacts',
        'scenario_comments',
        'scenario_requirement_links',
        'scenario_revisions',
        'scenario_tags',
        'scenarios',
        'sequences',
        'tags',
        'test_case_scenarios',
        'test_case_tags',
        'test_case_versions',
        'test_cases',
        'test_run_items',
        'test_runs',
      ]),
    );
    expect(await findUnprotectedTenantTables(superPool)).toEqual([]);
  });

  it('flags a table whose policy is removed or whose RLS is not forced', async () => {
    const client = new pg.Client({ connectionString: database.superUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('DROP POLICY tenant_isolation ON invitations');
      await client.query('ALTER TABLE applications NO FORCE ROW LEVEL SECURITY');
      expect(await findUnprotectedTenantTables(client)).toEqual(['applications', 'invitations']);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
    expect(await findUnprotectedTenantTables(superPool)).toEqual([]);
  });

  it('flags a new tenant table created without RLS', async () => {
    const client = new pg.Client({ connectionString: database.superUrl });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query('CREATE TABLE forgotten (id uuid, organization_id uuid NOT NULL)');
      expect(await findUnprotectedTenantTables(client)).toEqual(['forgotten']);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
