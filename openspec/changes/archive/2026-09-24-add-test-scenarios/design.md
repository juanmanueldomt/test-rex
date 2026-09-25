## Context

Builds on `add-org-app-tenancy`: Fastify routes guarded by `createGuards()` (`guards.app`,
`guards.appPermission`, `guards.writableApp`), all tenant work inside `withOrg`/`inOrg`, the
`audit(tx, event)` helper, a no-op `QuotaService`, the generic RLS test that enumerates every
table with `organization_id`, and the SPA route `/o/:orgSlug/a/:appKey` whose `AppHomePage` is a
placeholder. Settings pages use `?tab=` with Radix Tabs; `packages/ui` has Table, Badge, Dialog
and DropdownMenu but no Tooltip/Popover. i18next (en, es) and a language switcher exist; the only
shortcut is a hand-written ⌘K listener in `shell.tsx`. There is no file storage, no rich-text
editor dependency and no per-application sequence yet. The app image runs as user `node`.

See proposal.md for motivation and `specs/` for behavior.

## Goals / Non-Goals

**Goals:**

- A scenario data model that future test cases (child rows) and test runs (pinning revisions)
  can attach to without migration of existing rows.
- One storage abstraction that test cases and executions will reuse for attachments.
- List queries that stay fast with tens of thousands of scenarios per application.

**Non-Goals:**

- Real-time collaborative editing or presence; concurrent edits are detected, not merged.
- Full-text ranking or relevance scoring; search is substring matching.
- Generic polymorphic attachments/comments across entity types (added per entity when needed).

## Decisions

### Routes: nested routes, link-based tabs

```
/o/:org/a/:app                                -> redirect to ./scenarios
/o/:org/a/:app/scenarios                      grid (search params = view state)
/o/:org/a/:app/scenarios/new                  create form
/o/:org/a/:app/scenarios/:key                 view  (?tab=details|cases|history)
/o/:org/a/:app/scenarios/:key/edit            edit form
/o/:org/a/:app/scenarios/:key/revisions/:n    read-only revision
/o/:org/a/:app/scenarios/:key/compare?from&to revision diff
/o/:org/a/:app/runs                           under construction
```

A `WorkspaceLayout` under `appRoute` renders the application header and a tab bar of `<Link>`s
(`aria-current="page"`), not Radix Tabs: Radix Tabs model in-page panels, while these tabs are
navigations with their own sub-routes and search params. The scenario page itself has a small
`?tab=` set (details, test cases, history) following the existing settings-page pattern.
Comments sit at the bottom of Details; requirement links and attachments in a side column.
Alternative: `?tab=` on the app home. Rejected: `/scenarios/new` and `/scenarios/:key` would
need to live outside the tab anyway, and each tab owns unrelated search params.

### Data model: current state on `scenarios`, snapshots in `scenario_revisions`

```
sequences          (organization_id, application_id, kind, next_value)  PK(application_id, kind)
modules            id, org, application_id, name, created_by, ..., deleted_at
                   unique (application_id, lower(name)) where deleted_at is null
tags               id, org, application_id, name        unique (application_id, name)
scenarios          id, org, application_id, number, title, status, priority, module_id,
                   version_from, version_from_parts int[4], version_to, version_to_parts int[4],
                   description_md, steps_md, search_text,
                   current_revision int, current_revision_id,
                   created_by, created_at, updated_by, updated_at, deleted_at, deleted_by
                   unique (application_id, number)
scenario_tags      (scenario_id, tag_id, org)            current tags, used for filtering
scenario_revisions id, org, scenario_id, number, <all revisioned fields>, tag_ids uuid[],
                   changed_fields text[], author_id, author_label, created_at
                   unique (scenario_id, number)
scenario_comments  id, org, scenario_id, body_md, revision_number, author_id,
                   created_at, edited_at, deleted_at, deleted_by
scenario_requirement_links id, org, scenario_id, url, label, provider, issue_key, created_by, ...
                   unique (scenario_id, url)
attachments        id, org, application_id, scenario_id NULL (NULL = pending upload),
                   storage_key, file_name, content_type, size_bytes, sha256,
                   uploaded_by, created_at, deleted_at, deleted_by
```

The scenario row holds the current values (denormalized) so the grid filters and sorts on one
indexed table; every save writes the scenario row and a revision row in the same transaction.
Revisions store full snapshots (not deltas) so any revision is readable in one query and a future
test run can pin `scenario_revisions.id` directly. `tag_ids` is an array rather than a join table
because revisions are immutable and tags are never deleted in this change; revision reads resolve
names in one `WHERE id = ANY(...)` query. `changed_fields` is computed at write time so the history
list needs no diffing. Modules are soft-deleted so old revisions still resolve their name.

Keys are not stored: `CHK-TS-<number>` is derived from the immutable application key.
Alternatives: event-sourced history (rejected: every read would replay), revisions only with the
grid joining the latest revision (rejected: slower filters, harder indexes).

### Revisions are append-only in the database

The runtime role receives no `UPDATE`/`DELETE`/`TRUNCATE` on `scenario_revisions` (same pattern as
`audit_events`). Restore inserts a new revision copying the old snapshot; tags are re-attached
by id, and a soft-deleted module is un-deleted.

### Key numbers from a `sequences` row

`INSERT INTO sequences ... ON CONFLICT (application_id, kind) DO UPDATE SET next_value =
sequences.next_value + 1 RETURNING next_value` inside the create transaction. The row lock
serializes concurrent creators per application only; a rolled-back create leaves a gap, which
is acceptable (keys must be unique and never reused, not gap-free). `kind` (`TS`, later `TC`)
makes the table reusable by test cases.

### Optimistic concurrency

Edit and restore requests carry `baseRevision`. The update runs
`WHERE id = $1 AND current_revision = $baseRevision`; zero rows → HTTP 409 `SCENARIO_CHANGED`
with the latest revision's author and time. The form keeps local state and shows the conflict
in a dialog with links to compare. Alternative: last-write-wins (rejected: silent data loss
with revisions making it look audited).

### Supported version range

`packages/contracts` exports `parseProductVersion()` (1–4 dot-separated integers) and
`compareProductVersions()`. The database stores the text as entered for display and a
zero-padded `int[4]` for comparison, so the "supported in version X" filter is
`(from_parts IS NULL OR from_parts <= $x) AND (to_parts IS NULL OR to_parts >= $x)` using native
array ordering. A `CHECK (from_parts <= to_parts)` backs the validation.
Alternative: a managed per-application release list. Rejected for now: extra screens with no
current consumer; a release entity can later map onto the same parts arrays.

### Search: normalized text column + trigram index

`search_text` = `fold(title + description + steps + link issue keys)`, where `fold` lowercases and
strips diacritics (shared helper in contracts, same one applied to the query). It is recomputed on
save and on link changes. A `pg_trgm` GIN index serves `search_text LIKE '%term%'`. When the term
looks like a key (`12`, `CHK-TS-12`) the query also matches `number` and orders that row first.
`pg_trgm` is a trusted extension, so the owner role can create it without superuser.
Alternatives: `tsvector` full-text (rejected: word stemming does not do substring/key matching and
needs a language per org); `unaccent` in an index (rejected: not immutable, needs a wrapper).

### List API and URL state

`GET /api/orgs/:org/apps/:app/scenarios?q&status&priority&module&author&tag&version&deleted&sort&page&size`
returns `{ items, total, page, size }`. Multi-value params are comma-separated; `module=none`
selects scenarios without a module; `sort` is a whitelisted column with optional `-` prefix and
always tie-breaks on `number`. Offset pagination with a `count(*)` query; a page beyond the end is
clamped server-side and the returned `page` tells the client. The web route's `validateSearch`
uses the same Zod schema from contracts, so the URL and the API accept identical parameters and
defaults are stripped from the URL. TanStack Query uses `placeholderData: keepPreviousData` to
avoid flashing while paging. Authors for the filter come from
`GET .../scenarios/authors` (distinct creators).
Alternative: cursor pagination. Rejected: the spec requires page numbers and totals; offsets are
fine at test-management volumes.

### Rich text: TipTap, stored as Markdown

TipTap 3 with StarterKit, Link, Image, Table, TaskList and Placeholder; `@tiptap/markdown` converts
to and from Markdown with HTML parsing disabled. The same editor in read-only mode renders
description, steps, revision views and comments (`MarkdownView`), so no second renderer (and no
raw HTML path) exists. Embedded images are written as `![alt](attachment:<uuid>)`; the renderer
resolves that to the download URL, so Markdown stays valid if org slugs change and remains
readable for future Playwright/LLM use. On save the API parses referenced attachment ids and
rejects ids not belonging to the scenario (or to the caller's pending uploads, which it claims).
Comments use a plain Markdown textarea with a preview tab to keep the thread light.
Alternative: storing TipTap JSON. Rejected: unreadable in diffs and to LLMs; Markdown is the
format the rest of the pipeline will consume.

### Revision diff

Field changes are shown as a two-column old/new table. Description and steps are diffed on
Markdown with `diff` (`diffLines`, then `diffWords` inside changed blocks) and rendered with `+`/`−`
gutters plus `<ins>`/`<del>` styling so meaning does not depend on color.

### Attachments and storage

New package `packages/storage`:

```
interface StorageAdapter {
  put(key, stream, { contentType, size }): Promise<void>
  get(key): Promise<Readable>
  delete(key): Promise<void>
  check(): Promise<void>        // write + read + delete a probe object; used by /readyz
}
LocalStorage(dir)                      // fs, atomic write to tmp then rename
S3Storage({ bucket, region, endpoint, forcePathStyle, credentials })  // @aws-sdk/client-s3
```

- Keys are `org/<organizationId>/attachments/<attachmentId>`; never derived from file names.
- Uploads: `@fastify/multipart` streaming with a byte limit (`ATTACHMENT_MAX_BYTES`, default
  25 MB) enforced while streaming; SHA-256 computed on the fly; type detected from magic bytes
  with `file-type` (fallback `application/octet-stream`). `QuotaService.check('storage.upload',
{ organizationId, plan, bytes })` runs before storing; usage is `SUM(size_bytes)` of the
  organization's attachments.
- Downloads are streamed by the API after the app guard, checking
  `attachment.application_id = req.application.id` (RLS alone isolates organizations, not
  applications). Headers: `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`,
  `Cache-Control: private, max-age=31536000, immutable`, and `Content-Disposition: attachment`
  for everything except PNG/JPEG/GIF/WebP. Soft-deleted attachments stay downloadable so old
  revisions render; the list endpoint hides them.
- Pending uploads (new-scenario form) have `scenario_id NULL` and are claimed on create when the
  Markdown references them and `uploaded_by` is the caller.
- Each attachment row owns exactly one storage object (`storage_key` unique), so deleting an
  object never needs a reference check.
- Worker: a scheduled system job (hourly) lists organizations and enqueues a tenant job
  `attachments.purgePending` per organization, which deletes pending rows older than 24 h and their
  objects. The worker therefore also receives storage configuration.
- Compose adds a `storage` volume at `/data/storage`; the app and worker Dockerfiles create that
  directory owned by `node` so a fresh named volume is writable.

Alternatives: presigned S3 URLs (rejected for now: local storage cannot presign, and every
download would need an access re-check anyway); storing files in Postgres (rejected: bloats
backups and the cloud database).

### Permissions

Contracts add `scenario.write` (manager, editor), `comment.write` (manager, editor, tester) and
`comment.moderate` (manager). `testcase.write` stays for the next change. Scenario, module, tag,
link and attachment writes use `[guards.app, guards.appPermission('scenario.write'),
guards.writableApp]`; comments use `comment.write`, with authorship checked in the route.

### Audit events

Actions: `scenario.created|updated|deleted|restored|revision_restored`,
`module.created|renamed|deleted`, `tag.created`, `comment.created|edited|deleted`,
`requirement_link.added|updated|removed`, `attachment.uploaded|removed`. Targets are labelled
`CHK-TS-12 · <title>`. Scalar changes record from/to; rich-text fields record
`{ from: 'r3', to: 'r4' }`. New action names get en/es labels in the audit log view.

### Keyboard shortcuts

`tinykeys` (sub-1 kB, supports sequences like `g s` and `$mod+s`) behind a small registry:
`useShortcut({ keys, description, enabled, allowInInputs })` registers into a context that the
`?` help dialog reads, so the help always lists what is active on the page. A guard ignores
single-key shortcuts when the event target is an input, textarea, select or contenteditable. The
single-key opt-out is stored in `localStorage` (`testrex-single-key-shortcuts`) and exposed in
the user menu and the help dialog. The existing ⌘K listener moves into the registry.
Grid row selection (`j`/`k`) uses a roving `aria-selected` row with `tabIndex` management.

### UI components

`packages/ui` gains `Tooltip` (Radix; opens on hover and focus, used for tag overflow and exact
times), `Popover`, `Combobox` (cmdk inside Popover; tag multi-select with create, module
single-select with create), `Pagination` and `SortableHead`. The grid uses TanStack Table in
manual (server) mode for column definitions and sort state.

### Tenant isolation

Every new table has `organization_id NOT NULL` with RLS enabled and forced and the standard
`tenant_isolation` policy, created in the same migration as the table; the existing generic
test therefore covers them automatically. Child rows reference parents in the same organization,
and a `WITH CHECK` on `organization_id` stops cross-tenant inserts. Application scoping is
enforced in routes: every query filters by `req.application.id`, and ids from requests
(module, tag, attachment, comment, link) are looked up with that filter, so an id from another
application of the same organization answers 404. Storage keys are prefixed by organization id,
and the purge job runs per organization inside `withOrg`. Integration tests cover
cross-application access for each id-bearing route.

### ARCHITECTURE.md

The domain diagram becomes
`TestScenario ─< ScenarioRevision`, `TestScenario ─< TestCase ─< TestCaseVersion`,
`TestRun ─< RunItem → TestCaseVersion (+ ScenarioRevision)`; roadmap reorders to scenarios (this
change), test cases within scenarios, execution selecting whole scenarios or individual cases,
with folders replaced by modules.

## Risks / Trade-offs

- [Markdown round-trip loses formatting (tables, task lists, nested lists)] → Round-trip unit
  tests over a fixture corpus; the editor only enables extensions that serialize losslessly.
- [Change size: many capabilities in one change] → Tasks are ordered so each group (data, API,
  grid, editor, revisions, collaboration, attachments) is mergeable behind the tab; review per
  group.
- [Single-key shortcuts conflict with screen reader or browser keys] → Ignored inside inputs,
  user opt-out (WCAG 2.1.4), and no single keys bound on non-workspace pages.
- [Trigram `LIKE` on long rich text grows index size] → Index only `search_text`, which is
  plain folded text; revisit with a dedicated search engine for the cloud edition if needed.
- [Offset pagination slows on very deep pages] → Page sizes capped at 100 and filters narrow sets;
  acceptable for expected volumes.
- [Named volume not writable by `node`] → Directory created and chowned in the image; `/readyz`
  storage check reports it clearly.
- [Revision table growth from frequent saves] → Snapshots of text up to 200 kB per save; acceptable;
  compression via TOAST is automatic. Autosave is deliberately not implemented.

## Migration Plan

Additive migrations only: `CREATE EXTENSION IF NOT EXISTS pg_trgm`, new tables with RLS and
policies, revoke of UPDATE/DELETE on `scenario_revisions`. No existing rows change. New
configuration has defaults (`STORAGE_DRIVER=local`), so upgrading instances only need the new
compose volume, which the updated `docker-compose.yml` declares. `.env.example` documents the S3
variables. Rollback: redeploy the previous image; it ignores the new tables. Attachments uploaded
meanwhile remain in the volume/bucket.
