// Images pasted into rich text are stored as `![alt](attachment:<uuid>)`; the web app resolves
// the id to a download URL and the API checks that referenced attachments belong to the scenario.

export const ATTACHMENT_SCHEME = 'attachment:';

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
// Inline links/images `](attachment:id`, autolinks `<attachment:id>` and reference definitions
// `[ref]: attachment:id`.
const REFERENCE = new RegExp(`(?:\\]\\(\\s*<?|<|\\]:\\s*<?)${ATTACHMENT_SCHEME}(${UUID})`, 'g');

/** Distinct attachment ids referenced by the Markdown, lowercase, in order of appearance. */
export function extractAttachmentIds(markdown: string): string[] {
  const ids = new Set<string>();
  for (const match of markdown.matchAll(REFERENCE)) ids.add(match[1]!.toLowerCase());
  return [...ids];
}

export function attachmentMarkdownUrl(id: string): string {
  return `${ATTACHMENT_SCHEME}${id}`;
}

/** The attachment id of an `attachment:<uuid>` URL, or null for any other URL. */
export function attachmentIdFromUrl(url: string): string | null {
  const match = new RegExp(`^${ATTACHMENT_SCHEME}(${UUID})$`).exec(url.trim());
  return match ? match[1]!.toLowerCase() : null;
}
