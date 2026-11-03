// Scenario domain logic shared by the scenario, revision and collaboration routes. Every
// function runs inside the caller's organization-scoped transaction (RLS) and scopes its
// queries to the request's application.
import {
  foldForSearch,
  formatScenarioKey,
  paddedVersionParts,
  parseScenarioKey,
  RICH_TEXT_FIELDS,
  SCENARIO_REVISION_FIELDS,
  type FieldChange,
  type ModuleRef,
  type Scenario,
  type ScenarioField,
  type ScenarioPriority,
  type ScenarioStatus,
  type SessionUser,
  type UserRef,
} from '@testrex/contracts';
import { nextSequenceValue, schema, type Transaction } from '@testrex/db';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { badRequest, conflict, notFound } from '../http/errors';
import type { RequestApp } from '../http/guards';
import { claimAttachmentReferences } from './attachments';
import { audit } from './audit';

export type ScenarioRow = typeof schema.scenarios.$inferSelect;
export type RevisionRow = typeof schema.scenarioRevisions.$inferSelect;

/** Who is acting, where, and when. */
export interface ScenarioContext {
  organizationId: string;
  app: RequestApp;
  user: SessionUser;
  now: Date;
}

/** The revisioned fields in storage form. */
export interface ScenarioState {
  title: string;
  status: ScenarioStatus;
  priority: ScenarioPriority;
  moduleId: string | null;
  /** Sorted, so states compare by value. */
  tagIds: string[];
  versionFrom: string | null;
  versionTo: string | null;
  description: string;
  stepsToReach: string;
}

export function scenarioKey(app: { key: string }, row: { number: number }): string {
  return formatScenarioKey(app.key, row.number);
}

export function scenarioLabel(app: { key: string }, row: { number: number; title: string }) {
  return `${scenarioKey(app, row)} · ${row.title}`;
}

/**
 * Finds a scenario of the request's application by key (`CHK-TS-12` or `12`), including
 * deleted ones. Unknown keys and keys of other applications are 404.
 */
export async function findScenario(
  tx: Transaction,
  app: RequestApp,
  key: string,
  options: { forUpdate?: boolean } = {},
): Promise<ScenarioRow> {
  const number = parseScenarioKey(key, app.key);
  if (number === null) throw notFound();
  const query = tx
    .select()
    .from(schema.scenarios)
    .where(and(eq(schema.scenarios.applicationId, app.id), eq(schema.scenarios.number, number)))
    .limit(1);
  const [row] = await (options.forUpdate ? query.for('update') : query);
  if (!row) throw notFound();
  return row;
}

/** Deleted scenarios are read-only until restored. */
export function assertNotDeleted(row: ScenarioRow): void {
  if (row.deletedAt) {
    throw conflict('SCENARIO_DELETED', 'This scenario is deleted. Restore it to make changes.');
  }
}

export async function currentTagIds(tx: Transaction, scenarioId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: schema.scenarioTags.tagId })
    .from(schema.scenarioTags)
    .where(eq(schema.scenarioTags.scenarioId, scenarioId));
  return rows.map((row) => row.id).sort();
}

export function stateOf(row: ScenarioRow | RevisionRow, tagIds: string[]): ScenarioState {
  return {
    title: row.title,
    status: row.status,
    priority: row.priority,
    moduleId: row.moduleId,
    tagIds: [...tagIds].sort(),
    versionFrom: row.versionFrom,
    versionTo: row.versionTo,
    description: row.descriptionMd,
    stepsToReach: row.stepsMd,
  };
}

const STATE_KEYS: Record<ScenarioField, keyof ScenarioState> = {
  title: 'title',
  status: 'status',
  priority: 'priority',
  module: 'moduleId',
  tags: 'tagIds',
  versionFrom: 'versionFrom',
  versionTo: 'versionTo',
  description: 'description',
  stepsToReach: 'stepsToReach',
};

export function changedFields(before: ScenarioState, after: ScenarioState): ScenarioField[] {
  return SCENARIO_REVISION_FIELDS.filter((field) => {
    const key = STATE_KEYS[field];
    return JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  });
}

/**
 * Attaches tags by name, creating the ones the application does not have yet (each creation
 * is audited). Names must already be normalized.
 */
export async function resolveTags(
  tx: Transaction,
  ctx: ScenarioContext,
  names: string[],
): Promise<{ id: string; name: string }[]> {
  if (names.length === 0) return [];
  const created = await tx
    .insert(schema.tags)
    .values(
      names.map((name) => ({
        organizationId: ctx.organizationId,
        applicationId: ctx.app.id,
        name,
        createdBy: ctx.user.id,
        createdAt: ctx.now,
      })),
    )
    .onConflictDoNothing({ target: [schema.tags.applicationId, schema.tags.name] })
    .returning({ id: schema.tags.id, name: schema.tags.name });
  for (const tag of created) {
    await audit(
      tx,
      { organizationId: ctx.organizationId, actor: ctx.user },
      {
        action: 'tag.created',
        targetType: 'tag',
        targetId: tag.id,
        targetLabel: `${ctx.app.key} · @${tag.name}`,
        changes: { name: { from: null, to: tag.name } },
      },
    );
  }
  return tx
    .select({ id: schema.tags.id, name: schema.tags.name })
    .from(schema.tags)
    .where(and(eq(schema.tags.applicationId, ctx.app.id), inArray(schema.tags.name, names)));
}

/** A module the scenario may be assigned to: in this application and not deleted. */
export async function requireModule(
  tx: Transaction,
  app: RequestApp,
  moduleId: string,
): Promise<ModuleRef> {
  const [row] = await tx
    .select({ id: schema.modules.id, name: schema.modules.name })
    .from(schema.modules)
    .where(
      and(
        eq(schema.modules.id, moduleId),
        eq(schema.modules.applicationId, app.id),
        isNull(schema.modules.deletedAt),
      ),
    );
  if (!row) {
    throw badRequest('MODULE_NOT_FOUND', 'The selected module does not exist.', {
      issues: [{ path: 'moduleId', message: 'module.notFound' }],
    });
  }
  return row;
}

export async function issueKeysOf(tx: Transaction, scenarioId: string): Promise<string[]> {
  const rows = await tx
    .select({ issueKey: schema.scenarioRequirementLinks.issueKey })
    .from(schema.scenarioRequirementLinks)
    .where(eq(schema.scenarioRequirementLinks.scenarioId, scenarioId));
  return rows.flatMap((row) => (row.issueKey ? [row.issueKey] : []));
}

export function buildSearchText(
  state: Pick<ScenarioState, 'title' | 'description' | 'stepsToReach'>,
  issueKeys: string[],
): string {
  return foldForSearch(
    [state.title, state.description, state.stepsToReach, ...issueKeys].join('\n'),
  );
}

/** Recomputes the search text after requirement links change. */
export async function refreshSearchText(tx: Transaction, row: ScenarioRow): Promise<void> {
  const searchText = buildSearchText(stateOf(row, []), await issueKeysOf(tx, row.id));
  await tx.update(schema.scenarios).set({ searchText }).where(eq(schema.scenarios.id, row.id));
}

function versionColumns(state: ScenarioState) {
  return {
    versionFrom: state.versionFrom,
    versionFromParts: state.versionFrom ? paddedVersionParts(state.versionFrom) : null,
    versionTo: state.versionTo,
    versionToParts: state.versionTo ? paddedVersionParts(state.versionTo) : null,
  };
}

async function insertRevision(
  tx: Transaction,
  ctx: ScenarioContext,
  scenarioId: string,
  number: number,
  state: ScenarioState,
  changed: ScenarioField[],
  restoredFrom: number | null,
  id: string = schema.newId(),
): Promise<RevisionRow> {
  const [row] = await tx
    .insert(schema.scenarioRevisions)
    .values({
      id,
      organizationId: ctx.organizationId,
      scenarioId,
      number,
      title: state.title,
      status: state.status,
      priority: state.priority,
      moduleId: state.moduleId,
      versionFrom: state.versionFrom,
      versionTo: state.versionTo,
      descriptionMd: state.description,
      stepsMd: state.stepsToReach,
      tagIds: state.tagIds,
      changedFields: changed,
      restoredFrom,
      authorId: ctx.user.id,
      authorLabel: ctx.user.name,
      createdAt: ctx.now,
    })
    .returning();
  return row!;
}

/** Module and tag names for audit entries. */
async function describeState(tx: Transaction, states: ScenarioState[]) {
  const moduleIds = [...new Set(states.flatMap((s) => (s.moduleId ? [s.moduleId] : [])))];
  const tagIds = [...new Set(states.flatMap((s) => s.tagIds))];
  const modules = moduleIds.length
    ? await tx
        .select({ id: schema.modules.id, name: schema.modules.name })
        .from(schema.modules)
        .where(inArray(schema.modules.id, moduleIds))
    : [];
  const tags = tagIds.length
    ? await tx
        .select({ id: schema.tags.id, name: schema.tags.name })
        .from(schema.tags)
        .where(inArray(schema.tags.id, tagIds))
    : [];
  const moduleName = new Map(modules.map((m) => [m.id, m.name]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  return {
    module: (state: ScenarioState) =>
      state.moduleId ? (moduleName.get(state.moduleId) ?? null) : null,
    tags: (state: ScenarioState) =>
      state.tagIds.map((id) => tagName.get(id) ?? id).sort((a, b) => a.localeCompare(b)),
  };
}

/**
 * Audit changes for a save: scalar values from/to, module and tag names, and rich text as the
 * revision numbers only.
 */
async function auditChanges(
  tx: Transaction,
  before: ScenarioState | null,
  after: ScenarioState,
  changed: ScenarioField[],
  revisions: { from: number | null; to: number },
): Promise<Record<string, FieldChange>> {
  const names = await describeState(tx, before ? [before, after] : [after]);
  const changes: Record<string, FieldChange> = {};
  for (const field of changed) {
    if (RICH_TEXT_FIELDS.includes(field)) {
      changes[field] = {
        from: revisions.from === null ? null : `r${revisions.from}`,
        to: `r${revisions.to}`,
      };
    } else if (field === 'module') {
      changes.module = { from: before ? names.module(before) : null, to: names.module(after) };
    } else if (field === 'tags') {
      changes.tags = { from: before ? names.tags(before) : [], to: names.tags(after) };
    } else {
      const key = STATE_KEYS[field];
      changes[field] = { from: before ? before[key] : null, to: after[key] };
    }
  }
  return changes;
}

export interface CreateScenarioData extends Omit<ScenarioState, 'tagIds'> {
  tags: string[];
}

/** Creates a scenario with the next key number and revision r1. */
export async function createScenario(
  tx: Transaction,
  ctx: ScenarioContext,
  input: CreateScenarioData,
): Promise<ScenarioRow> {
  if (input.moduleId) await requireModule(tx, ctx.app, input.moduleId);
  const tags = await resolveTags(tx, ctx, input.tags);
  const state: ScenarioState = { ...input, tagIds: tags.map((tag) => tag.id).sort() };
  const number = await nextSequenceValue(tx, ctx.app.id, 'TS');
  const id = schema.newId();
  const revisionId = schema.newId();

  const [row] = await tx
    .insert(schema.scenarios)
    .values({
      id,
      organizationId: ctx.organizationId,
      applicationId: ctx.app.id,
      number,
      title: state.title,
      status: state.status,
      priority: state.priority,
      moduleId: state.moduleId,
      ...versionColumns(state),
      descriptionMd: state.description,
      stepsMd: state.stepsToReach,
      searchText: buildSearchText(state, []),
      currentRevision: 1,
      currentRevisionId: revisionId,
      createdBy: ctx.user.id,
      createdAt: ctx.now,
      updatedBy: ctx.user.id,
      updatedAt: ctx.now,
    })
    .returning();
  if (state.tagIds.length) {
    await tx.insert(schema.scenarioTags).values(
      state.tagIds.map((tagId) => ({
        scenarioId: id,
        tagId,
        organizationId: ctx.organizationId,
      })),
    );
  }
  await insertRevision(tx, ctx, id, 1, state, [], null, revisionId);
  await claimAttachmentReferences(tx, ctx, id, [state.description, state.stepsToReach]);

  const initial = SCENARIO_REVISION_FIELDS.filter((field) => {
    const value = state[STATE_KEYS[field]];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    {
      action: 'scenario.created',
      targetType: 'scenario',
      targetId: id,
      targetLabel: scenarioLabel(ctx.app, row!),
      changes: await auditChanges(tx, null, state, initial, { from: null, to: 1 }),
    },
  );
  return row!;
}

async function conflictError(tx: Transaction, row: ScenarioRow) {
  const [latest] = await tx
    .select({
      authorLabel: schema.scenarioRevisions.authorLabel,
      createdAt: schema.scenarioRevisions.createdAt,
    })
    .from(schema.scenarioRevisions)
    .where(eq(schema.scenarioRevisions.id, row.currentRevisionId));
  return conflict(
    'SCENARIO_CHANGED',
    `${latest?.authorLabel ?? 'Someone'} changed this scenario since you opened it.`,
    {
      latestRevision: row.currentRevision,
      changedBy: latest?.authorLabel ?? '',
      changedAt: (latest?.createdAt ?? row.updatedAt).toISOString(),
    },
  );
}

/** Rejects the save when the scenario moved past the revision the editor started from. */
export async function assertBaseRevision(
  tx: Transaction,
  row: ScenarioRow,
  baseRevision: number,
): Promise<void> {
  if (row.currentRevision !== baseRevision) throw await conflictError(tx, row);
}

/**
 * Writes a new state: updates the scenario row and appends the next revision, unless nothing
 * changed. `row` must have been read `FOR UPDATE` in this transaction.
 */
export async function saveScenarioState(
  tx: Transaction,
  ctx: ScenarioContext,
  row: ScenarioRow,
  next: ScenarioState,
  options: { baseRevision: number; restoredFrom?: number },
): Promise<{ row: ScenarioRow; changed: ScenarioField[] }> {
  const before = stateOf(row, await currentTagIds(tx, row.id));
  const changed = changedFields(before, next);
  if (changed.length === 0) return { row, changed };
  if (changed.some((field) => RICH_TEXT_FIELDS.includes(field))) {
    await claimAttachmentReferences(tx, ctx, row.id, [next.description, next.stepsToReach]);
  }

  const number = row.currentRevision + 1;
  const revision = await insertRevision(
    tx,
    ctx,
    row.id,
    number,
    next,
    changed,
    options.restoredFrom ?? null,
  );
  const [updated] = await tx
    .update(schema.scenarios)
    .set({
      title: next.title,
      status: next.status,
      priority: next.priority,
      moduleId: next.moduleId,
      ...versionColumns(next),
      descriptionMd: next.description,
      stepsMd: next.stepsToReach,
      searchText: buildSearchText(next, await issueKeysOf(tx, row.id)),
      currentRevision: number,
      currentRevisionId: revision.id,
      updatedBy: ctx.user.id,
      updatedAt: ctx.now,
    })
    .where(
      and(
        eq(schema.scenarios.id, row.id),
        eq(schema.scenarios.currentRevision, options.baseRevision),
      ),
    )
    .returning();
  if (!updated) throw await conflictError(tx, row);

  if (changed.includes('tags')) {
    await tx.delete(schema.scenarioTags).where(eq(schema.scenarioTags.scenarioId, row.id));
    if (next.tagIds.length) {
      await tx.insert(schema.scenarioTags).values(
        next.tagIds.map((tagId) => ({
          scenarioId: row.id,
          tagId,
          organizationId: ctx.organizationId,
        })),
      );
    }
  }

  const changes = await auditChanges(tx, before, next, changed, {
    from: row.currentRevision,
    to: number,
  });
  await audit(
    tx,
    { organizationId: ctx.organizationId, actor: ctx.user },
    options.restoredFrom
      ? {
          action: 'scenario.revision_restored',
          targetType: 'scenario',
          targetId: row.id,
          targetLabel: scenarioLabel(ctx.app, updated),
          changes: {
            revision: { from: `r${options.restoredFrom}`, to: `r${number}` },
            ...changes,
          },
        }
      : {
          action: 'scenario.updated',
          targetType: 'scenario',
          targetId: row.id,
          targetLabel: scenarioLabel(ctx.app, updated),
          changes,
        },
  );
  return { row: updated, changed };
}

/** Names of the given users; deleted users resolve to the fallback. */
export async function userNames(
  tx: Transaction,
  ids: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) return new Map();
  const rows = await tx
    .select({ id: schema.users.id, name: schema.users.name })
    .from(schema.users)
    .where(inArray(schema.users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name]));
}

export function userRef(names: Map<string, string>, id: string | null, fallback = ''): UserRef {
  return { id, name: (id && names.get(id)) || fallback };
}

export async function tagNames(tx: Transaction, tagIds: string[]): Promise<string[]> {
  if (tagIds.length === 0) return [];
  const rows = await tx
    .select({ name: schema.tags.name })
    .from(schema.tags)
    .where(inArray(schema.tags.id, tagIds))
    .orderBy(asc(schema.tags.name));
  return rows.map((row) => row.name);
}

/** Module name, including soft-deleted modules (old revisions keep showing them). */
export async function moduleRef(
  tx: Transaction,
  moduleId: string | null,
): Promise<ModuleRef | null> {
  if (!moduleId) return null;
  const [row] = await tx
    .select({ id: schema.modules.id, name: schema.modules.name })
    .from(schema.modules)
    .where(eq(schema.modules.id, moduleId));
  return row ?? null;
}

/** The full scenario as returned by the API. */
export async function scenarioView(
  tx: Transaction,
  app: RequestApp,
  row: ScenarioRow,
): Promise<Scenario> {
  // One transaction means one connection: queries run one after another.
  const tags = await tx
    .select({ name: schema.tags.name })
    .from(schema.scenarioTags)
    .innerJoin(schema.tags, eq(schema.tags.id, schema.scenarioTags.tagId))
    .where(eq(schema.scenarioTags.scenarioId, row.id))
    .orderBy(asc(schema.tags.name));
  const module = await moduleRef(tx, row.moduleId);
  const names = await userNames(tx, [row.createdBy, row.updatedBy, row.deletedBy]);
  // Revision authors keep their names if the user account is later deleted.
  const labels = await tx
    .select({
      number: schema.scenarioRevisions.number,
      label: schema.scenarioRevisions.authorLabel,
    })
    .from(schema.scenarioRevisions)
    .where(
      and(
        eq(schema.scenarioRevisions.scenarioId, row.id),
        inArray(schema.scenarioRevisions.number, [1, row.currentRevision]),
      ),
    )
    .orderBy(desc(schema.scenarioRevisions.number));
  const comments = await tx
    .select({ n: count() })
    .from(schema.scenarioComments)
    .where(
      and(
        eq(schema.scenarioComments.scenarioId, row.id),
        isNull(schema.scenarioComments.deletedAt),
      ),
    );
  const links = await tx
    .select({ n: count() })
    .from(schema.scenarioRequirementLinks)
    .where(eq(schema.scenarioRequirementLinks.scenarioId, row.id));
  const files = await tx
    .select({ n: count() })
    .from(schema.attachments)
    .where(and(eq(schema.attachments.scenarioId, row.id), isNull(schema.attachments.deletedAt)));
  const testCases = await tx
    .select({ n: count() })
    .from(schema.testCaseScenarios)
    .innerJoin(schema.testCases, eq(schema.testCases.id, schema.testCaseScenarios.testCaseId))
    .where(
      and(eq(schema.testCaseScenarios.scenarioId, row.id), isNull(schema.testCases.deletedAt)),
    );
  const label = (number: number) => labels.find((l) => l.number === number)?.label ?? '';
  return {
    id: row.id,
    key: scenarioKey(app, row),
    number: row.number,
    title: row.title,
    status: row.status,
    priority: row.priority,
    module,
    tags: tags.map((tag) => tag.name),
    testCaseCount: testCases[0]?.n ?? 0,
    author: userRef(names, row.createdBy, label(1)),
    createdAt: row.createdAt.toISOString(),
    updatedBy: userRef(names, row.updatedBy, label(row.currentRevision)),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
    deletedBy: row.deletedAt ? userRef(names, row.deletedBy) : null,
    versionFrom: row.versionFrom,
    versionTo: row.versionTo,
    description: row.descriptionMd,
    stepsToReach: row.stepsMd,
    revision: row.currentRevision,
    revisionId: row.currentRevisionId,
    counts: {
      comments: comments[0]?.n ?? 0,
      links: links[0]?.n ?? 0,
      attachments: files[0]?.n ?? 0,
    },
  };
}

/**
 * Makes a module usable again for a restored scenario or revision: un-deletes it, or, when a
 * live module with the same name exists meanwhile, returns that one instead.
 */
export async function reviveModule(
  tx: Transaction,
  app: RequestApp,
  moduleId: string,
): Promise<string> {
  const [module] = await tx
    .select()
    .from(schema.modules)
    .where(and(eq(schema.modules.id, moduleId), eq(schema.modules.applicationId, app.id)));
  if (!module || !module.deletedAt) return moduleId;
  const [live] = await tx
    .select({ id: schema.modules.id })
    .from(schema.modules)
    .where(
      and(
        eq(schema.modules.applicationId, app.id),
        isNull(schema.modules.deletedAt),
        sql`lower(${schema.modules.name}) = lower(${module.name})`,
      ),
    );
  if (live) return live.id;
  await tx
    .update(schema.modules)
    .set({ deletedAt: null, deletedBy: null })
    .where(eq(schema.modules.id, moduleId));
  return moduleId;
}
