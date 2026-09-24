import { updateMemberSchema, type Member, type OrgRole } from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { conflict, forbidden, notFound, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit, userLabel } from '../services/audit';
import type { ApiServices } from '../services/index';

type UserParams = { userId: string };

async function findMember(tx: Transaction, userId: string) {
  const [row] = await tx
    .select({
      userId: schema.memberships.userId,
      role: schema.memberships.role,
      name: schema.users.name,
      email: schema.users.email,
    })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.userId, userId))
    .limit(1);
  return row;
}

/** Locks the owner rows so concurrent changes cannot leave the organization ownerless. */
async function lockedOwnerCount(tx: Transaction): Promise<number> {
  const owners = await tx
    .select({ id: schema.memberships.id })
    .from(schema.memberships)
    .where(eq(schema.memberships.role, 'owner'))
    .for('update');
  return owners.length;
}

const LAST_OWNER_MESSAGE =
  'An organization needs at least one owner. Make someone else an owner first.';

/** Admins manage members and admins; only owners manage owners or grant ownership. */
function assertCanManage(actorRole: OrgRole, targetRole: OrgRole, newRole?: OrgRole): void {
  if (actorRole === 'owner') return;
  if (targetRole === 'owner' || newRole === 'owner') {
    throw forbidden('OWNER_REQUIRED', 'Only owners can manage owners.');
  }
}

export async function memberRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  app.get(
    '/api/orgs/:orgSlug/members',
    { preHandler: guards.org },
    async (req): Promise<Member[]> => {
      const rows = await inOrg(services, req, (tx) =>
        tx
          .select({
            userId: schema.memberships.userId,
            name: schema.users.name,
            email: schema.users.email,
            role: schema.memberships.role,
            joinedAt: schema.memberships.createdAt,
          })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .orderBy(asc(schema.users.name)),
      );
      return rows.map((row) => ({ ...row, joinedAt: row.joinedAt.toISOString() }));
    },
  );

  app.patch(
    '/api/orgs/:orgSlug/members/:userId',
    { preHandler: [guards.org, guards.orgPermission('members.manage')] },
    async (req: FastifyRequest<{ Params: UserParams }>) => {
      const { role } = parse(updateMemberSchema, req.body);
      const org = req.org!;
      return inOrg(services, req, async (tx) => {
        const target = await findMember(tx, req.params.userId);
        if (!target) throw notFound();
        assertCanManage(org.role, target.role, role);
        if (target.role === role) return { userId: target.userId, role };
        if (target.role === 'owner' && (await lockedOwnerCount(tx)) <= 1) {
          throw conflict('LAST_OWNER', LAST_OWNER_MESSAGE);
        }
        await tx
          .update(schema.memberships)
          .set({ role })
          .where(eq(schema.memberships.userId, target.userId));
        await audit(
          tx,
          { organizationId: org.id, actor: req.user! },
          {
            action: 'member.role_changed',
            targetType: 'user',
            targetId: target.userId,
            targetLabel: userLabel(target),
            changes: { role: { from: target.role, to: role } },
          },
        );
        return { userId: target.userId, role };
      });
    },
  );

  // Removing yourself is leaving, which any member may do.
  app.delete(
    '/api/orgs/:orgSlug/members/:userId',
    { preHandler: guards.org },
    async (req: FastifyRequest<{ Params: UserParams }>, reply) => {
      const org = req.org!;
      const leaving = req.params.userId === req.user!.id;
      if (!leaving && org.role === 'member') throw forbidden();
      await inOrg(services, req, async (tx) => {
        const target = await findMember(tx, req.params.userId);
        if (!target) throw notFound();
        if (!leaving) assertCanManage(org.role, target.role);
        if (target.role === 'owner' && (await lockedOwnerCount(tx)) <= 1) {
          throw conflict('LAST_OWNER', LAST_OWNER_MESSAGE);
        }
        // Access to every application of the organization goes with the membership.
        await tx
          .delete(schema.applicationMembers)
          .where(eq(schema.applicationMembers.userId, target.userId));
        await tx.delete(schema.memberships).where(eq(schema.memberships.userId, target.userId));
        await audit(
          tx,
          { organizationId: org.id, actor: req.user! },
          {
            action: leaving ? 'member.left' : 'member.removed',
            targetType: 'user',
            targetId: target.userId,
            targetLabel: userLabel(target),
            changes: { role: { from: target.role, to: null } },
          },
        );
      });
      return reply.code(204).send();
    },
  );
}
