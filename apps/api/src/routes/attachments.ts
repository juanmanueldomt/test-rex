import multipart from '@fastify/multipart';
import type { Attachment, AttachmentLimits } from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { attachmentStorageKey, StorageNotFoundError } from '@testrex/storage';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError, badRequest, notFound } from '../http/errors';
import { inOrg, type Guards } from '../http/guards';
import {
  attachmentViews,
  INLINE_IMAGE_TYPES,
  inspectStream,
  safeFileName,
  storageUsageBytes,
} from '../services/attachments';
import { audit } from '../services/audit';
import type { ApiServices } from '../services/index';
import {
  assertNotDeleted,
  findScenario,
  scenarioLabel,
  type ScenarioRow,
} from '../services/scenarios';
import { SCENARIOS_PATH, scenarioContext, type ScenarioParams } from './scenarios';

const APP_PATH = '/api/orgs/:orgSlug/apps/:appKey';
type AttachmentRequest = FastifyRequest<{ Params: ScenarioParams & { attachmentId: string } }>;

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`
    : `${Math.ceil(bytes / 1024)} KB`;
}

/** `attachment; filename="..."; filename*=UTF-8''...` with an ASCII fallback. */
function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function attachmentRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const maxBytes = services.config.ATTACHMENT_MAX_BYTES;
  await app.register(multipart, {
    limits: { fileSize: maxBytes, files: 1, fields: 5 },
    throwFileSizeLimit: false,
  });

  const read = [guards.app];
  const write = [guards.app, guards.appPermission('scenario.write'), guards.writableApp];

  /**
   * Streams one uploaded file to storage and records it: on `scenario`, or as a pending upload
   * (new-scenario form) that a scenario claims when its text references it.
   */
  async function upload(req: FastifyRequest, scenario: ScenarioRow | null): Promise<Attachment> {
    const ctx = scenarioContext(services, req);
    const org = req.org!;
    const declared = Number(req.headers['content-length']) || maxBytes;
    const usageBytes = await inOrg(services, req, (tx) => storageUsageBytes(tx));
    await services.quota.check('storage.upload', {
      organizationId: org.id,
      plan: org.plan,
      bytes: Math.min(declared, maxBytes),
      usageBytes,
    });
    if (!req.isMultipart()) throw badRequest('FILE_REQUIRED', 'Choose a file to upload.');
    const part = await req.file();
    if (!part) throw badRequest('FILE_REQUIRED', 'Choose a file to upload.');

    const id = schema.newId();
    const key = attachmentStorageKey(org.id, id);
    const inspected = await inspectStream(part.file);
    await services.storage.put(key, inspected.body, { contentType: inspected.contentType });
    if (part.file.truncated) {
      await services.storage.delete(key);
      throw new ApiError(413, 'FILE_TOO_LARGE', `Files can be at most ${formatBytes(maxBytes)}.`, {
        maxBytes,
      });
    }
    const { size, sha256 } = inspected.result();
    const fileName = safeFileName(part.filename);
    try {
      return await inOrg(services, req, async (tx) => {
        const [row] = await tx
          .insert(schema.attachments)
          .values({
            id,
            organizationId: org.id,
            applicationId: ctx.app.id,
            scenarioId: scenario?.id ?? null,
            storageKey: key,
            fileName,
            contentType: inspected.contentType,
            sizeBytes: size,
            sha256,
            uploadedBy: ctx.user.id,
            createdAt: ctx.now,
          })
          .returning();
        await audit(
          tx,
          { organizationId: org.id, actor: ctx.user },
          {
            action: 'attachment.uploaded',
            ...(scenario
              ? {
                  targetType: 'scenario',
                  targetId: scenario.id,
                  targetLabel: scenarioLabel(ctx.app, scenario),
                }
              : {
                  targetType: 'application',
                  targetId: ctx.app.id,
                  targetLabel: `${ctx.app.key} · ${ctx.app.name}`,
                }),
            changes: { file: { from: null, to: fileName }, size: { from: null, to: size } },
          },
        );
        const [view] = await attachmentViews(tx, org, ctx.app, [row!]);
        return view!;
      });
    } catch (error) {
      await services.storage.delete(key).catch(() => {});
      throw error;
    }
  }

  async function findAttachment(tx: Transaction, applicationId: string, id: string) {
    if (!z.uuid().safeParse(id).success) throw notFound();
    const [row] = await tx
      .select()
      .from(schema.attachments)
      .where(
        and(eq(schema.attachments.id, id), eq(schema.attachments.applicationId, applicationId)),
      );
    if (!row) throw notFound();
    return row;
  }

  app.get(
    `${APP_PATH}/attachments/limits`,
    { preHandler: read },
    async (): Promise<AttachmentLimits> => ({ maxBytes }),
  );

  /** Pending upload from the new-scenario form. */
  app.post(`${APP_PATH}/attachments`, { preHandler: write }, async (req, reply) =>
    reply.code(201).send(await upload(req, null)),
  );

  app.post(
    `${SCENARIOS_PATH}/:scenarioKey/attachments`,
    { preHandler: write },
    async (req: FastifyRequest<{ Params: ScenarioParams }>, reply) => {
      const scenario = await inOrg(services, req, (tx) =>
        findScenario(tx, req.application!, req.params.scenarioKey),
      );
      assertNotDeleted(scenario);
      return reply.code(201).send(await upload(req, scenario));
    },
  );

  app.get(
    `${SCENARIOS_PATH}/:scenarioKey/attachments`,
    { preHandler: read },
    async (req: FastifyRequest<{ Params: ScenarioParams }>): Promise<Attachment[]> =>
      inOrg(services, req, async (tx) => {
        const scenario = await findScenario(tx, req.application!, req.params.scenarioKey);
        const rows = await tx
          .select()
          .from(schema.attachments)
          .where(
            and(
              eq(schema.attachments.scenarioId, scenario.id),
              isNull(schema.attachments.deletedAt),
            ),
          )
          .orderBy(asc(schema.attachments.createdAt), asc(schema.attachments.id));
        return attachmentViews(tx, req.org!, req.application!, rows);
      }),
  );

  /** Removes the file from the list; the object stays so revisions embedding it still render. */
  app.delete(
    `${SCENARIOS_PATH}/:scenarioKey/attachments/:attachmentId`,
    { preHandler: write },
    async (req: AttachmentRequest, reply) => {
      const ctx = scenarioContext(services, req);
      await inOrg(services, req, async (tx) => {
        const scenario = await findScenario(tx, ctx.app, req.params.scenarioKey);
        assertNotDeleted(scenario);
        const row = await findAttachment(tx, ctx.app.id, req.params.attachmentId);
        if (row.scenarioId !== scenario.id || row.deletedAt) throw notFound();
        await tx
          .update(schema.attachments)
          .set({ deletedAt: ctx.now, deletedBy: ctx.user.id })
          .where(eq(schema.attachments.id, row.id));
        await audit(
          tx,
          { organizationId: ctx.organizationId, actor: ctx.user },
          {
            action: 'attachment.removed',
            targetType: 'scenario',
            targetId: scenario.id,
            targetLabel: scenarioLabel(ctx.app, scenario),
            changes: { file: { from: row.fileName, to: null } },
          },
        );
      });
      return reply.code(204).send();
    },
  );

  /**
   * Streams a file after the application access check (RLS only separates organizations).
   * Removed attachments stay downloadable so old revisions keep their images.
   */
  app.get(
    `${APP_PATH}/attachments/:attachmentId`,
    { preHandler: read },
    async (req: FastifyRequest<{ Params: { attachmentId: string } }>, reply) => {
      const row = await inOrg(services, req, (tx) =>
        findAttachment(tx, req.application!.id, req.params.attachmentId),
      );
      let body;
      try {
        body = await services.storage.get(row.storageKey);
      } catch (error) {
        if (error instanceof StorageNotFoundError) throw notFound();
        throw error;
      }
      const inline = INLINE_IMAGE_TYPES.has(row.contentType);
      return reply
        .header('Content-Type', row.contentType)
        .header('Content-Length', String(row.sizeBytes))
        .header(
          'Content-Disposition',
          contentDisposition(inline ? 'inline' : 'attachment', row.fileName),
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "sandbox; default-src 'none'")
        .header('Cache-Control', 'private, max-age=31536000, immutable')
        .header('ETag', `"${row.sha256}"`)
        .send(body);
    },
  );
}
