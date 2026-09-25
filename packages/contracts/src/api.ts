// Request schemas and response types of the REST API. Validation messages are i18n keys.
import { z } from 'zod';
import { appKeySchema, orgSlugSchema } from './identifiers';
import {
  APP_ROLES,
  ORG_ROLES,
  type AppPermission,
  type AppRole,
  type OrgPermission,
  type OrgRole,
} from './permissions';

export const MIN_PASSWORD_LENGTH = 10;

export const signUpSchema = z.object({
  name: z.string().trim().min(1, 'name.required').max(100),
  email: z.email('email.invalid'),
  password: z.string().min(MIN_PASSWORD_LENGTH, 'password.tooShort').max(128),
});

export const signInSchema = z.object({
  email: z.email('email.invalid'),
  password: z.string().min(1, 'password.required'),
});

export const createOrgSchema = z.object({
  name: z.string().trim().min(1, 'name.required').max(80),
  slug: orgSlugSchema.optional(),
});

export const renameOrgSchema = z.object({
  name: z.string().trim().min(1, 'name.required').max(80),
});

export const orgRoleSchema = z.enum(ORG_ROLES);
export const appRoleSchema = z.enum(APP_ROLES);

export const updateMemberSchema = z.object({ role: orgRoleSchema });

export const createInvitationSchema = z.object({
  email: z.email('email.invalid'),
  role: orgRoleSchema,
});

export const createAppSchema = z.object({
  name: z.string().trim().min(1, 'name.required').max(80),
  key: appKeySchema,
  description: z.string().trim().max(500).optional(),
});

/** `key` is accepted only to return a clear error: keys are immutable. */
export const updateAppSchema = z
  .object({
    name: z.string().trim().min(1, 'name.required').max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    key: z.string().optional(),
  })
  .strict();

export const setAppMemberSchema = z.object({ role: appRoleSchema });

export const auditQuerySchema = z.object({
  actorId: z.uuid().optional(),
  action: z.string().max(100).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** Cursor: id of the last event of the previous page (ids are time-ordered UUIDv7). */
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const AUDIT_ACTIONS = [
  'organization.created',
  'organization.renamed',
  'member.invited',
  'member.joined',
  'member.removed',
  'member.left',
  'member.role_changed',
  'invitation.revoked',
  'application.created',
  'application.renamed',
  'application.updated',
  'application.archived',
  'application.restored',
  'application.member_role_changed',
  'scenario.created',
  'scenario.updated',
  'scenario.deleted',
  'scenario.restored',
  'scenario.revision_restored',
  'module.created',
  'module.renamed',
  'module.deleted',
  'tag.created',
  'comment.created',
  'comment.edited',
  'comment.deleted',
  'requirement_link.added',
  'requirement_link.updated',
  'requirement_link.removed',
  'attachment.uploaded',
  'attachment.removed',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Body of every API error response. */
export interface ApiErrorBody {
  code: string;
  message: string;
  [extra: string]: unknown;
}

export interface InstanceInfo {
  /** Anyone may register (otherwise an invitation is required). */
  signupEnabled: boolean;
  /** No account exists yet: the first person to register becomes instance administrator. */
  needsSetup: boolean;
  emailDelivery: boolean;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  isInstanceAdmin: boolean;
}

export interface OrgSummary {
  id: string;
  slug: string;
  name: string;
  role: OrgRole;
}

export interface MeResponse {
  user: SessionUser;
  organizations: OrgSummary[];
  lastOrganizationSlug: string | null;
}

export interface OrgContext extends OrgSummary {
  plan: string;
  permissions: OrgPermission[];
}

export interface AppSummary {
  id: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  role: AppRole;
}

export interface AppContext extends AppSummary {
  permissions: AppPermission[];
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: OrgRole;
  joinedAt: string;
}

export interface AppMember {
  userId: string;
  name: string;
  email: string;
  orgRole: OrgRole;
  /** Role granted on this application, if any. */
  appRole: AppRole | null;
  /** Role in effect: owners and admins are implicit managers. */
  effectiveRole: AppRole | null;
  implicit: boolean;
}

export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
  invitedBy: string | null;
}

export interface CreateInvitationResponse {
  invitation: Invitation;
  /** How the link reached the invitee; `link` means it must be shared manually. */
  delivery: 'email' | 'link';
  /** Present when delivery is `link`. */
  link?: string;
}

export interface InvitationPreview {
  organization: { name: string; slug: string };
  email: string;
  role: OrgRole;
  status: InvitationStatus;
  expiresAt: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  actor: { id: string | null; label: string };
  target: { type: string; id: string | null; label: string | null };
  changes: Record<string, { from: unknown; to: unknown }>;
  createdAt: string;
}

export interface AuditPage {
  events: AuditEvent[];
  nextCursor: string | null;
}
