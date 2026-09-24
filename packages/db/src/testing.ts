import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { migrate } from './migrate';

export const SHIPPED_MIGRATIONS_DIR = resolve(import.meta.dirname, '../migrations');

/** Starts a disposable PostgreSQL 16 container for integration tests. */
export function startPostgres(): Promise<StartedPostgreSqlContainer> {
  return new PostgreSqlContainer('postgres:16-alpine').start();
}

export interface TestDatabase {
  name: string;
  /** Schema owner (runs migrations, like DATABASE_MIGRATION_URL). */
  ownerUrl: string;
  /** Runtime role subject to Row-Level Security (like DATABASE_URL). */
  appUrl: string;
  /** Superuser connection for test setup that must bypass RLS. */
  superUrl: string;
}

const OWNER_PASSWORD = 'owner-password';
const APP_PASSWORD = 'app-password';

function withCredentials(baseUrl: string, user: string, password: string, database: string) {
  const url = new URL(baseUrl);
  url.username = user;
  url.password = password;
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * Creates the testrex_owner / testrex_app roles (as deploy/postgres/init-roles.sh does) and a
 * fresh database owned by testrex_owner. Migrations are applied unless `migrate` is false.
 */
export async function createTestDatabase(
  container: StartedPostgreSqlContainer,
  options: { migrate?: boolean; migrationsDir?: string } = {},
): Promise<TestDatabase> {
  const admin = new pg.Client({ connectionString: container.getConnectionUri() });
  await admin.connect();
  const name = `testrex_${randomBytes(6).toString('hex')}`;
  try {
    await admin.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'testrex_owner') THEN
          CREATE ROLE testrex_owner LOGIN PASSWORD '${OWNER_PASSWORD}';
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'testrex_app') THEN
          CREATE ROLE testrex_app LOGIN PASSWORD '${APP_PASSWORD}';
        END IF;
      END $$;`);
    await admin.query(`CREATE DATABASE ${name} OWNER testrex_owner`);
  } catch (error) {
    // Concurrent test files may race to create the roles; the second attempt sees them.
    if (!(error instanceof Error && /already exists/.test(error.message))) throw error;
    await admin.query(`CREATE DATABASE ${name} OWNER testrex_owner`);
  } finally {
    await admin.end();
  }

  const base = container.getConnectionUri();
  const db: TestDatabase = {
    name,
    ownerUrl: withCredentials(base, 'testrex_owner', OWNER_PASSWORD, name),
    appUrl: withCredentials(base, 'testrex_app', APP_PASSWORD, name),
    superUrl: withCredentials(base, container.getUsername(), container.getPassword(), name),
  };
  if (options.migrate !== false) {
    await migrate({
      connectionString: db.ownerUrl,
      migrationsDir: options.migrationsDir ?? SHIPPED_MIGRATIONS_DIR,
    });
  }
  return db;
}

/** Writes a drizzle-kit style migrations directory containing the given SQL files. */
export function writeMigrationsDir(migrations: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'testrex-migrations-'));
  mkdirSync(join(dir, 'meta'));
  const tags = Object.keys(migrations);
  for (const tag of tags) writeFileSync(join(dir, `${tag}.sql`), migrations[tag]!);
  const journal = {
    version: '7',
    dialect: 'postgresql',
    entries: tags.map((tag, idx) => ({ idx, version: '7', when: idx, tag, breakpoints: true })),
  };
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  return dir;
}
