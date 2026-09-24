import type pg from 'pg';

/**
 * Lists tables in the public schema that have an `organization_id` column but are not
 * fully protected: RLS must be enabled and forced, and a policy must filter by
 * app_current_org(). Used by CI so a new tenant table cannot ship without isolation.
 */
export async function findUnprotectedTenantTables(pool: pg.Pool | pg.Client): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(`
    SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'organization_id' AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND (
         NOT c.relrowsecurity
         OR NOT c.relforcerowsecurity
         OR NOT EXISTS (
           SELECT 1 FROM pg_policies p
            WHERE p.schemaname = 'public'
              AND p.tablename = c.relname
              AND p.qual LIKE '%app_current_org()%'
              AND (p.cmd = 'ALL' AND p.with_check LIKE '%app_current_org()%')
         )
       )
     ORDER BY c.relname`);
  return result.rows.map((row) => row.table_name);
}

/** Lists tables that carry an `organization_id` column. */
export async function listTenantTables(pool: pg.Pool | pg.Client): Promise<string[]> {
  const result = await pool.query<{ table_name: string }>(`
    SELECT table_name FROM information_schema.columns
     WHERE table_schema = 'public' AND column_name = 'organization_id'
     ORDER BY table_name`);
  return result.rows.map((row) => row.table_name);
}
