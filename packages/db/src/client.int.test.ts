import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, pingDb, withOrg, type DbHandle } from './client';
import { startPostgres } from './testing';

const ORG_A = '0192f5a0-0000-7000-8000-00000000000a';

let container: StartedPostgreSqlContainer;
let handle: DbHandle;

beforeAll(async () => {
  container = await startPostgres();
  // One connection, so the follow-up query is guaranteed to reuse the same session.
  handle = createDb(container.getConnectionUri(), { max: 1 });
});

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

async function currentOrgSetting(run: (q: ReturnType<typeof sql>) => Promise<unknown>) {
  const result = (await run(sql`SELECT current_setting('app.org_id', true) AS org`)) as {
    rows: { org: string | null }[];
  };
  return result.rows[0]?.org ?? null;
}

describe('withOrg', () => {
  it('exposes the organization id inside the transaction', async () => {
    const org = await withOrg(handle.db, ORG_A, (tx) => currentOrgSetting((q) => tx.execute(q)));
    expect(org).toBe(ORG_A);
  });

  it('does not leak the organization id to later queries on the same connection', async () => {
    await withOrg(handle.db, ORG_A, async () => {});
    const org = await currentOrgSetting((q) => handle.db.execute(q));
    expect(org === null || org === '').toBe(true);
  });

  it('clears the setting when the transaction fails', async () => {
    await expect(
      withOrg(handle.db, ORG_A, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    const org = await currentOrgSetting((q) => handle.db.execute(q));
    expect(org === null || org === '').toBe(true);
  });
});

describe('pingDb', () => {
  it('returns true for a reachable database', async () => {
    expect(await pingDb(handle.pool)).toBe(true);
  });
});

describe('connection loss', () => {
  it('survives the server dropping idle connections and reconnects', async () => {
    const errors: Error[] = [];
    const local = createDb(container.getConnectionUri(), {
      max: 2,
      onError: (e) => errors.push(e),
    });
    try {
      expect(await pingDb(local.pool)).toBe(true); // leaves an idle client in the pool
      await handle.pool.query(
        'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND datname = current_database()',
      );
      await new Promise((r) => setTimeout(r, 200));
      expect(errors.length).toBeGreaterThan(0);
      expect(await pingDb(local.pool)).toBe(true);
    } finally {
      await local.close();
    }
  });
});
