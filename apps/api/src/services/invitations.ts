import { createHash, randomBytes } from 'node:crypto';
import type { Invitation, InvitationStatus } from '@testrex/contracts';
import { schema, withOrg, type Database } from '@testrex/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type InvitationRow = typeof schema.invitations.$inferSelect;
type OrganizationRow = typeof schema.organizations.$inferSelect;

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/**
 * Invitation links carry `<organizationId>.<secret>`. The organization id lets the server
 * look the invitation up inside that organization's RLS scope; only the SHA-256 of the
 * 32-byte secret is stored.
 */
export function createInvitationToken(organizationId: string): {
  token: string;
  tokenHash: string;
} {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${organizationId}.${secret}`, tokenHash: hashSecret(secret) };
}

export function parseInvitationToken(
  token: string,
): { organizationId: string; tokenHash: string } | null {
  const [organizationId, secret, ...rest] = token.split('.');
  if (rest.length > 0 || !secret || !z.uuid().safeParse(organizationId).success) return null;
  return { organizationId: organizationId!, tokenHash: hashSecret(secret) };
}

export function invitationLink(publicUrl: string, token: string): string {
  return `${publicUrl}/invite/${encodeURIComponent(token)}`;
}

export function invitationStatus(row: InvitationRow, now: Date): InvitationStatus {
  if (row.acceptedAt) return 'accepted';
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'pending';
}

export function toInvitation(row: InvitationRow, now: Date): Invitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: invitationStatus(row, now),
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    invitedBy: row.invitedBy,
  };
}

/** Resolves a token to its organization and invitation, or null if unknown. */
export async function findInvitation(
  db: Database,
  token: string,
): Promise<{ organization: OrganizationRow; invitation: InvitationRow } | null> {
  const parsed = parseInvitationToken(token);
  if (!parsed) return null;
  const [organization] = await db
    .select()
    .from(schema.organizations)
    .where(eq(schema.organizations.id, parsed.organizationId))
    .limit(1);
  if (!organization) return null;
  const [invitation] = await withOrg(db, organization.id, (tx) =>
    tx
      .select()
      .from(schema.invitations)
      .where(eq(schema.invitations.tokenHash, parsed.tokenHash))
      .limit(1),
  );
  return invitation ? { organization, invitation } : null;
}

/** Sign-up policy hook: a pending invitation addressed to this email. */
export async function isInvited(
  db: Database,
  email: string,
  token: string,
  now: Date,
): Promise<boolean> {
  const found = await findInvitation(db, token);
  return (
    found !== null &&
    invitationStatus(found.invitation, now) === 'pending' &&
    found.invitation.email === email.trim().toLowerCase()
  );
}
