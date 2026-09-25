## Why

An application's home page is still a "coming soon" placeholder, so testRex cannot hold any
test design yet. Test scenarios are the unit people browse, discuss and later run: each one
is the testRex counterpart of a Playwright `spec.ts` file and owns its test cases. Building
them first, with revisions, comments, requirement links and attachments, gives test cases
(next change) and test runs (later) a stable, versioned parent to attach to.

## What Changes

- Application home becomes a workspace with two tabs: **Test scenarios** and **Test runs**
  (the latter shown as "under construction"). Tabs are real routes
  (`/o/:org/a/:app/scenarios`, `/o/:org/a/:app/runs`); `/o/:org/a/:app` redirects to scenarios.
- Scenario grid: key (`CHK-TS-12`), title, status, module, priority, tags, test case count,
  author and last update. Search, filters (status, module, tag, author, priority), sorting
  and page size are kept in the URL; pagination is server-side with page numbers and total.
  Rows with many tags show two chips and a `+N` badge; hovering or focusing it lists up to
  five more tags.
- Full-page create and edit form: title, status, module, priority, tags, supported product
  version range (**from** / **up to**), a rich-text **description** and a rich-text
  **steps to reach** section (preconditions, multiple headed sections). Rich text is stored
  as Markdown.
- Tags are per application and created automatically when first typed; modules are a flat
  per-application list with inline creation.
- Every save creates an immutable **revision** (r1, r2, ...). A history tab lists revisions
  with author, time and changed fields, shows any revision read-only, diffs two revisions
  and restores an old one (restore creates a new revision).
- Comments on scenarios (Markdown, authors can edit and delete their own).
- Requirement links (URL + optional label); Jira, GitHub and Azure DevOps URLs are
  recognized and shown with their issue key.
- Attachments on scenarios, including images pasted or dropped into the rich-text editors,
  backed by a new storage adapter (local directory or S3-compatible bucket).
- Soft delete (with restore) of scenarios; every mutation writes an audit event.
- Keyboard shortcuts with a registry and a `?` help dialog (new scenario, search, save,
  next/previous row, open row, switch tabs).
- All new UI text in English and Spanish.
- New permission `scenario.write` (manager, editor), and `comment.write` (manager, editor,
  tester) for comments.
- `docs/ARCHITECTURE.md`: domain and roadmap updated so a test case belongs to exactly one
  scenario and test runs select test cases (all or some of a scenario's cases).

## Capabilities

### New Capabilities

- `application-workspace`: application home tabs, the test runs placeholder, keyboard
  shortcut registry and help dialog.
- `test-scenarios`: scenario data and authoring — keys, fields, statuses, modules, tags,
  supported version range, rich-text sections, soft delete, permissions, audit, and
  scenario ownership of test cases.
- `scenario-catalog`: the scenario grid — search, filters, sorting, server-side pagination,
  URL state and tag overflow display.
- `scenario-revisions`: append-only revisions, history list, revision view, diff and restore.
- `scenario-collaboration`: comments and requirement links on scenarios.
- `attachments`: file storage adapter, upload/download rules, limits, and images embedded in
  rich text.

### Modified Capabilities

<!-- none: the role table in `access-control` (add-org-app-tenancy) already grants
     "create/edit test cases & scenarios" to manager and editor; this change only names the
     permission. -->

## Impact

- **Database**: `pg_trgm` extension; new tenant tables `sequences`, `modules`, `tags`,
  `scenarios`, `scenario_tags`, `scenario_revisions` (append-only), `scenario_comments`,
  `scenario_requirement_links`, `attachments`; all with `organization_id` and RLS. No
  `test_cases` table yet; the test case count reads zero until the next change.
- **Worker**: hourly purge of unclaimed uploads (per organization).
- **API**: routes under `/api/orgs/:org/apps/:app/{scenarios,tags,modules,attachments}`;
  multipart uploads via `@fastify/multipart`; streamed downloads through the API.
- **Contracts**: scenario, revision, comment, link, attachment schemas; `scenario.write` and
  `comment.write` permissions; product version parsing and comparison helpers.
- **Config**: `STORAGE_DRIVER` (`local` | `s3`), `STORAGE_DIR`, `S3_*` settings,
  `ATTACHMENT_MAX_BYTES`; compose gains a `storage` volume.
- **Web**: new routes and pages, TipTap editor with Markdown serialization, tag/module
  comboboxes, Tooltip/Popover primitives in `packages/ui`, a diff viewer, shortcut registry.
- **Dependencies**: `@tiptap/*` (+ `@tiptap/markdown`), `diff`, `tinykeys` (web);
  `@fastify/multipart`, `file-type` (api); `@aws-sdk/client-s3` (new `packages/storage`).
- **Cloud edition**: attachments never touch local disk when `STORAGE_DRIVER=s3`, so app
  containers stay stateless; object keys are prefixed by organization id; upload size and
  storage usage go through `QuotaService` (no-op self-hosted) so per-plan limits can be
  added without schema changes. All new tables are isolated by RLS.

## Non-goals

- Creating, editing or running test cases (next change); the scenario only shows a
  "Test cases (0)" placeholder tab.
- Test runs, cycles and executions beyond the "under construction" tab.
- Playwright file generation or sync, and LLM generation.
- Cloning scenarios.
- Nested modules, per-organization tags, tag colors, saved views and bulk edits.
- Mentions and notifications in comments; fetching titles or status from Jira/GitHub/ADO.
- Virus scanning, image thumbnails and previews of non-image attachments.
- Translating scenario content; only the interface is localized (en, es).
