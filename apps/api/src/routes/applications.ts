import {
  APP_KEY_MAX,
  appPermissionsFor,
  createAppSchema,
  effectiveAppRole,
  setAppMemberSchema,
  suggestAppKey,
  updateAppSchema,
  withSuffix,
  type AppContext,
  type AppMember,
  type AppSummary,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { badRequest, conflict, isUniqueViolation, notFound, parse } from '../http/errors';
import { inOrg, type Guards, type RequestApp } from '../http/guards';
import { audit, userLabel } from '../services/audit';
import type { ApiServices } from '../services/index';

type UserParams = { userId: string };

function toAppContext(app: RequestApp): AppContext {
  return {
    id: app.id,
    key: app.key,
    name: app.name,
    description: app.description,
    archivedAt: app.archivedAt?.toISOString() ?? null,
    role: app.role,
    permissions: appPermissionsFor(app.role),
  };
}

async function availableKey(tx: Transaction, base: string): Promise<string> {
  const candidates = [
    base,
    ...Array.from({ length: 20 }, (_, i) => withSuffix(base, i + 2, APP_KEY_MAX)),
  ];
  const taken = await tx
    .select({ key: schema.applications.key })
    .from(schema.applications)
    .where(inArray(schema.applications.key, candidates));
  const takenSet = new Set(taken.map((row) => row.key));
  return candidates.find((key) => !takenSet.has(key)) ?? base;
}

export async function applicationRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const appScope = [guards.app];
  const manageWritable = [guards.app, guards.appPermission('app.manage'), guards.writableApp];

  app.get(
    '/api/orgs/:orgSlug/apps',
    { preHandler: guards.org },
    async (req): Promise<AppSummary[]> => {
      const { status } = parse(
        z.object({ status: z.enum(['active', 'archived', 'all']).default('active') }),
        req.query,
      );
      const org = req.org!;
      const rows = await inOrg(services, req, (tx) =>
        tx
          .select({ app: schema.applications, explicitRole: schema.applicationMembers.role })
          .from(schema.applications)
          .leftJoin(
            schema.applicationMembers,
            and(
              eq(schema.applicationMembers.applicationId, schema.applications.id),
              eq(schema.applicationMembers.userId, req.user!.id),
            ),
          )
          .where(
            status === 'active'
              ? isNull(schema.applications.archivedAt)
              : status === 'archived'
                ? isNotNull(schema.applications.archivedAt)
                : undefined,
          )
          .orderBy(asc(schema.applications.name)),
      );
      // Only applications the caller can access are listed.
      return rows.flatMap(({ app: row, explicitRole }) => {
        const role = effectiveAppRole(org.role, explicitRole);
        if (!role) return [];
        return [
          {
            id: row.id,
            key: row.key,
            name: row.name,
            description: row.description,
            archivedAt: row.archivedAt?.toISOString() ?? null,
            role,
          },
        ];
      });
    },
  );

  app.get(
    '/api/orgs/:orgSlug/suggestions/app-key',
    { preHandler: [guards.org, guards.orgPermission('apps.create')] },
    async (req) => {
      const { name } = parse(z.object({ name: z.string().max(80).default('') }), req.query);
      return { key: await inOrg(services, req, (tx) => availableKey(tx, suggestAppKey(name))) };
    },
  );

  app.post(
    '/api/orgs/:orgSlug/apps',
    { preHandler: [guards.org, guards.orgPermission('apps.create')] },
    async (req, reply) => {
      const input = parse(createAppSchema, req.body);
      const org = req.org!;
      await services.quota.check('application.create', { organizationId: org.id, plan: org.plan });
      try {
        const created = await inOrg(services, req, async (tx) => {
          const [row] = await tx
            .insert(schema.applications)
            .values({
              organizationId: org.id,
              name: input.name,
              key: input.key,
              description: input.description || null,
            })
            .returning();
          await audit(
            tx,
            { organizationId: org.id, actor: req.user! },
            {
              action: 'application.created',
              targetType: 'application',
              targetId: row!.id,
              targetLabel: `${row!.key} · ${row!.name}`,
              changes: { name: { from: null, to: row!.name }, key: { from: null, to: row!.key } },
            },
          );
          return row!;
        });
        return reply
          .code(201)
          .send(toAppContext({ ...created, explicitRole: null, role: 'manager' }));
      } catch (error) {
        if (isUniqueViolation(error, 'applications_org_key_key')) {
          const suggestion = await inOrg(services, req, (tx) => availableKey(tx, input.key));
          throw conflict('KEY_TAKEN', `The key ${input.key} is already in use.`, { suggestion });
        }
        throw error;
      }
    },
  );

  app.get('/api/orgs/:orgSlug/apps/:appKey', { preHandler: appScope }, async (req) =>
    toAppContext(req.application!),
  );

  app.patch('/api/orgs/:orgSlug/apps/:appKey', { preHandler: manageWritable }, async (req) => {
    const input = parse(updateAppSchema, req.body);
    const current = req.application!;
    if (input.key !== undefined && input.key !== current.key) {
      throw badRequest('KEY_IMMUTABLE', 'An application key cannot be changed.');
    }
    const name = input.name ?? current.name;
    const description =
      input.description === undefined ? current.description : input.description || null;
    if (name === current.name && description === current.description) {
      return toAppContext(current);
    }
    await inOrg(services, req, async (tx) => {
      await tx
        .update(schema.applications)
        .set({ name, description, updatedAt: services.now() })
        .where(eq(schema.applications.id, current.id));
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (name !== current.name) changes.name = { from: current.name, to: name };
      if (description !== current.description) {
        changes.description = { from: current.description, to: description };
      }
      await audit(
        tx,
        { organizationId: req.org!.id, actor: req.user! },
        {
          action: changes.name ? 'application.renamed' : 'application.updated',
          targetType: 'application',
          targetId: current.id,
          targetLabel: `${current.key} · ${name}`,
          changes,
        },
      );
    });
    return toAppContext({ ...current, name, description });
  });

  async function setArchived(req: FastifyRequest, archived: boolean): Promise<AppContext> {
    const current = req.application!;
    if (Boolean(current.archivedAt) === archived) return toAppContext(current);
    const archivedAt = archived ? services.now() : null;
    await inOrg(services, req, async (tx) => {
      await tx
        .update(schema.applications)
        .set({ archivedAt, updatedAt: services.now() })
        .where(eq(schema.applications.id, current.id));
      await audit(
        tx,
        { organizationId: req.org!.id, actor: req.user! },
        {
          action: archived ? 'application.archived' : 'application.restored',
          targetType: 'application',
          targetId: current.id,
          targetLabel: `${current.key} · ${current.name}`,
          changes: { archived: { from: !archived, to: archived } },
        },
      );
    });
    return toAppContext({ ...current, archivedAt });
  }

  const archivePermission = [guards.app, guards.orgPermission('apps.archive')];
  app.post('/api/orgs/:orgSlug/apps/:appKey/archive', { preHandler: archivePermission }, (req) =>
    setArchived(req, true),
  );
  app.post('/api/orgs/:orgSlug/apps/:appKey/restore', { preHandler: archivePermission }, (req) =>
    setArchived(req, false),
  );

  app.get(
    '/api/orgs/:orgSlug/apps/:appKey/members',
    { preHandler: appScope },
    async (req): Promise<AppMember[]> => {
      const rows = await inOrg(services, req, (tx) =>
        tx
          .select({
            userId: schema.memberships.userId,
            name: schema.users.name,
            email: schema.users.email,
            orgRole: schema.memberships.role,
            appRole: schema.applicationMembers.role,
          })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .leftJoin(
            schema.applicationMembers,
            and(
              eq(schema.applicationMembers.userId, schema.memberships.userId),
              eq(schema.applicationMembers.applicationId, req.application!.id),
            ),
          )
          .orderBy(asc(schema.users.name)),
      );
      return rows.map((row) => ({
        ...row,
        effectiveRole: effectiveAppRole(row.orgRole, row.appRole),
        implicit: row.orgRole !== 'member',
      }));
    },
  );

  app.put(
    '/api/orgs/:orgSlug/apps/:appKey/members/:userId',
    { preHandler: manageWritable },
    async (req: FastifyRequest<{ Params: UserParams }>) => {
      const { role } = parse(setAppMemberSchema, req.body);
      const application = req.application!;
      return inOrg(services, req, async (tx) => {
        const [target] = await tx
          .select({
            userId: schema.memberships.userId,
            orgRole: schema.memberships.role,
            name: schema.users.name,
            email: schema.users.email,
            appRole: schema.applicationMembers.role,
          })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .leftJoin(
            schema.applicationMembers,
            and(
              eq(schema.applicationMembers.userId, schema.memberships.userId),
              eq(schema.applicationMembers.applicationId, application.id),
            ),
          )
          .where(eq(schema.memberships.userId, req.params.userId))
          .limit(1);
        if (!target) throw notFound();
        if (target.orgRole !== 'member') {
          throw badRequest(
            'IMPLICIT_MANAGER',
            'Organization owners and admins already manage every application.',
          );
        }
        if (target.appRole !== role) {
          await tx
            .insert(schema.applicationMembers)
            .values({
              organizationId: req.org!.id,
              applicationId: application.id,
              userId: target.userId,
              role,
            })
            .onConflictDoUpdate({
              target: [schema.applicationMembers.applicationId, schema.applicationMembers.userId],
              set: { role },
            });
          await audit(
            tx,
            { organizationId: req.org!.id, actor: req.user! },
            {
              action: 'application.member_role_changed',
              targetType: 'user',
              targetId: target.userId,
              targetLabel: userLabel(target),
              changes: { [`role:${application.key}`]: { from: target.appRole, to: role } },
            },
          );
        }
        return { userId: target.userId, role };
      });
    },
  );

  app.delete(
    '/api/orgs/:orgSlug/apps/:appKey/members/:userId',
    { preHandler: manageWritable },
    async (req: FastifyRequest<{ Params: UserParams }>, reply) => {
      const application = req.application!;
      await inOrg(services, req, async (tx) => {
        const [removed] = await tx
          .delete(schema.applicationMembers)
          .where(
            and(
              eq(schema.applicationMembers.applicationId, application.id),
              eq(schema.applicationMembers.userId, req.params.userId),
            ),
          )
          .returning();
        if (!removed) throw notFound();
        const [user] = await tx
          .select({ name: schema.users.name, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, removed.userId));
        await audit(
          tx,
          { organizationId: req.org!.id, actor: req.user! },
          {
            action: 'application.member_role_changed',
            targetType: 'user',
            targetId: removed.userId,
            targetLabel: user ? userLabel(user) : null,
            changes: { [`role:${application.key}`]: { from: removed.role, to: null } },
          },
        );
      });
      return reply.code(204).send();
    },
  );
}
