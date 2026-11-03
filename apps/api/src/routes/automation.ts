import {
  automationSettingsSchema,
  datasetInputSchema,
  globalStepInputSchema,
  updateGlobalStepSchema,
  type Dataset,
  type DatasetSummary,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { conflict, isUniqueViolation, notFound, parse } from '../http/errors';
import { inOrg, type Guards, type RequestApp } from '../http/guards';
import { audit } from '../services/audit';
import { automationSettingsOf, globalStepView, globalStepViews } from '../services/automation';
import type { ApiServices } from '../services/index';
import { userNames, userRef } from '../services/scenarios';

const APP_PATH = '/api/orgs/:orgSlug/apps/:appKey';
type DatasetRow = typeof schema.datasets.$inferSelect;
type IdRequest = FastifyRequest<{ Params: { id: string } }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findDataset(tx: Transaction, app: RequestApp, id: string, forUpdate = false) {
  if (!UUID.test(id)) throw notFound();
  const query = tx
    .select()
    .from(schema.datasets)
    .where(and(eq(schema.datasets.id, id), eq(schema.datasets.applicationId, app.id)));
  const [row] = await (forUpdate ? query.for('update') : query);
  if (!row || row.deletedAt) throw notFound();
  return row;
}

async function usage(tx: Transaction, datasetIds: string[]): Promise<Map<string, number>> {
  if (datasetIds.length === 0) return new Map();
  const rows = await tx
    .select({ datasetId: schema.testCases.datasetId, n: count() })
    .from(schema.testCases)
    .where(
      and(
        sql`${schema.testCases.datasetId} IN (${sql.join(
          datasetIds.map((id) => sql`${id}`),
          sql`, `,
        )})`,
        isNull(schema.testCases.deletedAt),
      ),
    )
    .groupBy(schema.testCases.datasetId);
  return new Map(rows.map((row) => [row.datasetId!, row.n]));
}

function datasetSummary(
  row: DatasetRow,
  names: Map<string, string>,
  used: Map<string, number>,
): DatasetSummary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    columns: row.columns,
    rowCount: row.rows.length,
    testCaseCount: used.get(row.id) ?? 0,
    updatedBy: userRef(names, row.updatedBy),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function datasetView(tx: Transaction, row: DatasetRow): Promise<Dataset> {
  const names = await userNames(tx, [row.updatedBy]);
  return {
    ...datasetSummary(row, names, await usage(tx, [row.id])),
    rows: row.rows,
    createdAt: row.createdAt.toISOString(),
  };
}

const nameTaken = () =>
  conflict('DATASET_EXISTS', 'A dataset with this name already exists in this application.');

export async function automationRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const write = [guards.app, guards.appPermission('testcase.write'), guards.writableApp];
  const ctx = (req: FastifyRequest) => ({
    organizationId: req.org!.id,
    actor: req.user!,
    app: req.application!,
    now: services.now(),
  });

  // ---- Automation settings ------------------------------------------------------------------

  app.get(`${APP_PATH}/automation`, { preHandler: read }, async (req) =>
    inOrg(services, req, (tx) => automationSettingsOf(tx, req.application!.id)),
  );

  app.put(`${APP_PATH}/automation`, { preHandler: write }, async (req) => {
    const input = parse(automationSettingsSchema, req.body);
    const { organizationId, actor, app: application, now } = ctx(req);
    return inOrg(services, req, async (tx) => {
      const before = await automationSettingsOf(tx, application.id);
      const values = { ...input, updatedBy: actor.id, updatedAt: now };
      await tx
        .insert(schema.automationSettings)
        .values({ applicationId: application.id, organizationId, ...values })
        .onConflictDoUpdate({ target: schema.automationSettings.applicationId, set: values });
      const changes = Object.fromEntries(
        (Object.keys(input) as (keyof typeof input)[])
          .filter((key) => before[key] !== input[key])
          .map((key) => [key, { from: before[key], to: input[key] }]),
      );
      if (Object.keys(changes).length) {
        await audit(
          tx,
          { organizationId, actor },
          {
            action: 'automation.updated',
            targetType: 'application',
            targetId: application.id,
            targetLabel: `${application.key} · ${application.name}`,
            changes,
          },
        );
      }
      return automationSettingsOf(tx, application.id);
    });
  });

  // ---- Global steps -------------------------------------------------------------------------

  app.get(`${APP_PATH}/global-steps`, { preHandler: read }, async (req) =>
    inOrg(services, req, (tx) => globalStepViews(tx, req.application!.id)),
  );

  app.post(`${APP_PATH}/global-steps`, { preHandler: write }, async (req, reply) => {
    const input = parse(globalStepInputSchema, req.body);
    const { organizationId, actor, app: application, now } = ctx(req);
    const view = await inOrg(services, req, async (tx) => {
      const [{ next } = { next: 0 }] = await tx
        .select({ next: sql<number>`coalesce(max(${schema.globalSteps.position}) + 1, 0)::int` })
        .from(schema.globalSteps)
        .where(
          and(
            eq(schema.globalSteps.applicationId, application.id),
            eq(schema.globalSteps.phase, input.phase),
          ),
        );
      const [row] = await tx
        .insert(schema.globalSteps)
        .values({
          organizationId,
          applicationId: application.id,
          phase: input.phase,
          name: input.name,
          enabled: input.enabled,
          position: next,
          steps: input.steps,
          createdBy: actor.id,
          createdAt: now,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .returning();
      await audit(
        tx,
        { organizationId, actor },
        {
          action: 'global_step.created',
          targetType: 'global_step',
          targetId: row!.id,
          targetLabel: `${application.key} · ${row!.name}`,
          changes: {
            phase: { from: null, to: row!.phase },
            enabled: { from: null, to: row!.enabled },
            steps: { from: null, to: row!.steps.length },
          },
        },
      );
      return globalStepView(row!, await userNames(tx, [actor.id]));
    });
    return reply.code(201).send(view);
  });

  app.patch(`${APP_PATH}/global-steps/:id`, { preHandler: write }, async (req: IdRequest) => {
    const input = parse(updateGlobalStepSchema, req.body);
    const { organizationId, actor, app: application, now } = ctx(req);
    return inOrg(services, req, async (tx) => {
      if (!UUID.test(req.params.id)) throw notFound();
      const [row] = await tx
        .select()
        .from(schema.globalSteps)
        .where(
          and(
            eq(schema.globalSteps.id, req.params.id),
            eq(schema.globalSteps.applicationId, application.id),
          ),
        )
        .for('update');
      if (!row) throw notFound();
      const phase = input.phase ?? row.phase;
      if (input.position !== undefined || phase !== row.phase) {
        // Reorder within the (new) phase: shift the others to make room.
        const siblings = await tx
          .select({ id: schema.globalSteps.id })
          .from(schema.globalSteps)
          .where(
            and(
              eq(schema.globalSteps.applicationId, application.id),
              eq(schema.globalSteps.phase, phase),
              ne(schema.globalSteps.id, row.id),
            ),
          )
          .orderBy(asc(schema.globalSteps.position), asc(schema.globalSteps.createdAt));
        const target = Math.min(input.position ?? siblings.length, siblings.length);
        const order = [...siblings.map((s) => s.id)];
        order.splice(target, 0, row.id);
        for (const [position, id] of order.entries()) {
          if (id === row.id) continue;
          await tx
            .update(schema.globalSteps)
            .set({ position })
            .where(eq(schema.globalSteps.id, id));
        }
        row.position = target;
      }
      const [updated] = await tx
        .update(schema.globalSteps)
        .set({
          name: input.name ?? row.name,
          phase,
          enabled: input.enabled ?? row.enabled,
          steps: input.steps ?? row.steps,
          position: row.position,
          updatedBy: actor.id,
          updatedAt: now,
        })
        .where(eq(schema.globalSteps.id, row.id))
        .returning();
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (input.name !== undefined && input.name !== row.name) {
        changes.name = { from: row.name, to: input.name };
      }
      if (phase !== row.phase) changes.phase = { from: row.phase, to: phase };
      if (input.enabled !== undefined && input.enabled !== row.enabled) {
        changes.enabled = { from: row.enabled, to: input.enabled };
      }
      if (input.steps !== undefined && JSON.stringify(input.steps) !== JSON.stringify(row.steps)) {
        changes.steps = { from: row.steps.length, to: input.steps.length };
      }
      if (input.position !== undefined) changes.position = { from: null, to: row.position };
      await audit(
        tx,
        { organizationId, actor },
        {
          action: 'global_step.updated',
          targetType: 'global_step',
          targetId: row.id,
          targetLabel: `${application.key} · ${updated!.name}`,
          changes,
        },
      );
      return globalStepView(updated!, await userNames(tx, [actor.id]));
    });
  });

  app.delete(
    `${APP_PATH}/global-steps/:id`,
    { preHandler: write },
    async (req: IdRequest, reply) => {
      const { organizationId, actor, app: application } = ctx(req);
      await inOrg(services, req, async (tx) => {
        if (!UUID.test(req.params.id)) throw notFound();
        const [row] = await tx
          .delete(schema.globalSteps)
          .where(
            and(
              eq(schema.globalSteps.id, req.params.id),
              eq(schema.globalSteps.applicationId, application.id),
            ),
          )
          .returning();
        if (!row) throw notFound();
        await audit(
          tx,
          { organizationId, actor },
          {
            action: 'global_step.deleted',
            targetType: 'global_step',
            targetId: row.id,
            targetLabel: `${application.key} · ${row.name}`,
            changes: { phase: { from: row.phase, to: null } },
          },
        );
      });
      return reply.code(204).send();
    },
  );

  // ---- Datasets -----------------------------------------------------------------------------

  app.get(`${APP_PATH}/datasets`, { preHandler: read }, async (req) =>
    inOrg(services, req, async (tx): Promise<DatasetSummary[]> => {
      const rows = await tx
        .select()
        .from(schema.datasets)
        .where(
          and(
            eq(schema.datasets.applicationId, req.application!.id),
            isNull(schema.datasets.deletedAt),
          ),
        )
        .orderBy(sql`lower(${schema.datasets.name})`);
      const names = await userNames(
        tx,
        rows.map((row) => row.updatedBy),
      );
      const used = await usage(
        tx,
        rows.map((row) => row.id),
      );
      return rows.map((row) => datasetSummary(row, names, used));
    }),
  );

  app.post(`${APP_PATH}/datasets`, { preHandler: write }, async (req, reply) => {
    const input = parse(datasetInputSchema, req.body);
    const { organizationId, actor, app: application, now } = ctx(req);
    try {
      const view = await inOrg(services, req, async (tx) => {
        const [row] = await tx
          .insert(schema.datasets)
          .values({
            organizationId,
            applicationId: application.id,
            name: input.name,
            description: input.description,
            columns: input.columns,
            rows: input.rows,
            createdBy: actor.id,
            createdAt: now,
            updatedBy: actor.id,
            updatedAt: now,
          })
          .returning();
        await audit(
          tx,
          { organizationId, actor },
          {
            action: 'dataset.created',
            targetType: 'dataset',
            targetId: row!.id,
            targetLabel: `${application.key} · ${row!.name}`,
            changes: {
              columns: { from: null, to: row!.columns },
              rows: { from: null, to: row!.rows.length },
            },
          },
        );
        return datasetView(tx, row!);
      });
      return reply.code(201).send(view);
    } catch (error) {
      if (isUniqueViolation(error, 'datasets_app_name_key')) throw nameTaken();
      throw error;
    }
  });

  app.get(`${APP_PATH}/datasets/:id`, { preHandler: read }, async (req: IdRequest) =>
    inOrg(services, req, async (tx) =>
      datasetView(tx, await findDataset(tx, req.application!, req.params.id)),
    ),
  );

  app.put(`${APP_PATH}/datasets/:id`, { preHandler: write }, async (req: IdRequest) => {
    const input = parse(datasetInputSchema, req.body);
    const { organizationId, actor, app: application, now } = ctx(req);
    try {
      return await inOrg(services, req, async (tx) => {
        const row = await findDataset(tx, application, req.params.id, true);
        const [updated] = await tx
          .update(schema.datasets)
          .set({
            name: input.name,
            description: input.description,
            columns: input.columns,
            rows: input.rows,
            updatedBy: actor.id,
            updatedAt: now,
          })
          .where(eq(schema.datasets.id, row.id))
          .returning();
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (row.name !== input.name) changes.name = { from: row.name, to: input.name };
        if (JSON.stringify(row.columns) !== JSON.stringify(input.columns)) {
          changes.columns = { from: row.columns, to: input.columns };
        }
        if (JSON.stringify(row.rows) !== JSON.stringify(input.rows)) {
          changes.rows = { from: row.rows.length, to: input.rows.length };
        }
        if (row.description !== input.description) {
          changes.description = { from: 'changed', to: 'changed' };
        }
        if (Object.keys(changes).length) {
          await audit(
            tx,
            { organizationId, actor },
            {
              action: 'dataset.updated',
              targetType: 'dataset',
              targetId: row.id,
              targetLabel: `${application.key} · ${updated!.name}`,
              changes,
            },
          );
        }
        return datasetView(tx, updated!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'datasets_app_name_key')) throw nameTaken();
      throw error;
    }
  });

  /** Soft delete; refused while live test cases use the dataset. */
  app.delete(`${APP_PATH}/datasets/:id`, { preHandler: write }, async (req: IdRequest, reply) => {
    const { organizationId, actor, app: application, now } = ctx(req);
    await inOrg(services, req, async (tx) => {
      const row = await findDataset(tx, application, req.params.id, true);
      const used = (await usage(tx, [row.id])).get(row.id) ?? 0;
      if (used > 0) {
        throw conflict('DATASET_IN_USE', `${used} test cases use this dataset.`, {
          testCaseCount: used,
        });
      }
      await tx
        .update(schema.datasets)
        .set({ deletedAt: now, deletedBy: actor.id })
        .where(eq(schema.datasets.id, row.id));
      await audit(
        tx,
        { organizationId, actor },
        {
          action: 'dataset.deleted',
          targetType: 'dataset',
          targetId: row.id,
          targetLabel: `${application.key} · ${row.name}`,
          changes: { deleted: { from: false, to: true } },
        },
      );
    });
    return reply.code(204).send();
  });
}
