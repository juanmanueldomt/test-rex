import {
  moduleInputSchema,
  normalizeTag,
  type ScenarioModule,
  type ScenarioTagSuggestion,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { conflict, isUniqueViolation, notFound, parse } from '../http/errors';
import { inOrg, type Guards, type RequestApp } from '../http/guards';
import { audit } from '../services/audit';
import type { ApiServices } from '../services/index';
import { scenarioContext } from './scenarios';

const APP_PATH = '/api/orgs/:orgSlug/apps/:appKey';
type ModuleRequest = FastifyRequest<{ Params: { moduleId: string } }>;

async function findModule(tx: Transaction, app: RequestApp, id: string) {
  if (!z.uuid().safeParse(id).success) throw notFound();
  const [row] = await tx
    .select()
    .from(schema.modules)
    .where(
      and(
        eq(schema.modules.id, id),
        eq(schema.modules.applicationId, app.id),
        isNull(schema.modules.deletedAt),
      ),
    );
  if (!row) throw notFound();
  return row;
}

/** 409 naming the existing module, so the client can offer it instead. */
async function duplicateModule(tx: Transaction, app: RequestApp, name: string) {
  const [existing] = await tx
    .select({ id: schema.modules.id, name: schema.modules.name })
    .from(schema.modules)
    .where(
      and(
        eq(schema.modules.applicationId, app.id),
        isNull(schema.modules.deletedAt),
        sql`lower(${schema.modules.name}) = lower(${name})`,
      ),
    );
  return conflict('MODULE_EXISTS', `A module named ${existing?.name ?? name} already exists.`, {
    existing: existing ?? null,
  });
}

export async function moduleRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const write = [guards.app, guards.appPermission('scenario.write'), guards.writableApp];

  app.get(`${APP_PATH}/modules`, { preHandler: read }, async (req): Promise<ScenarioModule[]> => {
    const rows = await inOrg(services, req, (tx) =>
      tx
        .select({
          id: schema.modules.id,
          name: schema.modules.name,
          createdAt: schema.modules.createdAt,
          scenarioCount: sql<number>`(
            SELECT count(*)::int FROM ${schema.scenarios} s
             WHERE s.module_id = ${schema.modules.id} AND s.deleted_at IS NULL)`,
        })
        .from(schema.modules)
        .where(
          and(
            eq(schema.modules.applicationId, req.application!.id),
            isNull(schema.modules.deletedAt),
          ),
        )
        .orderBy(asc(sql`lower(${schema.modules.name})`)),
    );
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  });

  app.post(`${APP_PATH}/modules`, { preHandler: write }, async (req, reply) => {
    const { name } = parse(moduleInputSchema, req.body);
    const ctx = scenarioContext(services, req);
    try {
      const created = await inOrg(services, req, async (tx) => {
        const [row] = await tx
          .insert(schema.modules)
          .values({
            organizationId: ctx.organizationId,
            applicationId: ctx.app.id,
            name,
            createdBy: ctx.user.id,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning();
        await audit(
          tx,
          { organizationId: ctx.organizationId, actor: ctx.user },
          {
            action: 'module.created',
            targetType: 'module',
            targetId: row!.id,
            targetLabel: `${ctx.app.key} · ${name}`,
            changes: { name: { from: null, to: name } },
          },
        );
        return row!;
      });
      return reply.code(201).send({
        id: created.id,
        name: created.name,
        createdAt: created.createdAt.toISOString(),
        scenarioCount: 0,
      } satisfies ScenarioModule);
    } catch (error) {
      if (isUniqueViolation(error, 'modules_app_name_key')) {
        throw await inOrg(services, req, (tx) => duplicateModule(tx, ctx.app, name));
      }
      throw error;
    }
  });

  app.patch(`${APP_PATH}/modules/:moduleId`, { preHandler: write }, async (req: ModuleRequest) => {
    const { name } = parse(moduleInputSchema, req.body);
    const ctx = scenarioContext(services, req);
    try {
      return await inOrg(services, req, async (tx) => {
        const current = await findModule(tx, ctx.app, req.params.moduleId);
        if (current.name !== name) {
          await tx
            .update(schema.modules)
            .set({ name, updatedAt: ctx.now })
            .where(eq(schema.modules.id, current.id));
          await audit(
            tx,
            { organizationId: ctx.organizationId, actor: ctx.user },
            {
              action: 'module.renamed',
              targetType: 'module',
              targetId: current.id,
              targetLabel: `${ctx.app.key} · ${name}`,
              changes: { name: { from: current.name, to: name } },
            },
          );
        }
        return { id: current.id, name };
      });
    } catch (error) {
      if (isUniqueViolation(error, 'modules_app_name_key')) {
        throw await inOrg(services, req, (tx) => duplicateModule(tx, ctx.app, name));
      }
      throw error;
    }
  });

  /** Only unused modules can be deleted; they are soft-deleted so old revisions keep the name. */
  app.delete(
    `${APP_PATH}/modules/:moduleId`,
    { preHandler: write },
    async (req: ModuleRequest, reply) => {
      const ctx = scenarioContext(services, req);
      await inOrg(services, req, async (tx) => {
        const current = await findModule(tx, ctx.app, req.params.moduleId);
        const [{ inUse } = { inUse: 0 }] = await tx
          .select({ inUse: count() })
          .from(schema.scenarios)
          .where(
            and(eq(schema.scenarios.moduleId, current.id), isNull(schema.scenarios.deletedAt)),
          );
        if (inUse > 0) {
          throw conflict(
            'MODULE_IN_USE',
            `${current.name} is used by ${inUse} scenario(s). Move them to another module first.`,
            { count: inUse },
          );
        }
        await tx
          .update(schema.modules)
          .set({ deletedAt: ctx.now, deletedBy: ctx.user.id })
          .where(eq(schema.modules.id, current.id));
        await audit(
          tx,
          { organizationId: ctx.organizationId, actor: ctx.user },
          {
            action: 'module.deleted',
            targetType: 'module',
            targetId: current.id,
            targetLabel: `${ctx.app.key} · ${current.name}`,
            changes: { name: { from: current.name, to: null } },
          },
        );
      });
      return reply.code(204).send();
    },
  );

  /** Existing tags of the application, most used first, optionally by prefix (`?q=sm`). */
  app.get(
    `${APP_PATH}/tags`,
    { preHandler: read },
    async (req): Promise<ScenarioTagSuggestion[]> => {
      const { q, limit } = parse(
        z.object({
          q: z.string().max(41).optional(),
          limit: z.coerce.number().int().min(1).max(200).default(20),
        }),
        req.query,
      );
      const prefix = q ? normalizeTag(q) : '';
      const usage = sql<number>`count(${schema.scenarios.id})::int`;
      return inOrg(services, req, (tx) =>
        tx
          .select({ name: schema.tags.name, scenarioCount: usage })
          .from(schema.tags)
          .leftJoin(schema.scenarioTags, eq(schema.scenarioTags.tagId, schema.tags.id))
          .leftJoin(
            schema.scenarios,
            and(
              eq(schema.scenarios.id, schema.scenarioTags.scenarioId),
              isNull(schema.scenarios.deletedAt),
            ),
          )
          .where(
            and(
              eq(schema.tags.applicationId, req.application!.id),
              prefix
                ? sql`${schema.tags.name} LIKE ${`${prefix.replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`
                : undefined,
            ),
          )
          .groupBy(schema.tags.id, schema.tags.name)
          .orderBy(desc(usage), asc(schema.tags.name))
          .limit(limit),
      );
    },
  );
}
