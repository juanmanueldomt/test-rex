import {
  JOB_QUEUES,
  RECORDING_IDLE_MS,
  recordingCommandSchema,
  startRecordingSchema,
  type RecordingJobPayload,
  type RecordingSession,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { conflict, forbidden, notFound, parse } from '../http/errors';
import { inOrg, type Guards, type RequestApp } from '../http/guards';
import { automationSettingsOf } from '../services/automation';
import type { ApiServices } from '../services/index';
import { userNames, userRef } from '../services/scenarios';

const RECORDINGS_PATH = '/api/orgs/:orgSlug/apps/:appKey/recordings';
type SessionRow = typeof schema.recordingSessions.$inferSelect;
type SessionRequest = FastifyRequest<{ Params: { id: string } }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIVE = ['starting', 'active'] as const;
/** A session whose worker stopped answering is reported as expired after this long. */
const STALE_MS = RECORDING_IDLE_MS + 60_000;

async function findSession(tx: Transaction, app: RequestApp, id: string): Promise<SessionRow> {
  if (!UUID.test(id)) throw notFound();
  const [row] = await tx
    .select()
    .from(schema.recordingSessions)
    .where(
      and(eq(schema.recordingSessions.id, id), eq(schema.recordingSessions.applicationId, app.id)),
    );
  if (!row) throw notFound();
  return row;
}

async function sessionView(
  tx: Transaction,
  row: SessionRow,
  userId: string,
): Promise<RecordingSession> {
  const names = await userNames(tx, [row.createdBy]);
  const [pending] = await tx
    .select({ n: count() })
    .from(schema.recordingCommands)
    .where(eq(schema.recordingCommands.sessionId, row.id));
  return {
    id: row.id,
    status: row.status,
    startUrl: row.startUrl,
    url: row.currentUrl,
    title: row.pageTitle,
    steps: row.steps,
    frameVersion: row.frameVersion,
    viewport: { width: row.viewportWidth, height: row.viewportHeight },
    element: row.element ?? null,
    error: row.error,
    createdBy: userRef(names, row.createdBy),
    canDrive: row.createdBy === userId && (LIVE as readonly string[]).includes(row.status),
    pendingCommands: pending?.n ?? 0,
    createdAt: row.createdAt.toISOString(),
    lastActivityAt: row.lastActivityAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
  };
}

export async function recordingRoutes(
  app: FastifyInstance,
  services: ApiServices,
  guards: Guards,
): Promise<void> {
  const read = [guards.app];
  const write = [guards.app, guards.appPermission('testcase.write'), guards.writableApp];

  /** Marks sessions whose worker went away as expired, so the page does not wait forever. */
  async function expireIfStale(tx: Transaction, row: SessionRow): Promise<SessionRow> {
    const now = services.now();
    if (!(LIVE as readonly string[]).includes(row.status)) return row;
    if (now.getTime() - row.lastActivityAt.getTime() < STALE_MS) return row;
    const [updated] = await tx
      .update(schema.recordingSessions)
      .set({
        status: 'expired',
        endedAt: now,
        error:
          row.status === 'starting'
            ? 'The recorder did not start. Is the worker running?'
            : row.error,
      })
      .where(eq(schema.recordingSessions.id, row.id))
      .returning();
    return updated!;
  }

  app.post(RECORDINGS_PATH, { preHandler: write }, async (req, reply) => {
    const input = parse(startRecordingSchema, req.body);
    const application = req.application!;
    const session = await inOrg(services, req, async (tx) => {
      const settings = await automationSettingsOf(tx, application.id);
      const [row] = await tx
        .insert(schema.recordingSessions)
        .values({
          organizationId: req.org!.id,
          applicationId: application.id,
          createdBy: req.user!.id,
          startUrl: input.startUrl,
          viewportWidth: settings.viewportWidth,
          viewportHeight: settings.viewportHeight,
          createdAt: services.now(),
          lastActivityAt: services.now(),
        })
        .returning();
      return row!;
    });
    await services.jobs.send(JOB_QUEUES.recordingSession, {
      organizationId: req.org!.id,
      sessionId: session.id,
    } satisfies RecordingJobPayload);
    const view = await inOrg(services, req, (tx) => sessionView(tx, session, req.user!.id));
    return reply.code(201).send(view);
  });

  app.get(`${RECORDINGS_PATH}/:id`, { preHandler: read }, async (req: SessionRequest) =>
    inOrg(services, req, async (tx) => {
      const row = await expireIfStale(tx, await findSession(tx, req.application!, req.params.id));
      return sessionView(tx, row, req.user!.id);
    }),
  );

  /** The latest screenshot of the recorded page. */
  app.get(
    `${RECORDINGS_PATH}/:id/frame`,
    { preHandler: read },
    async (req: SessionRequest, reply) => {
      const row = await inOrg(services, req, (tx) =>
        findSession(tx, req.application!, req.params.id),
      );
      if (!row.frame) throw notFound();
      return reply
        .header('content-type', 'image/jpeg')
        .header('cache-control', 'private, no-store')
        .header('x-content-type-options', 'nosniff')
        .send(row.frame);
    },
  );

  /** Input for the worker; only the person who started the session may drive it. */
  app.post(
    `${RECORDINGS_PATH}/:id/commands`,
    { preHandler: write },
    async (req: SessionRequest, reply) => {
      const command = parse(recordingCommandSchema, req.body);
      const pending = await inOrg(services, req, async (tx) => {
        const row = await expireIfStale(tx, await findSession(tx, req.application!, req.params.id));
        if (row.createdBy !== req.user!.id) {
          throw forbidden(
            'RECORDING_NOT_OWNER',
            'Only the person who started this recording can use it.',
          );
        }
        if (!(LIVE as readonly string[]).includes(row.status)) {
          throw conflict('RECORDING_ENDED', 'This recording has ended.');
        }
        await tx.insert(schema.recordingCommands).values({
          organizationId: req.org!.id,
          sessionId: row.id,
          payload: command,
          createdAt: services.now(),
        });
        await tx
          .update(schema.recordingSessions)
          .set({ lastActivityAt: services.now() })
          .where(eq(schema.recordingSessions.id, row.id));
        const [queued] = await tx
          .select({ n: count() })
          .from(schema.recordingCommands)
          .where(eq(schema.recordingCommands.sessionId, row.id));
        return queued?.n ?? 0;
      });
      return reply.code(202).send({ pendingCommands: pending });
    },
  );

  /** Ends a session the worker never picked up, or asks the worker to stop. */
  app.post(`${RECORDINGS_PATH}/:id/stop`, { preHandler: write }, async (req: SessionRequest) =>
    inOrg(services, req, async (tx) => {
      const row = await findSession(tx, req.application!, req.params.id);
      if (row.createdBy !== req.user!.id) {
        throw forbidden(
          'RECORDING_NOT_OWNER',
          'Only the person who started this recording can use it.',
        );
      }
      if (row.status === 'starting') {
        const [stopped] = await tx
          .update(schema.recordingSessions)
          .set({ status: 'stopped', endedAt: services.now() })
          .where(
            and(
              eq(schema.recordingSessions.id, row.id),
              inArray(schema.recordingSessions.status, ['starting']),
            ),
          )
          .returning();
        if (stopped) return sessionView(tx, stopped, req.user!.id);
      }
      if (row.status === 'active') {
        await tx.insert(schema.recordingCommands).values({
          organizationId: req.org!.id,
          sessionId: row.id,
          payload: { type: 'stop' },
          createdAt: services.now(),
        });
      }
      return sessionView(tx, await findSession(tx, req.application!, row.id), req.user!.id);
    }),
  );
}
