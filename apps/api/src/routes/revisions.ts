import {
  RICH_TEXT_FIELDS,
  restoreRevisionSchema,
  type FieldChange,
  type ScenarioField,
  type ScenarioRevision,
  type ScenarioRevisionSummary,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { notFound, parse } from '../http/errors';
import { inOrg, type Guards, type RequestApp } from '../http/guards';
import type { ApiServices } from '../services/index';
import {
  assertBaseRevision,
  assertNotDeleted,
  findScenario,
  moduleRef,
  reviveModule,
  saveScenarioState,
  scenarioKey,
  scenarioView,
  stateOf,
  tagNames,
  userNames,
  userRef,
  type RevisionRow,
  type ScenarioRow,
} from '../services/scenarios';
import { SCENARIOS_PATH, scenarioContext, type ScenarioParams } from './scenarios';

type RevisionParams = ScenarioParams & { number: string };

function revisionNumber(text: string): number {
  const number = Number(text.replace(/^r/i, ''));
  if (!Number.isSafeInteger(number) || number < 1) throw notFound();
  return number;
}

async function findRevision(
  tx: Transaction,
  scenario: ScenarioRow,
  number: number,
): Promise<RevisionRow> {
  const [row] = await tx
    .select()
    .from(schema.scenarioRevisions)
    .where(
      and(
        eq(schema.scenarioRevisions.scenarioId, scenario.id),
        eq(schema.scenarioRevisions.number, number),
      ),
    );
  if (!row) throw notFound('This revision does not exist.');
  return row;
}

async function revisionView(
  tx: Transaction,
  app: RequestApp,
  scenario: ScenarioRow,
  row: RevisionRow,
): Promise<ScenarioRevision> {
  const names = await userNames(tx, [row.authorId]);
  return {
    id: row.id,
    number: row.number,
    scenarioKey: scenarioKey(app, scenario),
    latest: scenario.currentRevision,
    title: row.title,
    status: row.status,
    priority: row.priority,
    // Resolved even if the module was deleted or renamed since.
    module: await moduleRef(tx, row.moduleId),
    tags: await tagNames(tx, row.tagIds),
    versionFrom: row.versionFrom,
    versionTo: row.versionTo,
    description: row.descriptionMd,
    stepsToReach: row.stepsMd,
    author: userRef(names, row.authorId, row.authorLabel),
    createdAt: row.createdAt.toISOString(),
    changedFields: row.changedFields as ScenarioField[],
    restoredFrom: row.restoredFrom,
  };
}

/** History, newest first, with old/new values of changed scalar fields. */
async function history(tx: Transaction, scenario: ScenarioRow): Promise<ScenarioRevisionSummary[]> {
  const r = schema.scenarioRevisions;
  // Rich text is left out: the history only says that it changed.
  const rows = await tx
    .select({
      id: r.id,
      number: r.number,
      title: r.title,
      status: r.status,
      priority: r.priority,
      moduleId: r.moduleId,
      versionFrom: r.versionFrom,
      versionTo: r.versionTo,
      tagIds: r.tagIds,
      changedFields: r.changedFields,
      restoredFrom: r.restoredFrom,
      authorId: r.authorId,
      authorLabel: r.authorLabel,
      createdAt: r.createdAt,
    })
    .from(r)
    .where(eq(r.scenarioId, scenario.id))
    .orderBy(asc(r.number));

  const moduleIds = [...new Set(rows.flatMap((row) => (row.moduleId ? [row.moduleId] : [])))];
  const tagIds = [...new Set(rows.flatMap((row) => row.tagIds))];
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
  const names = await userNames(
    tx,
    rows.map((row) => row.authorId),
  );

  type Row = (typeof rows)[number];
  const value = (row: Row, field: ScenarioField): unknown => {
    switch (field) {
      case 'module':
        return row.moduleId ? (moduleName.get(row.moduleId) ?? null) : null;
      case 'tags':
        return row.tagIds.map((id) => tagName.get(id) ?? id).sort();
      default:
        return row[field as 'title' | 'status' | 'priority' | 'versionFrom' | 'versionTo'];
    }
  };

  return rows
    .map((row, index): ScenarioRevisionSummary => {
      const previous = index > 0 ? rows[index - 1] : undefined;
      const changedFields = row.changedFields as ScenarioField[];
      const changes: Partial<Record<ScenarioField, FieldChange>> = {};
      if (previous) {
        for (const field of changedFields) {
          if (RICH_TEXT_FIELDS.includes(field)) continue;
          changes[field] = { from: value(previous, field), to: value(row, field) };
        }
      }
      return {
        id: row.id,
        number: row.number,
        author: userRef(names, row.authorId, row.authorLabel),
        createdAt: row.createdAt.toISOString(),
        changedFields,
        changes,
        restoredFrom: row.restoredFrom,
      };
    })
    .reverse();
}

export async function revisionRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const write = [guards.app, guards.appPermission('scenario.write'), guards.writableApp];

  app.get(
    `${SCENARIOS_PATH}/:scenarioKey/revisions`,
    { preHandler: read },
    async (req: FastifyRequest<{ Params: ScenarioParams }>) =>
      inOrg(services, req, async (tx) =>
        history(tx, await findScenario(tx, req.application!, req.params.scenarioKey)),
      ),
  );

  app.get(
    `${SCENARIOS_PATH}/:scenarioKey/revisions/:number`,
    { preHandler: read },
    async (req: FastifyRequest<{ Params: RevisionParams }>) => {
      const number = revisionNumber(req.params.number);
      return inOrg(services, req, async (tx) => {
        const scenario = await findScenario(tx, req.application!, req.params.scenarioKey);
        return revisionView(
          tx,
          req.application!,
          scenario,
          await findRevision(tx, scenario, number),
        );
      });
    },
  );

  /** Stable reference used by records that pin a revision (e.g. future test runs). */
  app.get(
    '/api/orgs/:orgSlug/apps/:appKey/scenario-revisions/:revisionId',
    { preHandler: read },
    async (req: FastifyRequest<{ Params: { revisionId: string } }>) => {
      if (!z.uuid().safeParse(req.params.revisionId).success) throw notFound();
      return inOrg(services, req, async (tx) => {
        const [found] = await tx
          .select({ revision: schema.scenarioRevisions, scenario: schema.scenarios })
          .from(schema.scenarioRevisions)
          .innerJoin(schema.scenarios, eq(schema.scenarios.id, schema.scenarioRevisions.scenarioId))
          .where(
            and(
              eq(schema.scenarioRevisions.id, req.params.revisionId),
              eq(schema.scenarios.applicationId, req.application!.id),
            ),
          );
        if (!found) throw notFound();
        return revisionView(tx, req.application!, found.scenario, found.revision);
      });
    },
  );

  /** Restoring creates a new revision equal to the old one; nothing is overwritten. */
  app.post(
    `${SCENARIOS_PATH}/:scenarioKey/revisions/:number/restore`,
    { preHandler: write },
    async (req: FastifyRequest<{ Params: RevisionParams }>) => {
      const number = revisionNumber(req.params.number);
      const { baseRevision } = parse(restoreRevisionSchema, req.body);
      const ctx = scenarioContext(services, req);
      return inOrg(services, req, async (tx) => {
        const row = await findScenario(tx, ctx.app, req.params.scenarioKey, { forUpdate: true });
        assertNotDeleted(row);
        await assertBaseRevision(tx, row, baseRevision);
        const revision = await findRevision(tx, row, number);
        const next = stateOf(revision, revision.tagIds);
        // A module deleted since is brought back (or its live namesake used).
        if (next.moduleId) next.moduleId = await reviveModule(tx, ctx.app, next.moduleId);
        const saved = await saveScenarioState(tx, ctx, row, next, {
          baseRevision,
          restoredFrom: number,
        });
        return scenarioView(tx, ctx.app, saved.row);
      });
    },
  );
}
