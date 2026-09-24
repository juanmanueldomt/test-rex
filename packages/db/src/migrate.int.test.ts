import { resolve } from 'node:path';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getMigrationStatus, migrate, MigrationError, readMigrations } from './migrate';
import { startPostgres, writeMigrationsDir } from './testing';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;

beforeAll(async () => {
  container = await startPostgres();
  pool = new pg.Pool({ connectionString: container.getConnectionUri() });
  // The shipped migrations grant privileges to the runtime role.
  await pool.query('CREATE ROLE testrex_app LOGIN');
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
});

describe('migrate', () => {
  it('applies the shipped migrations', async () => {
    const dir = resolve(import.meta.dirname, '../migrations');
    const result = await migrate({
      connectionString: container.getConnectionUri(),
      migrationsDir: dir,
    });
    expect(result.applied).toEqual(readMigrations(dir).map((m) => m.tag));
    expect(await getMigrationStatus(pool, dir)).toMatchObject({ pending: [] });
  });

  it('applies each migration exactly once when instances start concurrently', async () => {
    const dir = writeMigrationsDir({
      '0000_a': 'CREATE TABLE a (id int);',
      '0001_b': 'CREATE TABLE b (id int);\n--> statement-breakpoint\nINSERT INTO b VALUES (1);',
    });
    const run = () =>
      migrate({ connectionString: container.getConnectionUri(), migrationsDir: dir });

    const results = await Promise.all([run(), run(), run()]);

    const appliedCounts = results.map((r) => r.applied.length).sort();
    expect(appliedCounts).toEqual([0, 0, 2]);
    const rows = await pool.query('SELECT tag FROM _testrex_migrations ORDER BY tag');
    expect(rows.rows.map((r) => r.tag)).toEqual(['0000_a', '0001_b']);
    expect((await pool.query('SELECT count(*)::int AS n FROM b')).rows[0].n).toBe(1);
  });

  it('reports the failing migration by name and keeps earlier ones', async () => {
    const dir = writeMigrationsDir({
      '0000_ok': 'CREATE TABLE ok (id int);',
      '0001_broken': 'CREATE TABLE broken (id int);\n--> statement-breakpoint\nSELEC nonsense;',
    });

    const error = await migrate({
      connectionString: container.getConnectionUri(),
      migrationsDir: dir,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(MigrationError);
    expect((error as MigrationError).migration).toBe('0001_broken');
    const status = await getMigrationStatus(pool, dir);
    expect(status).toEqual({ expected: 2, applied: 1, pending: ['0001_broken'] });
    // The failed migration was rolled back as a whole.
    expect((await pool.query("SELECT to_regclass('broken') AS t")).rows[0].t).toBeNull();
  });

  it('reports pending migrations before anything is applied', async () => {
    const dir = writeMigrationsDir({ '0000_a': 'CREATE TABLE a (id int);' });
    expect(await getMigrationStatus(pool, dir)).toEqual({
      expected: 1,
      applied: 0,
      pending: ['0000_a'],
    });
  });
});
