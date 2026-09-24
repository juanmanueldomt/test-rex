import type { IncomingHttpHeaders } from 'node:http';
import {
  effectiveAppRole,
  hasAppPermission,
  hasOrgPermission,
  type AppPermission,
  type AppRole,
  type OrgPermission,
  type OrgRole,
  type SessionUser,
} from '@testrex/contracts';
import { schema, withOrg, type Transaction } from '@testrex/db';
import { and, eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import type { ApiServices } from '../services/index';
import { conflict, forbidden, notFound, unauthorized } from './errors';

export interface RequestOrg {
  id: string;
  slug: string;
  name: string;
  plan: string;
  role: OrgRole;
}

export interface RequestApp {
  id: string;
  key: string;
  name: string;
  description: string | null;
  archivedAt: Date | null;
  explicitRole: AppRole | null;
  role: AppRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
    org: RequestOrg | null;
    application: RequestApp | null;
  }
}

export function toHeaders(nodeHeaders: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(key, item);
  }
  return headers;
}

type Params = { orgSlug?: string; appKey?: string };

export type Guards = ReturnType<typeof createGuards>;

/**
 * Fastify preHandlers that resolve who is calling and what they may touch. A caller without
 * access to an organization or application gets the same 404 as for one that does not exist.
 */
export function createGuards(services: ApiServices) {
  const { db, auth } = services;

  async function user(req: FastifyRequest): Promise<void> {
    if (req.user) return;
    const session = await auth.getSession(toHeaders(req.headers));
    if (!session) throw unauthorized();
    req.user = session.user;
  }

  async function org(req: FastifyRequest): Promise<void> {
    await user(req);
    const slug = (req.params as Params).orgSlug ?? '';
    const [found] = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.slug, slug))
      .limit(1);
    if (!found) throw notFound();
    const [membership] = await withOrg(db, found.id, (tx) =>
      tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(eq(schema.memberships.userId, req.user!.id))
        .limit(1),
    );
    if (!membership) throw notFound();
    req.org = {
      id: found.id,
      slug: found.slug,
      name: found.name,
      plan: found.plan,
      role: membership.role,
    };
  }

  function orgPermission(permission: OrgPermission) {
    return async (req: FastifyRequest): Promise<void> => {
      if (!hasOrgPermission(req.org!.role, permission)) throw forbidden();
    };
  }

  async function app(req: FastifyRequest): Promise<void> {
    await org(req);
    const key = (req.params as Params).appKey ?? '';
    const rows = await withOrg(db, req.org!.id, (tx) =>
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
        .where(eq(schema.applications.key, key))
        .limit(1),
    );
    const row = rows[0];
    const role = row ? effectiveAppRole(req.org!.role, row.explicitRole) : null;
    if (!row || !role) throw notFound();
    req.application = {
      id: row.app.id,
      key: row.app.key,
      name: row.app.name,
      description: row.app.description,
      archivedAt: row.app.archivedAt,
      explicitRole: row.explicitRole,
      role,
    };
  }

  function appPermission(permission: AppPermission) {
    return async (req: FastifyRequest): Promise<void> => {
      if (!hasAppPermission(req.application!.role, permission)) throw forbidden();
    };
  }

  /** Archived applications are read-only. */
  async function writableApp(req: FastifyRequest): Promise<void> {
    if (req.application!.archivedAt) {
      throw conflict(
        'APP_ARCHIVED',
        'This application is archived and read-only. Restore it to make changes.',
      );
    }
  }

  return { user, org, orgPermission, app, appPermission, writableApp };
}

/** Runs `fn` scoped to the request's organization (RLS) as the signed-in user. */
export function inOrg<T>(
  services: ApiServices,
  req: FastifyRequest,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return withOrg(services.db, req.org!.id, fn, req.user!.id);
}
