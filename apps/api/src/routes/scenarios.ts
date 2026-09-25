import {
  createScenarioSchema,
  foldForSearch,
  MODULE_NONE,
  paddedVersionParts,
  parseScenarioKey,
  scenarioListQuerySchema,
  updateScenarioSchema,
  versionRangeError,
  type ScenarioListItem,
  type ScenarioListPage,
  type ScenarioListQuery,
  type UserRef,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { badRequest, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit } from '../services/audit';
import type { ApiServices } from '../services/index';
import {
  assertBaseRevision,
  assertNotDeleted,
  createScenario,
  currentTagIds,
  findScenario,
  requireModule,
  resolveTags,
  reviveModule,
  saveScenarioState,
  scenarioKey,
  scenarioLabel,
  scenarioView,
  stateOf,
  type ScenarioContext,
} from '../services/scenarios';

export type ScenarioParams = { scenarioKey: string };

export const SCENARIOS_PATH = '/api/orgs/:orgSlug/apps/:appKey/scenarios';

export function scenarioContext(services: ApiServices, req: FastifyRequest): ScenarioContext {
  return {
    organizationId: req.org!.id,
    app: req.application!,
    user: req.user!,
    now: services.now(),
  };
}

function rangeIssue(versionFrom: string | null, versionTo: string | null): void {
  const message = versionRangeError(versionFrom, versionTo);
  if (message) {
    throw badRequest('VALIDATION_FAILED', 'Some fields are invalid.', {
      issues: [{ path: 'versionTo', message }],
    });
  }
}

/** `%`, `_` and `\` are LIKE wildcards/escapes and must match literally. */
function likeContains(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const creator = alias(schema.users, 'creator');
const updater = alias(schema.users, 'updater');

function listFilters(appId: string, query: ScenarioListQuery): SQL {
  const s = schema.scenarios;
  const filters: (SQL | undefined)[] = [eq(s.applicationId, appId)];
  if (!query.deleted) filters.push(isNull(s.deletedAt));
  if (query.status) filters.push(inArray(s.status, query.status));
  if (query.priority) filters.push(inArray(s.priority, query.priority));
  if (query.module) {
    const ids = query.module.filter((id) => id !== MODULE_NONE);
    filters.push(
      or(
        ids.length ? inArray(s.moduleId, ids) : undefined,
        query.module.includes(MODULE_NONE) ? isNull(s.moduleId) : undefined,
      ),
    );
  }
  if (query.author) filters.push(inArray(s.createdBy, query.author));
  if (query.tag) {
    const tags = query.tag;
    filters.push(
      inArray(
        s.id,
        sql`(SELECT st.scenario_id FROM ${schema.scenarioTags} st
              JOIN ${schema.tags} t ON t.id = st.tag_id
             WHERE t.application_id = ${appId} AND t.name IN (${sql.join(
               tags.map((tag) => sql`${tag}`),
               sql`, `,
             )})
             GROUP BY st.scenario_id
            HAVING count(DISTINCT t.name) = ${tags.length})`,
      ),
    );
  }
  if (query.version) {
    // Parts are validated integers, so they can be inlined as an array literal.
    const parts = sql.raw(`ARRAY[${paddedVersionParts(query.version)!.join(',')}]::int[]`);
    filters.push(
      sql`(${s.versionFromParts} IS NULL OR ${s.versionFromParts} <= ${parts})`,
      sql`(${s.versionToParts} IS NULL OR ${s.versionToParts} >= ${parts})`,
    );
  }
  if (query.q) {
    const number = parseScenarioKey(query.q);
    const text = sql`${s.searchText} LIKE ${likeContains(foldForSearch(query.q))}`;
    filters.push(number === null ? text : or(text, eq(s.number, number)));
  }
  return and(...filters)!;
}

function listOrder(query: ScenarioListQuery): SQL[] {
  const s = schema.scenarios;
  const descending = query.sort.startsWith('-');
  const field = query.sort.replace(/^-/, '');
  const dir = (expr: SQL | typeof s.number) => (descending ? desc(expr) : asc(expr));
  const order: SQL[] = [];
  // A search that looks like a key lists that scenario first.
  const number = query.q ? parseScenarioKey(query.q) : null;
  if (number !== null) order.push(sql`(${s.number} = ${number}) DESC`);
  switch (field) {
    case 'title':
      order.push(dir(sql`lower(${s.title})`));
      break;
    case 'status':
      order.push(dir(sql`${s.status}`));
      break;
    case 'priority':
      order.push(dir(sql`${s.priority}`));
      break;
    case 'module':
      order.push(
        sql`lower(${schema.modules.name}) ${sql.raw(descending ? 'DESC' : 'ASC')} NULLS LAST`,
      );
      break;
    case 'author':
      order.push(sql`lower(${creator.name}) ${sql.raw(descending ? 'DESC' : 'ASC')} NULLS LAST`);
      break;
    case 'updated':
      order.push(dir(sql`${s.updatedAt}`));
      break;
  }
  order.push(dir(s.number));
  return order;
}

export async function listScenarios(
  tx: Transaction,
  app: { id: string; key: string },
  query: ScenarioListQuery,
): Promise<ScenarioListPage> {
  const s = schema.scenarios;
  const where = listFilters(app.id, query);
  const [{ total } = { total: 0 }] = await tx.select({ total: count() }).from(s).where(where);
  const lastPage = Math.max(1, Math.ceil(total / query.size));
  const page = Math.min(query.page, lastPage);
  const rows = await tx
    .select({
      row: s,
      moduleName: schema.modules.name,
      creatorName: creator.name,
      updaterName: updater.name,
      tags: sql<string[]>`ARRAY(
        SELECT t.name FROM ${schema.scenarioTags} st JOIN ${schema.tags} t ON t.id = st.tag_id
         WHERE st.scenario_id = ${s.id} ORDER BY t.name)`,
    })
    .from(s)
    .leftJoin(schema.modules, eq(schema.modules.id, s.moduleId))
    .leftJoin(creator, eq(creator.id, s.createdBy))
    .leftJoin(updater, eq(updater.id, s.updatedBy))
    .where(where)
    .orderBy(...listOrder(query))
    .limit(query.size)
    .offset((page - 1) * query.size);
  const user = (id: string | null, name: string | null): UserRef => ({ id, name: name ?? '' });
  const items = rows.map(
    ({ row, moduleName, creatorName, updaterName, tags }): ScenarioListItem => ({
      id: row.id,
      key: scenarioKey(app, row),
      number: row.number,
      title: row.title,
      status: row.status,
      priority: row.priority,
      module: row.moduleId ? { id: row.moduleId, name: moduleName ?? '' } : null,
      tags,
      // Test cases arrive with the next change.
      testCaseCount: 0,
      author: user(row.createdBy, creatorName),
      createdAt: row.createdAt.toISOString(),
      updatedBy: user(row.updatedBy, updaterName),
      updatedAt: row.updatedAt.toISOString(),
      deletedAt: row.deletedAt?.toISOString() ?? null,
    }),
  );
  return { items, total, page, size: query.size };
}

export async function scenarioRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const write = [guards.app, guards.appPermission('scenario.write'), guards.writableApp];
  type KeyRequest = FastifyRequest<{ Params: ScenarioParams }>;

  app.get(SCENARIOS_PATH, { preHandler: read }, async (req) => {
    const query = parse(scenarioListQuerySchema, req.query);
    return inOrg(services, req, (tx) => listScenarios(tx, req.application!, query));
  });

  /** People who created scenarios in this application (for the author filter). */
  app.get(`${SCENARIOS_PATH}/authors`, { preHandler: read }, async (req): Promise<UserRef[]> => {
    const rows = await inOrg(services, req, (tx) =>
      tx
        .selectDistinct({ id: schema.scenarios.createdBy, name: schema.users.name })
        .from(schema.scenarios)
        .innerJoin(schema.users, eq(schema.users.id, schema.scenarios.createdBy))
        .where(
          and(
            eq(schema.scenarios.applicationId, req.application!.id),
            isNotNull(schema.scenarios.createdBy),
          ),
        ),
    );
    return rows
      .map((row) => ({ id: row.id, name: row.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  app.post(SCENARIOS_PATH, { preHandler: write }, async (req, reply) => {
    const input = parse(createScenarioSchema, req.body);
    const ctx = scenarioContext(services, req);
    const view = await inOrg(services, req, async (tx) => {
      const row = await createScenario(tx, ctx, input);
      return scenarioView(tx, ctx.app, row);
    });
    return reply.code(201).send(view);
  });

  app.get(`${SCENARIOS_PATH}/:scenarioKey`, { preHandler: read }, async (req: KeyRequest) =>
    inOrg(services, req, async (tx) => {
      const row = await findScenario(tx, req.application!, req.params.scenarioKey);
      return scenarioView(tx, req.application!, row);
    }),
  );

  app.patch(`${SCENARIOS_PATH}/:scenarioKey`, { preHandler: write }, async (req: KeyRequest) => {
    const input = parse(updateScenarioSchema, req.body);
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const row = await findScenario(tx, ctx.app, req.params.scenarioKey, { forUpdate: true });
      assertNotDeleted(row);
      await assertBaseRevision(tx, row, input.baseRevision);
      const next = stateOf(row, await currentTagIds(tx, row.id));
      if (input.title !== undefined) next.title = input.title;
      if (input.status !== undefined) next.status = input.status;
      if (input.priority !== undefined) next.priority = input.priority;
      if (input.moduleId !== undefined && input.moduleId !== next.moduleId) {
        if (input.moduleId) await requireModule(tx, ctx.app, input.moduleId);
        next.moduleId = input.moduleId;
      }
      if (input.tags !== undefined) {
        next.tagIds = (await resolveTags(tx, ctx, input.tags)).map((tag) => tag.id).sort();
      }
      if (input.versionFrom !== undefined) next.versionFrom = input.versionFrom;
      if (input.versionTo !== undefined) next.versionTo = input.versionTo;
      if (input.description !== undefined) next.description = input.description;
      if (input.stepsToReach !== undefined) next.stepsToReach = input.stepsToReach;
      rangeIssue(next.versionFrom, next.versionTo);
      const saved = await saveScenarioState(tx, ctx, row, next, {
        baseRevision: input.baseRevision,
      });
      return scenarioView(tx, ctx.app, saved.row);
    });
  });

  /** Soft delete: the scenario leaves the grid but stays readable (and restorable) by URL. */
  app.delete(`${SCENARIOS_PATH}/:scenarioKey`, { preHandler: write }, async (req: KeyRequest) => {
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const row = await findScenario(tx, ctx.app, req.params.scenarioKey, { forUpdate: true });
      if (row.deletedAt) return scenarioView(tx, ctx.app, row);
      const [deleted] = await tx
        .update(schema.scenarios)
        .set({ deletedAt: ctx.now, deletedBy: ctx.user.id })
        .where(eq(schema.scenarios.id, row.id))
        .returning();
      await audit(
        tx,
        { organizationId: ctx.organizationId, actor: ctx.user },
        {
          action: 'scenario.deleted',
          targetType: 'scenario',
          targetId: row.id,
          targetLabel: scenarioLabel(ctx.app, row),
          changes: { deleted: { from: false, to: true } },
        },
      );
      return scenarioView(tx, ctx.app, deleted!);
    });
  });

  app.post(
    `${SCENARIOS_PATH}/:scenarioKey/restore`,
    { preHandler: write },
    async (req: KeyRequest) => {
      const ctx = scenarioContext(services, req);
      return inOrg(services, req, async (tx) => {
        const row = await findScenario(tx, ctx.app, req.params.scenarioKey, { forUpdate: true });
        if (!row.deletedAt) return scenarioView(tx, ctx.app, row);
        // Its module may have been deleted while no live scenario used it.
        if (row.moduleId) await reviveModule(tx, ctx.app, row.moduleId);
        const [restored] = await tx
          .update(schema.scenarios)
          .set({ deletedAt: null, deletedBy: null })
          .where(eq(schema.scenarios.id, row.id))
          .returning();
        await audit(
          tx,
          { organizationId: ctx.organizationId, actor: ctx.user },
          {
            action: 'scenario.restored',
            targetType: 'scenario',
            targetId: row.id,
            targetLabel: scenarioLabel(ctx.app, row),
            changes: { deleted: { from: true, to: false } },
          },
        );
        return scenarioView(tx, ctx.app, restored!);
      });
    },
  );
}
