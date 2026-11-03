import type { AuditAction, SessionUser } from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';

export interface AuditInput {
  action: AuditAction;
  targetType:
    | 'organization'
    | 'user'
    | 'application'
    | 'invitation'
    | 'scenario'
    | 'module'
    | 'tag'
    | 'test_case'
    | 'dataset'
    | 'global_step'
    | 'run';
  targetId?: string | null;
  targetLabel?: string | null;
  changes?: Record<string, { from: unknown; to: unknown }>;
}

export function userLabel(user: { name: string; email: string }): string {
  return `${user.name} <${user.email}>`;
}

/**
 * Records an audit event in the same transaction as the change it describes, so either both
 * are stored or neither is.
 */
export async function audit(
  tx: Transaction,
  context: { organizationId: string; actor: SessionUser },
  input: AuditInput,
): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    organizationId: context.organizationId,
    actorUserId: context.actor.id,
    actorLabel: userLabel(context.actor),
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    targetLabel: input.targetLabel ?? null,
    changes: input.changes ?? {},
  });
}
