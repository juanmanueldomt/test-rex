import type { InstanceInfo, MeResponse } from '@testrex/contracts';
import { schema, withContext } from '@testrex/db';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Guards } from '../http/guards';
import type { ApiServices } from '../services/index';

export async function sessionRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const { db, auth, config, mailer } = services;

  app.get('/api/instance', async (): Promise<InstanceInfo> => ({
    signupEnabled: config.ALLOW_SIGNUP,
    needsSetup: !(await auth.hasUsers()),
    emailDelivery: mailer.enabled,
  }));

  app.get('/api/me', { preHandler: guards.user }, async (req): Promise<MeResponse> => {
    const user = req.user!;
    // The own_memberships policy lets a user list their memberships across organizations.
    const organizations = await withContext(db, { userId: user.id }, (tx) =>
      tx
        .select({
          id: schema.organizations.id,
          slug: schema.organizations.slug,
          name: schema.organizations.name,
          role: schema.memberships.role,
        })
        .from(schema.memberships)
        .innerJoin(
          schema.organizations,
          eq(schema.organizations.id, schema.memberships.organizationId),
        )
        .where(eq(schema.memberships.userId, user.id))
        .orderBy(asc(schema.organizations.name)),
    );
    const [profile] = await db
      .select({ lastOrganizationId: schema.users.lastOrganizationId })
      .from(schema.users)
      .where(eq(schema.users.id, user.id));
    const last = organizations.find((org) => org.id === profile?.lastOrganizationId);
    return {
      user,
      organizations,
      lastOrganizationSlug: last?.slug ?? organizations[0]?.slug ?? null,
    };
  });
}
