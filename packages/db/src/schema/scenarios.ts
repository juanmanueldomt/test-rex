// Test scenarios and what classifies them (modules, tags). All tenant tables: RLS policies are
// created in the same migrations as the tables (0003_scenarios, 0004_scenario_collaboration).
import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { newId } from './ids';
import { applications, organizations } from './tenancy';

// Declaration order is the sort order: priority sorts by severity, most severe first.
export const scenarioStatus = pgEnum('scenario_status', ['draft', 'ready', 'deprecated']);
export const scenarioPriority = pgEnum('scenario_priority', ['critical', 'high', 'medium', 'low']);

const organizationId = () =>
  uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' });
const applicationId = () =>
  uuid('application_id')
    .notNull()
    .references(() => applications.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => users.id, { onDelete: 'set null' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/**
 * Per-application counters for human keys (`CHK-TS-12`). `last_value` is the number most
 * recently handed out; numbers are never reused, gaps are allowed.
 */
export const sequences = pgTable(
  'sequences',
  {
    organizationId: organizationId(),
    applicationId: applicationId(),
    /** `TS` (test scenarios); later `TC` (test cases). */
    kind: text('kind').notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [
    primaryKey({ name: 'sequences_pkey', columns: [t.applicationId, t.kind] }),
    check('sequences_kind', sql`${t.kind} ~ '^[A-Z]{2}$'`),
  ],
);

/** Flat, per-application groups of scenarios. Soft-deleted so old revisions keep their name. */
export const modules = pgTable(
  'modules',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    name: text('name').notNull(),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    uniqueIndex('modules_app_name_key')
      .on(t.applicationId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} IS NULL`),
    check('modules_name_length', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
  ],
);

/** Stored normalized (lowercase, no leading @); created the first time they are used. */
export const tags = pgTable(
  'tags',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    name: text('name').notNull(),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [unique('tags_app_name_key').on(t.applicationId, t.name)],
);

/**
 * Current state of each scenario (denormalized, so the grid filters and sorts on one table).
 * Every change also writes an immutable row in `scenario_revisions`.
 */
export const scenarios = pgTable(
  'scenarios',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    /** The `12` of `CHK-TS-12`; the key itself is derived from the immutable application key. */
    number: integer('number').notNull(),
    title: text('title').notNull(),
    status: scenarioStatus('status').notNull().default('draft'),
    priority: scenarioPriority('priority').notNull().default('medium'),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'restrict' }),
    /** Supported product versions as entered, plus zero-padded int[4] for comparison. */
    versionFrom: text('version_from'),
    versionFromParts: integer('version_from_parts').array(),
    versionTo: text('version_to'),
    versionToParts: integer('version_to_parts').array(),
    descriptionMd: text('description_md').notNull().default(''),
    stepsMd: text('steps_md').notNull().default(''),
    /** Folded (lowercase, no diacritics) title, rich text and linked issue keys. */
    searchText: text('search_text').notNull().default(''),
    currentRevision: integer('current_revision').notNull(),
    currentRevisionId: uuid('current_revision_id').notNull(),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedBy: userRef('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    unique('scenarios_app_number_key').on(t.applicationId, t.number),
    index('scenarios_app_updated_idx').on(t.applicationId, t.updatedAt),
    index('scenarios_app_module_idx').on(t.applicationId, t.moduleId),
    index('scenarios_app_created_by_idx').on(t.applicationId, t.createdBy),
    index('scenarios_search_text_trgm_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    check('scenarios_number_positive', sql`${t.number} > 0`),
    check('scenarios_title_length', sql`char_length(${t.title}) BETWEEN 1 AND 200`),
    check(
      'scenarios_version_parts',
      sql`(${t.versionFrom} IS NULL) = (${t.versionFromParts} IS NULL)
        AND (${t.versionTo} IS NULL) = (${t.versionToParts} IS NULL)
        AND (${t.versionFromParts} IS NULL OR cardinality(${t.versionFromParts}) = 4)
        AND (${t.versionToParts} IS NULL OR cardinality(${t.versionToParts}) = 4)`,
    ),
    check(
      'scenarios_version_range',
      sql`${t.versionFromParts} IS NULL OR ${t.versionToParts} IS NULL OR ${t.versionFromParts} <= ${t.versionToParts}`,
    ),
  ],
);

/** Current tags of each scenario (revisions keep their own copy as `tag_ids`). */
export const scenarioTags = pgTable(
  'scenario_tags',
  {
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => tags.id, { onDelete: 'cascade' }),
    organizationId: organizationId(),
  },
  (t) => [
    primaryKey({ name: 'scenario_tags_pkey', columns: [t.scenarioId, t.tagId] }),
    index('scenario_tags_tag_idx').on(t.tagId),
  ],
);

/**
 * Immutable full snapshots of a scenario, one per save (r1, r2, ...). Append-only: the runtime
 * database role has no UPDATE or DELETE grant. Future test runs reference `id` directly.
 */
export const scenarioRevisions = pgTable(
  'scenario_revisions',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    status: scenarioStatus('status').notNull(),
    priority: scenarioPriority('priority').notNull(),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'restrict' }),
    versionFrom: text('version_from'),
    versionTo: text('version_to'),
    descriptionMd: text('description_md').notNull(),
    stepsMd: text('steps_md').notNull(),
    /** Tags are never deleted, so ids stay resolvable; names are looked up on read. */
    tagIds: uuid('tag_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Revisioned fields that differ from the previous revision (computed at write time). */
    changedFields: text('changed_fields')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Number of the revision this one restored, if any. */
    restoredFrom: integer('restored_from'),
    authorId: userRef('author_id'),
    /** Author name at the time, kept if the user is later deleted. */
    authorLabel: text('author_label').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('scenario_revisions_scenario_number_key').on(t.scenarioId, t.number),
    check('scenario_revisions_number_positive', sql`${t.number} > 0`),
  ],
);

export const scenarioComments = pgTable(
  'scenario_comments',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    bodyMd: text('body_md').notNull(),
    /** Scenario revision that was current when the comment was written. */
    revisionNumber: integer('revision_number').notNull(),
    authorId: userRef('author_id'),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    /** Deleted comments leave the thread; the audit log keeps the record. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    index('scenario_comments_scenario_idx').on(t.scenarioId, t.createdAt),
    check('scenario_comments_body_length', sql`char_length(${t.bodyMd}) BETWEEN 1 AND 10000`),
  ],
);

export const requirementProvider = pgEnum('requirement_provider', [
  'jira',
  'github',
  'azure_devops',
  'other',
]);

export const scenarioRequirementLinks = pgTable(
  'scenario_requirement_links',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    scenarioId: uuid('scenario_id')
      .notNull()
      .references(() => scenarios.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    label: text('label'),
    provider: requirementProvider('provider').notNull(),
    /** `SHOP-481`, `owner/repo#42`, `#123`; searchable from the grid. */
    issueKey: text('issue_key'),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('scenario_requirement_links_scenario_url_key').on(t.scenarioId, t.url),
    check('scenario_requirement_links_url_scheme', sql`${t.url} ~* '^https?://'`),
  ],
);

/**
 * Files attached to scenarios. `scenario_id` NULL marks a pending upload (pasted into the new
 * scenario form) that is claimed when the scenario is saved or purged after 24 hours. Each row
 * owns exactly one storage object.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: uuid('id').primaryKey().$defaultFn(newId),
    organizationId: organizationId(),
    applicationId: applicationId(),
    scenarioId: uuid('scenario_id').references(() => scenarios.id, { onDelete: 'cascade' }),
    storageKey: text('storage_key').notNull().unique('attachments_storage_key_key'),
    fileName: text('file_name').notNull(),
    /** Detected from the content (magic bytes), not taken from the client. */
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: text('sha256').notNull(),
    uploadedBy: userRef('uploaded_by'),
    createdAt: createdAt(),
    /** Removed from the list; the object is kept so revisions that embed it still render. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: userRef('deleted_by'),
  },
  (t) => [
    index('attachments_scenario_idx').on(t.scenarioId),
    index('attachments_pending_idx')
      .on(t.organizationId, t.createdAt)
      .where(sql`${t.scenarioId} IS NULL`),
  ],
);
