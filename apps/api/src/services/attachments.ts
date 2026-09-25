// Attachment rules shared by the attachment routes and scenario saves.
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { Readable } from 'node:stream';
import { extractAttachmentIds, type Attachment } from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { badRequest } from '../http/errors';
import type { ScenarioContext } from './scenarios';
import { userNames, userRef } from './scenarios';

export type AttachmentRow = typeof schema.attachments.$inferSelect;

/** Only these types are shown inline; everything else (SVG, HTML, PDF...) downloads. */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);

/** Enough bytes for magic-number detection of every type file-type knows. */
const SNIFF_BYTES = 4100;

/** Bytes stored by the current organization (RLS scope), including removed attachments. */
export async function storageUsageBytes(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${schema.attachments.sizeBytes}), 0)` })
    .from(schema.attachments);
  return Number(row?.total ?? 0);
}

function looksLikeText(head: Buffer, complete: boolean): boolean {
  if (head.length === 0 || head.includes(0)) return false;
  // A multi-byte character may be cut at the end of an incomplete head.
  const sample = complete ? head : head.subarray(0, Math.max(0, head.length - 3));
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return true;
  } catch {
    return false;
  }
}

/** Type from the content (magic bytes), never from the file name or the browser's claim. */
export async function detectContentType(head: Buffer, complete: boolean): Promise<string> {
  const detected = await fileTypeFromBuffer(head);
  if (detected) return detected.mime;
  return looksLikeText(head, complete) ? 'text/plain' : 'application/octet-stream';
}

/** Keeps the last path segment, without control characters, at most 255 characters. */
export function safeFileName(name: string | undefined): string {
  const cleaned = basename((name ?? '').replace(/\\/g, '/'))
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  return (cleaned || 'file').slice(0, 255);
}

export interface InspectedStream {
  contentType: string;
  /** The whole content, starting with the bytes read for detection. */
  body: Readable;
  /** Valid once `body` has been fully consumed. */
  result(): { size: number; sha256: string };
}

/**
 * Reads the first bytes to detect the type, then yields the full content while computing its
 * size and SHA-256, so the file is streamed to storage without being buffered.
 */
export async function inspectStream(source: Readable): Promise<InspectedStream> {
  const iterator = source[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
  const head: Buffer[] = [];
  let headLength = 0;
  let ended = false;
  while (headLength < SNIFF_BYTES) {
    const next = await iterator.next();
    if (next.done) {
      ended = true;
      break;
    }
    head.push(next.value);
    headLength += next.value.length;
  }
  const contentType = await detectContentType(Buffer.concat(head), ended);
  const hash = createHash('sha256');
  let size = 0;
  async function* all() {
    for (const chunk of head) {
      hash.update(chunk);
      size += chunk.length;
      yield chunk;
    }
    if (ended) return;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      hash.update(next.value);
      size += next.value.length;
      yield next.value;
    }
  }
  return {
    contentType,
    body: Readable.from(all()),
    result: () => ({ size, sha256: hash.digest('hex') }),
  };
}

export function attachmentUrl(org: { slug: string }, app: { key: string }, id: string): string {
  return `/api/orgs/${org.slug}/apps/${app.key}/attachments/${id}`;
}

export async function attachmentViews(
  tx: Transaction,
  org: { slug: string },
  app: { key: string },
  rows: AttachmentRow[],
): Promise<Attachment[]> {
  const names = await userNames(
    tx,
    rows.map((row) => row.uploadedBy),
  );
  return rows.map((row) => ({
    id: row.id,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    uploadedBy: userRef(names, row.uploadedBy),
    createdAt: row.createdAt.toISOString(),
    url: attachmentUrl(org, app, row.id),
  }));
}

/**
 * Checks the `attachment:<id>` references of a scenario's rich text: each must be an
 * attachment of this scenario, or a pending upload of the caller in this application, which is
 * then claimed by the scenario. Anything else (another scenario's, application's or user's
 * file) is rejected.
 */
export async function claimAttachmentReferences(
  tx: Transaction,
  ctx: ScenarioContext,
  scenarioId: string,
  markdown: string[],
): Promise<void> {
  const ids = [...new Set(markdown.flatMap(extractAttachmentIds))];
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: schema.attachments.id,
      scenarioId: schema.attachments.scenarioId,
      uploadedBy: schema.attachments.uploadedBy,
    })
    .from(schema.attachments)
    .where(
      and(inArray(schema.attachments.id, ids), eq(schema.attachments.applicationId, ctx.app.id)),
    );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const pending: string[] = [];
  const invalid = ids.filter((id) => {
    const row = byId.get(id);
    if (row?.scenarioId === scenarioId) return false;
    if (row && row.scenarioId === null && row.uploadedBy === ctx.user.id) {
      pending.push(id);
      return false;
    }
    return true;
  });
  if (invalid.length) {
    throw badRequest(
      'ATTACHMENT_NOT_ALLOWED',
      'The text embeds files that do not belong to this scenario.',
      { attachmentIds: invalid },
    );
  }
  if (pending.length) {
    await tx
      .update(schema.attachments)
      .set({ scenarioId })
      .where(and(inArray(schema.attachments.id, pending), isNull(schema.attachments.scenarioId)));
  }
}
