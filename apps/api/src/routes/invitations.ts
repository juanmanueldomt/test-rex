import {
  createInvitationSchema,
  type CreateInvitationResponse,
  type Invitation,
  type InvitationPreview,
} from '@testrex/contracts';
import { schema, withOrg } from '@testrex/db';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError, conflict, forbidden, notFound, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit, userLabel } from '../services/audit';
import type { ApiServices } from '../services/index';
import {
  createInvitationToken,
  findInvitation,
  INVITATION_TTL_MS,
  invitationLink,
  invitationStatus,
  toInvitation,
} from '../services/invitations';

type TokenParams = { token: string };
type IdParams = { id: string };

export async function invitationRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const { db, mailer, config } = services;
  const manage = [guards.org, guards.orgPermission('members.manage')];

  app.get(
    '/api/orgs/:orgSlug/invitations',
    { preHandler: manage },
    async (req): Promise<Invitation[]> => {
      const rows = await inOrg(services, req, (tx) =>
        tx
          .select()
          .from(schema.invitations)
          .where(and(isNull(schema.invitations.acceptedAt), isNull(schema.invitations.revokedAt)))
          .orderBy(desc(schema.invitations.createdAt)),
      );
      const now = services.now();
      return rows.map((row) => toInvitation(row, now));
    },
  );

  app.post('/api/orgs/:orgSlug/invitations', { preHandler: manage }, async (req, reply) => {
    const input = parse(createInvitationSchema, req.body);
    const email = input.email.trim().toLowerCase();
    const org = req.org!;
    const actor = req.user!;
    if (input.role === 'owner' && org.role !== 'owner') {
      throw forbidden('OWNER_REQUIRED', 'Only owners can invite owners.');
    }
    await services.quota.check('member.add', { organizationId: org.id, plan: org.plan });

    const { token, tokenHash } = createInvitationToken(org.id);
    const now = services.now();
    const row = await inOrg(services, req, async (tx) => {
      const [existingMember] = await tx
        .select({ id: schema.memberships.id })
        .from(schema.memberships)
        .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
        .where(eq(schema.users.email, email))
        .limit(1);
      if (existingMember) {
        throw conflict('ALREADY_MEMBER', 'This person is already a member of the organization.');
      }
      // A new invitation replaces any earlier pending one for the same address.
      await tx
        .update(schema.invitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.invitations.email, email),
            isNull(schema.invitations.acceptedAt),
            isNull(schema.invitations.revokedAt),
          ),
        );
      const [created] = await tx
        .insert(schema.invitations)
        .values({
          organizationId: org.id,
          email,
          role: input.role,
          tokenHash,
          invitedBy: actor.id,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          createdAt: now,
        })
        .returning();
      await audit(
        tx,
        { organizationId: org.id, actor },
        {
          action: 'member.invited',
          targetType: 'invitation',
          targetId: created!.id,
          targetLabel: email,
          changes: { role: { from: null, to: input.role } },
        },
      );
      return created!;
    });

    const link = invitationLink(config.PUBLIC_URL, token);
    const response: CreateInvitationResponse = {
      invitation: toInvitation(row, now),
      delivery: 'link',
      link,
    };
    if (mailer.enabled) {
      try {
        await mailer.send({
          to: email,
          subject: `${actor.name} invited you to ${org.name} on testRex`,
          text: [
            `${actor.name} invited you to join ${org.name} on testRex as ${input.role}.`,
            '',
            `Accept the invitation: ${link}`,
            '',
            'The link expires in 7 days. If you did not expect this email, you can ignore it.',
          ].join('\n'),
        });
        response.delivery = 'email';
        delete response.link;
      } catch (error) {
        // The invitation exists either way; fall back to sharing the link manually.
        req.log.warn({ err: error }, 'could not email invitation; returning link instead');
      }
    }
    return reply.code(201).send(response);
  });

  app.delete(
    '/api/orgs/:orgSlug/invitations/:id',
    { preHandler: manage },
    async (req: FastifyRequest<{ Params: IdParams }>, reply) => {
      await inOrg(services, req, async (tx) => {
        const [row] = await tx
          .update(schema.invitations)
          .set({ revokedAt: services.now() })
          .where(
            and(
              eq(schema.invitations.id, req.params.id),
              isNull(schema.invitations.acceptedAt),
              isNull(schema.invitations.revokedAt),
            ),
          )
          .returning();
        if (!row) throw notFound();
        await audit(
          tx,
          { organizationId: req.org!.id, actor: req.user! },
          {
            action: 'invitation.revoked',
            targetType: 'invitation',
            targetId: row.id,
            targetLabel: row.email,
          },
        );
      });
      return reply.code(204).send();
    },
  );

  // Public: the invitation page needs the organization name and invited email before sign-in.
  app.get(
    '/api/invitations/:token',
    async (req: FastifyRequest<{ Params: TokenParams }>): Promise<InvitationPreview> => {
      const found = await findInvitation(db, req.params.token);
      if (!found) throw notFound('This invitation does not exist.');
      return {
        organization: { name: found.organization.name, slug: found.organization.slug },
        email: found.invitation.email,
        role: found.invitation.role,
        status: invitationStatus(found.invitation, services.now()),
        expiresAt: found.invitation.expiresAt.toISOString(),
      };
    },
  );

  app.post(
    '/api/invitations/:token/accept',
    { preHandler: guards.user },
    async (req: FastifyRequest<{ Params: TokenParams }>) => {
      const user = req.user!;
      const found = await findInvitation(db, req.params.token);
      if (!found) throw notFound('This invitation does not exist.');
      const { organization, invitation } = found;
      const status = invitationStatus(invitation, services.now());
      if (status !== 'pending') {
        throw new ApiError(
          410,
          `INVITATION_${status.toUpperCase()}`,
          `This invitation is ${status}.`,
        );
      }
      if (invitation.email !== user.email.toLowerCase()) {
        throw forbidden(
          'INVITATION_WRONG_ACCOUNT',
          `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`,
        );
      }

      await withOrg(
        db,
        organization.id,
        async (tx) => {
          // Consume first; the conditional update makes acceptance single-use under concurrency.
          const consumed = await tx
            .update(schema.invitations)
            .set({ acceptedAt: services.now(), acceptedBy: user.id })
            .where(
              and(eq(schema.invitations.id, invitation.id), isNull(schema.invitations.acceptedAt)),
            )
            .returning({ id: schema.invitations.id });
          if (consumed.length === 0) {
            throw new ApiError(410, 'INVITATION_ACCEPTED', 'This invitation is accepted.');
          }
          const inserted = await tx
            .insert(schema.memberships)
            .values({ organizationId: organization.id, userId: user.id, role: invitation.role })
            .onConflictDoNothing()
            .returning({ id: schema.memberships.id });
          if (inserted.length > 0) {
            await audit(
              tx,
              { organizationId: organization.id, actor: user },
              {
                action: 'member.joined',
                targetType: 'user',
                targetId: user.id,
                targetLabel: userLabel(user),
                changes: { role: { from: null, to: invitation.role } },
              },
            );
          }
        },
        user.id,
      );
      await db
        .update(schema.users)
        .set({ lastOrganizationId: organization.id })
        .where(eq(schema.users.id, user.id));
      return { organization: { slug: organization.slug, name: organization.name } };
    },
  );
}
