// Organizations and everything scoped to them. Every table with an `organization_id`
// column is protected by Row-Level Security (see migrations/0002_tenant_isolation.sql).
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { newId } from './ids';

export const orgRole = pgEnum('org_role', ['owner', 'admin', 'member']);
export const appRole = pgEnum('app_role', ['manager', 'editor', 'tester', 'viewer']);

const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/** Global table: slugs must be unique across the instance. */
export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    name: text('name').notNull(),
    slug: text('slug').notNull().unique(),
    /** Billing plan for the cloud edition; always `self_hosted` on self-hosted instances. */
    plan: text('plan').notNull().default('self_hosted'),
    createdAt,
    updatedAt,
  },
  (t) => [
    check(
      'organizations_slug_format',
      sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(${t.slug}) BETWEEN 3 AND 40`,
    ),
  ],
);

const organizationId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRole('role').notNull(),
    createdAt,
  },
  (t) => [
    unique('memberships_org_user_key').on(t.organizationId, t.userId),
    index('memberships_user_id_idx').on(t.userId),
  ],
);

export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    /** Stored lowercase. */
    email: text('email').notNull(),
    role: orgRole('role').notNull(),
    /** SHA-256 of the secret part of the invitation link; the secret itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt,
  },
  (t) => [index('invitations_org_idx').on(t.organizationId, t.createdAt)],
);

export const applications = pgTable(
  'applications',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    name: text('name').notNull(),
    /** Immutable once created (enforced by trigger); prefixes item ids such as CHK-TC-142. */
    key: text('key').notNull(),
    description: text('description'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (t) => [
    unique('applications_org_key_key').on(t.organizationId, t.key),
    check('applications_key_format', sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`),
  ],
);

export const applicationMembers = pgTable(
  'application_members',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: appRole('role').notNull(),
    createdAt,
  },
  (t) => [
    unique('application_members_app_user_key').on(t.applicationId, t.userId),
    index('application_members_org_user_idx').on(t.organizationId, t.userId),
  ],
);

export interface AuditChange {
  from: unknown;
  to: unknown;
}

/** Append-only: the runtime database role has no UPDATE or DELETE grant on this table. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Actor name/email at the time of the event, kept if the user is later deleted. */
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    targetLabel: text('target_label'),
    changes: jsonb('changes').$type<Record<string, AuditChange>>().notNull().default({}),
    createdAt,
  },
  (t) => [
    index('audit_events_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_events_org_actor_idx').on(t.organizationId, t.actorUserId),
  ],
);
