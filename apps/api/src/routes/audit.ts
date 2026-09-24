import { auditQuerySchema, type AuditPage } from '@testrex/contracts';
import { schema } from '@testrex/db';
import { and, desc, eq, gte, lt, lte, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import type { ApiServices } from '../services/index';

export async function auditRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  app.get(
    '/api/orgs/:orgSlug/audit',
    { preHandler: [guards.org, guards.orgPermission('audit.read')] },
    async (req): Promise<AuditPage> => {
      const query = parse(auditQuerySchema, req.query);
      const events = schema.auditEvents;
      const filters: SQL[] = [];
      if (query.actorId) filters.push(eq(events.actorUserId, query.actorId));
      if (query.action) filters.push(eq(events.action, query.action));
      if (query.from) filters.push(gte(events.createdAt, new Date(query.from)));
      if (query.to) filters.push(lte(events.createdAt, new Date(query.to)));
      // Ids are UUIDv7 (time-ordered), so they double as a stable pagination cursor.
      if (query.before) filters.push(lt(events.id, query.before));

      const rows = await inOrg(services, req, (tx) =>
        tx
          .select()
          .from(events)
          .where(and(...filters))
          .orderBy(desc(events.id))
          .limit(query.limit + 1),
      );
      const page = rows.slice(0, query.limit);
      return {
        events: page.map((row) => ({
          id: row.id,
          action: row.action,
          actor: { id: row.actorUserId, label: row.actorLabel },
          target: { type: row.targetType, id: row.targetId, label: row.targetLabel },
          changes: row.changes,
          createdAt: row.createdAt.toISOString(),
        })),
        nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null,
      };
    },
  );
}
