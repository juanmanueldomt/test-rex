import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbHandle {
  pool: pg.Pool;
  db: Database;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  max?: number;
  /** Called when an idle connection fails (e.g. the database restarts). */
  onError?: (error: Error) => void;
}

export function createDb(connectionString: string, options: CreateDbOptions = {}): DbHandle {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  // Without a listener, an idle connection dropped by the server crashes the process.
  // The pool discards the broken client and opens a new one on the next query.
  pool.on('error', (error) => options.onError?.(error));
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}

/** Returns true when the database answers a trivial query. */
export async function pingDb(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export interface TenantContext {
  /** Organization whose rows are visible (`app.org_id`). */
  orgId?: string;
  /** Signed-in user (`app.user_id`); lets them list their own memberships across orgs. */
  userId?: string;
}

/**
 * Runs `fn` in a transaction with the given tenant context. Settings are transaction-local,
 * so they can never leak to other requests sharing the pooled connection. Row-Level
 * Security policies read them through app_current_org() / app_current_user().
 */
export async function withContext<T>(
  db: Database,
  context: TenantContext,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.org_id', ${context.orgId ?? ''}, true),
                 set_config('app.user_id', ${context.userId ?? ''}, true)`,
    );
    return fn(tx);
  });
}

/** Runs `fn` in a transaction scoped to one organization. */
export function withOrg<T>(
  db: Database,
  orgId: string,
  fn: (tx: Transaction) => Promise<T>,
  userId?: string,
): Promise<T> {
  return withContext(db, { orgId, userId }, fn);
}

export interface RuntimeRoleInfo {
  role: string;
  bypassesRls: boolean;
}

/** Reports whether the connected role would bypass Row-Level Security. */
export async function inspectRuntimeRole(pool: pg.Pool): Promise<RuntimeRoleInfo> {
  const result = await pool.query<{ role: string; bypasses: boolean }>(
    `SELECT current_user AS role, (rolsuper OR rolbypassrls) AS bypasses
       FROM pg_roles WHERE rolname = current_user`,
  );
  const row = result.rows[0];
  return { role: row?.role ?? 'unknown', bypassesRls: row?.bypasses ?? true };
}
