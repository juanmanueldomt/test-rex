// Comments and requirement links on scenarios. Neither is part of scenario revisions.
import {
  commentInputSchema,
  hasAppPermission,
  LINKS_PER_SCENARIO_MAX,
  recognizeRequirementLink,
  requirementLinkInputSchema,
  type RequirementLink,
  type ScenarioComment,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { conflict, forbidden, isUniqueViolation, notFound, parse } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import { audit } from '../services/audit';
import type { ApiServices } from '../services/index';
import {
  assertNotDeleted,
  findScenario,
  refreshSearchText,
  scenarioLabel,
  userNames,
  userRef,
  type ScenarioContext,
  type ScenarioRow,
} from '../services/scenarios';
import { SCENARIOS_PATH, scenarioContext, type ScenarioParams } from './scenarios';

type CommentRequest = FastifyRequest<{ Params: ScenarioParams & { commentId: string } }>;
type LinkRequest = FastifyRequest<{ Params: ScenarioParams & { linkId: string } }>;

/** Audit entries keep a short excerpt of comment text, not the whole body. */
function excerpt(text: string): string {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

function assertUuid(id: string): void {
  if (!z.uuid().safeParse(id).success) throw notFound();
}

async function findComment(tx: Transaction, scenario: ScenarioRow, id: string) {
  assertUuid(id);
  const [row] = await tx
    .select()
    .from(schema.scenarioComments)
    .where(
      and(
        eq(schema.scenarioComments.id, id),
        eq(schema.scenarioComments.scenarioId, scenario.id),
        isNull(schema.scenarioComments.deletedAt),
      ),
    );
  if (!row) throw notFound();
  return row;
}

async function commentView(
  tx: Transaction,
  row: typeof schema.scenarioComments.$inferSelect,
): Promise<ScenarioComment> {
  const names = await userNames(tx, [row.authorId]);
  return {
    id: row.id,
    body: row.bodyMd,
    revision: row.revisionNumber,
    author: userRef(names, row.authorId),
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
  };
}

async function findLink(tx: Transaction, scenario: ScenarioRow, id: string) {
  assertUuid(id);
  const [row] = await tx
    .select()
    .from(schema.scenarioRequirementLinks)
    .where(
      and(
        eq(schema.scenarioRequirementLinks.id, id),
        eq(schema.scenarioRequirementLinks.scenarioId, scenario.id),
      ),
    );
  if (!row) throw notFound();
  return row;
}

async function linkView(
  tx: Transaction,
  row: typeof schema.scenarioRequirementLinks.$inferSelect,
): Promise<RequirementLink> {
  const names = await userNames(tx, [row.createdBy]);
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    provider: row.provider,
    issueKey: row.issueKey,
    createdBy: userRef(names, row.createdBy),
    createdAt: row.createdAt.toISOString(),
  };
}

const duplicateLink = () =>
  conflict('LINK_DUPLICATE', 'This URL is already linked to the scenario.');

function scenarioAudit(ctx: ScenarioContext, scenario: ScenarioRow) {
  return {
    context: { organizationId: ctx.organizationId, actor: ctx.user },
    target: {
      targetType: 'scenario' as const,
      targetId: scenario.id,
      targetLabel: scenarioLabel(ctx.app, scenario),
    },
  };
}

export async function collaborationRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const comment = [guards.app, guards.appPermission('comment.write'), guards.writableApp];
  const write = [guards.app, guards.appPermission('scenario.write'), guards.writableApp];
  type KeyRequest = FastifyRequest<{ Params: ScenarioParams }>;
  const COMMENTS = `${SCENARIOS_PATH}/:scenarioKey/comments`;
  const LINKS = `${SCENARIOS_PATH}/:scenarioKey/links`;

  // ---- Comments -----------------------------------------------------------------------------

  app.get(COMMENTS, { preHandler: read }, async (req: KeyRequest): Promise<ScenarioComment[]> =>
    inOrg(services, req, async (tx) => {
      const scenario = await findScenario(tx, req.application!, req.params.scenarioKey);
      const rows = await tx
        .select()
        .from(schema.scenarioComments)
        .where(
          and(
            eq(schema.scenarioComments.scenarioId, scenario.id),
            isNull(schema.scenarioComments.deletedAt),
          ),
        )
        .orderBy(asc(schema.scenarioComments.createdAt), asc(schema.scenarioComments.id));
      const names = await userNames(
        tx,
        rows.map((row) => row.authorId),
      );
      return rows.map((row) => ({
        id: row.id,
        body: row.bodyMd,
        revision: row.revisionNumber,
        author: userRef(names, row.authorId),
        createdAt: row.createdAt.toISOString(),
        editedAt: row.editedAt?.toISOString() ?? null,
      }));
    }),
  );

  app.post(COMMENTS, { preHandler: comment }, async (req: KeyRequest, reply) => {
    const { body } = parse(commentInputSchema, req.body);
    const ctx = scenarioContext(services, req);
    const created = await inOrg(services, req, async (tx) => {
      const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey);
      assertNotDeleted(scenario);
      const [row] = await tx
        .insert(schema.scenarioComments)
        .values({
          organizationId: ctx.organizationId,
          scenarioId: scenario.id,
          bodyMd: body,
          revisionNumber: scenario.currentRevision,
          authorId: ctx.user.id,
          createdAt: ctx.now,
        })
        .returning();
      const { context, target } = scenarioAudit(ctx, scenario);
      await audit(tx, context, {
        action: 'comment.created',
        ...target,
        changes: { comment: { from: null, to: excerpt(body) } },
      });
      return commentView(tx, row!);
    });
    return reply.code(201).send(created);
  });

  /** Only the author may edit a comment. */
  app.patch(`${COMMENTS}/:commentId`, { preHandler: comment }, async (req: CommentRequest) => {
    const { body } = parse(commentInputSchema, req.body);
    const ctx = scenarioContext(services, req);
    return inOrg(services, req, async (tx) => {
      const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey);
      assertNotDeleted(scenario);
      const current = await findComment(tx, scenario, req.params.commentId);
      if (current.authorId !== ctx.user.id) {
        throw forbidden('NOT_COMMENT_AUTHOR', 'Only the author can edit this comment.');
      }
      if (current.bodyMd === body) return commentView(tx, current);
      const [row] = await tx
        .update(schema.scenarioComments)
        .set({ bodyMd: body, editedAt: ctx.now })
        .where(eq(schema.scenarioComments.id, current.id))
        .returning();
      const { context, target } = scenarioAudit(ctx, scenario);
      await audit(tx, context, {
        action: 'comment.edited',
        ...target,
        changes: { comment: { from: excerpt(current.bodyMd), to: excerpt(body) } },
      });
      return commentView(tx, row!);
    });
  });

  /** Authors delete their own comments; managers (comment.moderate) delete any. */
  app.delete(
    `${COMMENTS}/:commentId`,
    { preHandler: comment },
    async (req: CommentRequest, reply) => {
      const ctx = scenarioContext(services, req);
      await inOrg(services, req, async (tx) => {
        const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey);
        const current = await findComment(tx, scenario, req.params.commentId);
        const own = current.authorId === ctx.user.id;
        if (!own && !hasAppPermission(ctx.app.role, 'comment.moderate')) {
          throw forbidden('NOT_COMMENT_AUTHOR', 'Only the author or a manager can delete this.');
        }
        await tx
          .update(schema.scenarioComments)
          .set({ deletedAt: ctx.now, deletedBy: ctx.user.id })
          .where(eq(schema.scenarioComments.id, current.id));
        const { context, target } = scenarioAudit(ctx, scenario);
        const names = await userNames(tx, [current.authorId]);
        await audit(tx, context, {
          action: 'comment.deleted',
          ...target,
          changes: {
            comment: { from: excerpt(current.bodyMd), to: null },
            ...(own
              ? {}
              : { author: { from: names.get(current.authorId ?? '') ?? null, to: null } }),
          },
        });
      });
      return reply.code(204).send();
    },
  );

  // ---- Requirement links --------------------------------------------------------------------

  app.get(LINKS, { preHandler: read }, async (req: KeyRequest): Promise<RequirementLink[]> =>
    inOrg(services, req, async (tx) => {
      const scenario = await findScenario(tx, req.application!, req.params.scenarioKey);
      const rows = await tx
        .select()
        .from(schema.scenarioRequirementLinks)
        .where(eq(schema.scenarioRequirementLinks.scenarioId, scenario.id))
        .orderBy(
          asc(schema.scenarioRequirementLinks.createdAt),
          asc(schema.scenarioRequirementLinks.id),
        );
      const names = await userNames(
        tx,
        rows.map((row) => row.createdBy),
      );
      return rows.map((row) => ({
        id: row.id,
        url: row.url,
        label: row.label,
        provider: row.provider,
        issueKey: row.issueKey,
        createdBy: userRef(names, row.createdBy),
        createdAt: row.createdAt.toISOString(),
      }));
    }),
  );

  app.post(LINKS, { preHandler: write }, async (req: KeyRequest, reply) => {
    const input = parse(requirementLinkInputSchema, req.body);
    const ctx = scenarioContext(services, req);
    try {
      const created = await inOrg(services, req, async (tx) => {
        const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey, {
          forUpdate: true,
        });
        assertNotDeleted(scenario);
        const [{ n } = { n: 0 }] = await tx
          .select({ n: count() })
          .from(schema.scenarioRequirementLinks)
          .where(eq(schema.scenarioRequirementLinks.scenarioId, scenario.id));
        if (n >= LINKS_PER_SCENARIO_MAX) {
          throw conflict(
            'LINK_LIMIT',
            `A scenario can have at most ${LINKS_PER_SCENARIO_MAX} requirement links.`,
            { max: LINKS_PER_SCENARIO_MAX },
          );
        }
        const recognized = recognizeRequirementLink(input.url);
        const [row] = await tx
          .insert(schema.scenarioRequirementLinks)
          .values({
            organizationId: ctx.organizationId,
            scenarioId: scenario.id,
            url: input.url,
            label: input.label,
            ...recognized,
            createdBy: ctx.user.id,
            createdAt: ctx.now,
            updatedAt: ctx.now,
          })
          .returning();
        await refreshSearchText(tx, scenario);
        const { context, target } = scenarioAudit(ctx, scenario);
        await audit(tx, context, {
          action: 'requirement_link.added',
          ...target,
          changes: { link: { from: null, to: input.url } },
        });
        return linkView(tx, row!);
      });
      return reply.code(201).send(created);
    } catch (error) {
      if (isUniqueViolation(error, 'scenario_requirement_links_scenario_url_key')) {
        throw duplicateLink();
      }
      throw error;
    }
  });

  app.patch(`${LINKS}/:linkId`, { preHandler: write }, async (req: LinkRequest) => {
    const input = parse(requirementLinkInputSchema, req.body);
    const ctx = scenarioContext(services, req);
    try {
      return await inOrg(services, req, async (tx) => {
        const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey);
        assertNotDeleted(scenario);
        const current = await findLink(tx, scenario, req.params.linkId);
        if (current.url === input.url && current.label === input.label) {
          return linkView(tx, current);
        }
        const [row] = await tx
          .update(schema.scenarioRequirementLinks)
          .set({
            url: input.url,
            label: input.label,
            ...recognizeRequirementLink(input.url),
            updatedAt: ctx.now,
          })
          .where(eq(schema.scenarioRequirementLinks.id, current.id))
          .returning();
        await refreshSearchText(tx, scenario);
        const changes: Record<string, { from: unknown; to: unknown }> = {};
        if (current.url !== input.url) changes.link = { from: current.url, to: input.url };
        if (current.label !== input.label) changes.label = { from: current.label, to: input.label };
        const { context, target } = scenarioAudit(ctx, scenario);
        await audit(tx, context, { action: 'requirement_link.updated', ...target, changes });
        return linkView(tx, row!);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'scenario_requirement_links_scenario_url_key')) {
        throw duplicateLink();
      }
      throw error;
    }
  });

  app.delete(`${LINKS}/:linkId`, { preHandler: write }, async (req: LinkRequest, reply) => {
    const ctx = scenarioContext(services, req);
    await inOrg(services, req, async (tx) => {
      const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey);
      assertNotDeleted(scenario);
      const current = await findLink(tx, scenario, req.params.linkId);
      await tx
        .delete(schema.scenarioRequirementLinks)
        .where(eq(schema.scenarioRequirementLinks.id, current.id));
      await refreshSearchText(tx, scenario);
      const { context, target } = scenarioAudit(ctx, scenario);
      await audit(tx, context, {
        action: 'requirement_link.removed',
        ...target,
        changes: { link: { from: current.url, to: null } },
      });
    });
    return reply.code(204).send();
  });
}
