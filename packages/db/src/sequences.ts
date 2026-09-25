import { sql } from 'drizzle-orm';
import type { Transaction } from './client';

export type SequenceKind = 'TS' | 'TC';

/**
 * Hands out the next number of a per-application counter (`CHK-TS-<n>`), starting at 1. The
 * upsert locks the counter row until the transaction ends, so concurrent creators in the same
 * application get distinct numbers; a rolled-back transaction leaves a gap, and numbers are
 * never reused. Must run inside the application's organization scope (RLS).
 */
export async function nextSequenceValue(
  tx: Transaction,
  applicationId: string,
  kind: SequenceKind,
): Promise<number> {
  const result = await tx.execute<{ last_value: number }>(sql`
    INSERT INTO sequences (organization_id, application_id, kind, last_value)
    VALUES (app_current_org(), ${applicationId}, ${kind}, 1)
    ON CONFLICT (application_id, kind)
      DO UPDATE SET last_value = sequences.last_value + 1
    RETURNING last_value`);
  const value = result.rows[0]?.last_value;
  if (value === undefined) throw new Error('sequence did not return a value');
  return Number(value);
}
