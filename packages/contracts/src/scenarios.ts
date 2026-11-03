// Test scenarios: identifiers, field rules, request schemas and response types shared by the
// API and the web app. Validation messages are i18n keys (see apps/web/src/locales).
import { z } from 'zod';
import { APP_KEY_PATTERN } from './identifiers';
import { parseProductVersion, compareProductVersions } from './versions';

export const SCENARIO_STATUSES = ['draft', 'ready', 'deprecated'] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

/** Ordered by severity, most severe first (also the sort order). */
export const SCENARIO_PRIORITIES = ['critical', 'high', 'medium', 'low'] as const;
export type ScenarioPriority = (typeof SCENARIO_PRIORITIES)[number];

export const SCENARIO_TITLE_MAX = 200;
export const RICH_TEXT_MAX = 100_000;
export const SCENARIO_TAGS_MAX = 20;
export const TAG_MAX = 40;
export const MODULE_NAME_MAX = 60;
export const COMMENT_MAX = 10_000;
export const LINK_LABEL_MAX = 200;
export const LINK_URL_MAX = 2_000;
export const LINKS_PER_SCENARIO_MAX = 50;
export const SCENARIO_PAGE_SIZES = [25, 50, 100] as const;

/** Fields captured by every revision. */
export const SCENARIO_REVISION_FIELDS = [
  'title',
  'status',
  'priority',
  'module',
  'tags',
  'versionFrom',
  'versionTo',
  'description',
  'stepsToReach',
] as const;
export type ScenarioField = (typeof SCENARIO_REVISION_FIELDS)[number];
export const RICH_TEXT_FIELDS: readonly ScenarioField[] = ['description', 'stepsToReach'];

// ---------------------------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------------------------

/** Lowercases and strips diacritics so "Café" matches "cafe". Applied to data and queries. */
export function foldForSearch(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}

const TAG_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

/** `  @Payments ` → `payments`. The result still has to pass {@link isValidTag}. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/^@/, '').normalize('NFC').toLowerCase();
}

/** 1–40 letters, digits, `.`, `_` or `-`, starting with a letter or digit (normalized form). */
export function isValidTag(tag: string): boolean {
  return [...tag].length <= TAG_MAX && TAG_PATTERN.test(tag);
}

export const tagSchema = z
  .string()
  .transform(normalizeTag)
  .refine((tag) => tag.length > 0, 'tag.required')
  .refine(isValidTag, 'tag.invalid');

/** Tags are shown the way Playwright writes them. */
export function formatTag(tag: string): string {
  return `@${tag}`;
}

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

export const SCENARIO_KEY_KIND = 'TS';

/** `CHK`, 12 → `CHK-TS-12`. */
export function formatScenarioKey(appKey: string, number: number): string {
  return `${appKey}-${SCENARIO_KEY_KIND}-${number}`;
}

const MAX_KEY_NUMBER = 2_147_483_647;

/**
 * Reads a scenario number from a full key (`CHK-TS-12`, any case) or the number alone (`12`).
 * When `appKey` is given, a full key must belong to that application.
 */
export function parseScenarioKey(text: string, appKey?: string): number | null {
  const value = text.trim().toUpperCase();
  let digits: string | undefined;
  if (/^\d+$/.test(value)) {
    digits = value;
  } else {
    const match = /^([A-Z][A-Z0-9]*)-TS-(\d+)$/.exec(value);
    if (!match || !APP_KEY_PATTERN.test(match[1]!)) return null;
    if (appKey && match[1] !== appKey.toUpperCase()) return null;
    digits = match[2];
  }
  const number = Number(digits);
  return Number.isSafeInteger(number) && number >= 1 && number <= MAX_KEY_NUMBER ? number : null;
}

// ---------------------------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------------------------

/** Empty strings from forms mean "no value". */
const emptyToNull = (value: unknown) =>
  value === undefined ? undefined : typeof value === 'string' && value.trim() === '' ? null : value;

export const productVersionSchema = z
  .string()
  .trim()
  .refine((text) => parseProductVersion(text) !== null, 'version.invalid');

const optionalVersion = z.preprocess(emptyToNull, productVersionSchema.nullable());

export const scenarioStatusSchema = z.enum(SCENARIO_STATUSES);
export const scenarioPrioritySchema = z.enum(SCENARIO_PRIORITIES);

const fieldSchemas = {
  title: z.string().trim().min(1, 'title.required').max(SCENARIO_TITLE_MAX, 'title.tooLong'),
  status: scenarioStatusSchema,
  priority: scenarioPrioritySchema,
  moduleId: z.uuid().nullable(),
  tags: z
    .array(tagSchema)
    .transform((tags) => [...new Set(tags)])
    .refine((tags) => tags.length <= SCENARIO_TAGS_MAX, 'tags.tooMany'),
  versionFrom: optionalVersion,
  versionTo: optionalVersion,
  description: z.string().max(RICH_TEXT_MAX, 'richText.tooLong'),
  stepsToReach: z.string().max(RICH_TEXT_MAX, 'richText.tooLong'),
};

/** Adds an issue on `versionTo` when both bounds are set and inverted. */
function checkVersionRange(
  value: { versionFrom?: string | null; versionTo?: string | null },
  ctx: z.RefinementCtx,
) {
  const { versionFrom, versionTo } = value;
  if (!versionFrom || !versionTo) return;
  if (!parseProductVersion(versionFrom) || !parseProductVersion(versionTo)) return;
  if (compareProductVersions(versionFrom, versionTo) > 0) {
    ctx.addIssue({ code: 'custom', path: ['versionTo'], message: 'version.inverted' });
  }
}

export const createScenarioSchema = z
  .object({
    title: fieldSchemas.title,
    status: fieldSchemas.status.default('draft'),
    priority: fieldSchemas.priority.default('medium'),
    moduleId: fieldSchemas.moduleId.default(null),
    tags: fieldSchemas.tags.default([]),
    versionFrom: fieldSchemas.versionFrom.default(null),
    versionTo: fieldSchemas.versionTo.default(null),
    description: fieldSchemas.description.default(''),
    stepsToReach: fieldSchemas.stepsToReach.default(''),
  })
  .superRefine(checkVersionRange);
export type CreateScenarioInput = z.infer<typeof createScenarioSchema>;

/**
 * Only the fields present change. `baseRevision` is the revision the editor started from;
 * the save is rejected when the scenario has moved on since.
 */
export const updateScenarioSchema = z
  .object({
    baseRevision: z.number().int().min(1),
    title: fieldSchemas.title.optional(),
    status: fieldSchemas.status.optional(),
    priority: fieldSchemas.priority.optional(),
    moduleId: fieldSchemas.moduleId.optional(),
    tags: fieldSchemas.tags.optional(),
    versionFrom: fieldSchemas.versionFrom.optional(),
    versionTo: fieldSchemas.versionTo.optional(),
    description: fieldSchemas.description.optional(),
    stepsToReach: fieldSchemas.stepsToReach.optional(),
  })
  .superRefine(checkVersionRange);
export type UpdateScenarioInput = z.infer<typeof updateScenarioSchema>;

/** Checks a complete set of range values (e.g. after merging an update into the current row). */
export function versionRangeError(
  versionFrom: string | null,
  versionTo: string | null,
): string | null {
  if (!versionFrom || !versionTo) return null;
  return compareProductVersions(versionFrom, versionTo) > 0 ? 'version.inverted' : null;
}

export const restoreRevisionSchema = z.object({ baseRevision: z.number().int().min(1) });

export const moduleNameSchema = z
  .string()
  .trim()
  .min(1, 'name.required')
  .max(MODULE_NAME_MAX, 'module.tooLong');
export const moduleInputSchema = z.object({ name: moduleNameSchema });

export const commentInputSchema = z.object({
  body: z.string().trim().min(1, 'comment.required').max(COMMENT_MAX, 'comment.tooLong'),
});

export const httpUrlSchema = z
  .string()
  .trim()
  .min(1, 'url.required')
  .max(LINK_URL_MAX, 'url.tooLong')
  .refine((value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
    } catch {
      return false;
    }
  }, 'url.httpOnly');

export const requirementLinkInputSchema = z.object({
  url: httpUrlSchema,
  label: z.preprocess(
    emptyToNull,
    z.string().trim().max(LINK_LABEL_MAX, 'label.tooLong').nullable().default(null),
  ),
});

// ---------------------------------------------------------------------------------------------
// List query (shared by the API and the web URL)
// ---------------------------------------------------------------------------------------------

export const SCENARIO_SORT_FIELDS = [
  'key',
  'title',
  'status',
  'priority',
  'module',
  'author',
  'updated',
] as const;
export type ScenarioSortField = (typeof SCENARIO_SORT_FIELDS)[number];
export type ScenarioSort = ScenarioSortField | `-${ScenarioSortField}`;
export const DEFAULT_SCENARIO_SORT: ScenarioSort = '-key';

const scenarioSortSchema = z.custom<ScenarioSort>(
  (value) =>
    typeof value === 'string' &&
    (SCENARIO_SORT_FIELDS as readonly string[]).includes(value.replace(/^-/, '')),
  'sort.invalid',
);

/** A comma-separated (or repeated) parameter, trimmed and without duplicates. */
function csv<T extends z.ZodType>(item: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const list = (Array.isArray(value) ? value : String(value).split(','))
      .map((entry) => String(entry).trim())
      .filter(Boolean);
    return list.length ? [...new Set(list)] : undefined;
  }, z.array(item).max(50).optional());
}

const optionalText = (max: number) =>
  z.preprocess(
    (value) =>
      value === undefined || value === null ? undefined : String(value).trim() || undefined,
    z.string().max(max).optional(),
  );

/** Query-string helpers shared by the list queries of other entities. */
export { csv as csvParam, optionalText as optionalTextParam };

export const MODULE_NONE = 'none';

export const scenarioListQuerySchema = z.object({
  q: optionalText(200),
  status: csv(scenarioStatusSchema),
  priority: csv(scenarioPrioritySchema),
  /** Module ids, or `none` for scenarios without a module. */
  module: csv(z.union([z.uuid(), z.literal(MODULE_NONE)])),
  author: csv(z.uuid()),
  /** Rows must have every listed tag. */
  tag: csv(tagSchema),
  /** Rows whose supported range contains this version. */
  version: z.preprocess(
    (value) => (value === undefined || value === null || value === '' ? undefined : String(value)),
    productVersionSchema.optional(),
  ),
  deleted: z.preprocess(
    (value) => value === true || value === 'true' || value === '1',
    z.boolean(),
  ),
  sort: scenarioSortSchema.default(DEFAULT_SCENARIO_SORT),
  page: z.coerce.number().int().min(1).default(1),
  size: z.coerce
    .number()
    .refine((size) => (SCENARIO_PAGE_SIZES as readonly number[]).includes(size), 'size.invalid')
    .default(SCENARIO_PAGE_SIZES[0]),
});
export type ScenarioListQuery = z.infer<typeof scenarioListQuerySchema>;

/** Parameters that narrow the result (as opposed to sort and paging). */
export const SCENARIO_FILTER_KEYS = [
  'q',
  'status',
  'priority',
  'module',
  'author',
  'tag',
  'version',
  'deleted',
] as const;

/**
 * Parses untrusted search parameters (e.g. a hand-edited URL), dropping invalid ones instead of
 * failing, so a bad parameter never breaks the page.
 */
export function parseScenarioListQueryLenient(raw: Record<string, unknown>): ScenarioListQuery {
  let input = { ...raw };
  for (let attempt = 0; attempt < SCENARIO_FILTER_KEYS.length + 3; attempt++) {
    const result = scenarioListQuerySchema.safeParse(input);
    if (result.success) return result.data;
    const bad = new Set(result.error.issues.map((issue) => String(issue.path[0])));
    input = Object.fromEntries(Object.entries(input).filter(([key]) => !bad.has(key)));
  }
  return scenarioListQuerySchema.parse({});
}

/**
 * Canonical compact form: defaults omitted, multi-values sorted and comma-joined. Equivalent
 * queries produce identical objects (used for URLs, API requests and cache keys).
 */
export function compactScenarioListQuery(
  query: Partial<ScenarioListQuery>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (query.q) out.q = query.q;
  for (const key of ['status', 'priority', 'module', 'author', 'tag'] as const) {
    const values = query[key];
    if (values && values.length) out[key] = [...values].sort().join(',');
  }
  if (query.version) out.version = query.version;
  if (query.deleted) out.deleted = true;
  if (query.sort && query.sort !== DEFAULT_SCENARIO_SORT) out.sort = query.sort;
  if (query.page && query.page !== 1) out.page = query.page;
  if (query.size && query.size !== SCENARIO_PAGE_SIZES[0]) out.size = query.size;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Query string for the list endpoint. */
export function scenarioListQueryString(query: Partial<ScenarioListQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(compactScenarioListQuery(query))) {
    params.set(key, String(value));
  }
  return params.toString();
}

// ---------------------------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------------------------

export interface UserRef {
  id: string | null;
  name: string;
}

export interface ModuleRef {
  id: string;
  name: string;
}

export interface ScenarioModule extends ModuleRef {
  scenarioCount: number;
  createdAt: string;
}

export interface ScenarioTagSuggestion {
  name: string;
  scenarioCount: number;
}

export interface ScenarioListItem {
  id: string;
  key: string;
  number: number;
  title: string;
  status: ScenarioStatus;
  priority: ScenarioPriority;
  module: ModuleRef | null;
  /** Alphabetical. */
  tags: string[];
  testCaseCount: number;
  author: UserRef;
  createdAt: string;
  updatedBy: UserRef;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ScenarioListPage {
  items: ScenarioListItem[];
  total: number;
  /** The page actually returned (clamped to the last page). */
  page: number;
  size: number;
}

export interface Scenario extends ScenarioListItem {
  versionFrom: string | null;
  versionTo: string | null;
  description: string;
  stepsToReach: string;
  /** Current revision number (r1, r2, ...). */
  revision: number;
  revisionId: string;
  deletedBy: UserRef | null;
  /** Requirement links, comments and non-deleted attachments. */
  counts: { comments: number; links: number; attachments: number };
}

export type FieldChange = { from: unknown; to: unknown };

export interface ScenarioRevisionSummary {
  id: string;
  number: number;
  author: UserRef;
  createdAt: string;
  changedFields: ScenarioField[];
  /** Old and new values of changed scalar fields (rich text is only listed as changed). */
  changes: Partial<Record<ScenarioField, FieldChange>>;
  /** Set when this revision restored an earlier one. */
  restoredFrom: number | null;
}

export interface ScenarioRevision {
  id: string;
  number: number;
  scenarioKey: string;
  /** The scenario's current revision number. */
  latest: number;
  title: string;
  status: ScenarioStatus;
  priority: ScenarioPriority;
  module: ModuleRef | null;
  tags: string[];
  versionFrom: string | null;
  versionTo: string | null;
  description: string;
  stepsToReach: string;
  author: UserRef;
  createdAt: string;
  changedFields: ScenarioField[];
  restoredFrom: number | null;
}

/** Extra fields of the 409 `SCENARIO_CHANGED` error. */
export interface ScenarioConflictDetails {
  latestRevision: number;
  changedBy: string;
  changedAt: string;
}

export interface ScenarioComment {
  id: string;
  body: string;
  /** Scenario revision that was current when the comment was written. */
  revision: number;
  author: UserRef;
  createdAt: string;
  editedAt: string | null;
}

export type RequirementProvider = 'jira' | 'github' | 'azure_devops' | 'other';

export interface RequirementLink {
  id: string;
  url: string;
  label: string | null;
  provider: RequirementProvider;
  issueKey: string | null;
  createdBy: UserRef;
  createdAt: string;
}

export interface Attachment {
  id: string;
  fileName: string;
  /** Detected from the file content. */
  contentType: string;
  sizeBytes: number;
  uploadedBy: UserRef;
  createdAt: string;
  /** Download URL (same origin, requires a session). */
  url: string;
}

export interface AttachmentLimits {
  maxBytes: number;
}
