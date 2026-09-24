import {
  createOrgSchema,
  ORG_SLUG_MAX,
  orgPermissionsFor,
  renameOrgSchema,
  slugify,
  withSuffix,
  type OrgContext,
} from '@testrex/contracts';
import { schema, withOrg, type Database } from '@testrex/db';
import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { conflict, isUniqueViolation, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit } from '../services/audit';
import type { ApiServices } from '../services/index';

/** First available slug among the base and numbered alternatives. */
async function availableSlug(db: Database, base: string): Promise<string> {
  const candidates = [
    base,
    ...Array.from({ length: 20 }, (_, i) => withSuffix(base, i + 2, ORG_SLUG_MAX, '-')),
  ];
  const taken = await db
    .select({ slug: schema.organizations.slug })
    .from(schema.organizations)
    .where(inArray(schema.organizations.slug, candidates));
  const takenSet = new Set(taken.map((row) => row.slug));
  return (
    candidates.find((slug) => !takenSet.has(slug)) ??
    withSuffix(base, Date.now() % 100000, ORG_SLUG_MAX, '-')
  );
}

export function orgContext(req: FastifyRequest): OrgContext {
  const org = req.org!;
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    role: org.role,
    plan: org.plan,
    permissions: orgPermissionsFor(org.role),
  };
}

export async function organizationRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const { db } = services;

  app.get('/api/suggestions/org-slug', { preHandler: guards.user }, async (req) => {
    const { name } = parse(z.object({ name: z.string().max(80).default('') }), req.query);
    return { slug: await availableSlug(db, slugify(name)) };
  });

  app.post('/api/orgs', { preHandler: guards.user }, async (req, reply) => {
    const input = parse(createOrgSchema, req.body);
    const user = req.user!;
    await services.quota.check('organization.create', {});

    const slug = input.slug ?? (await availableSlug(db, slugify(input.name)));
    const organizationId = schema.newId();
    try {
      await withOrg(db, organizationId, async (tx) => {
        await tx
          .insert(schema.organizations)
          .values({ id: organizationId, name: input.name, slug });
        await tx
          .insert(schema.memberships)
          .values({ organizationId, userId: user.id, role: 'owner' });
        await audit(
          tx,
          { organizationId, actor: user },
          {
            action: 'organization.created',
            targetType: 'organization',
            targetId: organizationId,
            targetLabel: input.name,
            changes: { name: { from: null, to: input.name }, slug: { from: null, to: slug } },
          },
        );
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw conflict('SLUG_TAKEN', 'That URL is already taken.', {
          suggestion: await availableSlug(db, slug),
        });
      }
      throw error;
    }
    await db
      .update(schema.users)
      .set({ lastOrganizationId: organizationId })
      .where(eq(schema.users.id, user.id));

    return reply.code(201).send({
      id: organizationId,
      slug,
      name: input.name,
      role: 'owner',
      plan: 'self_hosted',
      permissions: orgPermissionsFor('owner'),
    } satisfies OrgContext);
  });

  app.get('/api/orgs/:orgSlug', { preHandler: guards.org }, async (req): Promise<OrgContext> => {
    // Remember the organization so the next sign-in lands here.
    await db
      .update(schema.users)
      .set({ lastOrganizationId: req.org!.id })
      .where(eq(schema.users.id, req.user!.id));
    return orgContext(req);
  });

  app.patch(
    '/api/orgs/:orgSlug',
    { preHandler: [guards.org, guards.orgPermission('org.manage')] },
    async (req): Promise<OrgContext> => {
      const { name } = parse(renameOrgSchema, req.body);
      const org = req.org!;
      if (name !== org.name) {
        await inOrg(services, req, async (tx) => {
          await tx
            .update(schema.organizations)
            .set({ name, updatedAt: services.now() })
            .where(eq(schema.organizations.id, org.id));
          await audit(
            tx,
            { organizationId: org.id, actor: req.user! },
            {
              action: 'organization.renamed',
              targetType: 'organization',
              targetId: org.id,
              targetLabel: name,
              changes: { name: { from: org.name, to: name } },
            },
          );
        });
        org.name = name;
      }
      return orgContext(req);
    },
  );
}
