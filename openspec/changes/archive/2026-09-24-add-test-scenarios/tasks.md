## 1. Contracts

- [x] 1.1 Add `scenario.write`, `comment.write` and `comment.moderate` permissions to the role map; verify the table-driven permission tests cover every role × new permission
- [x] 1.2 Add `parseProductVersion`, `compareProductVersions` and padded-parts helpers; verify unit tests for valid forms (`3`, `3.2.1`, `3.10` > `3.9`), invalid forms (`v3`, `3.x`, 5 parts) and missing parts as 0
- [x] 1.3 Add tag normalization/validation, `foldForSearch` (lowercase, strip diacritics) and scenario key format/parse (`CHK-TS-12`, bare `12`); verify unit tests including `@Payments` → `payments` and `smoke test` rejected
- [x] 1.4 Add Zod schemas for scenario create/update (with `baseRevision`), list query (shared by API and web URL), module, comment, requirement link and response types; verify schema tests for defaults, limits and comma-separated multi-values
- [x] 1.5 Add requirement-link recognition (Jira, GitHub issue/PR, Azure DevOps, other) returning provider and issue key, and http(s)-only URL validation; verify unit tests for each provider, unknown host and `javascript:` rejection
- [x] 1.6 Add a Markdown attachment-reference helper (`attachment:<uuid>` extraction); verify unit tests for images in headings, lists and tables and ignoring non-attachment URLs

## 2. Database

- [x] 2.1 Add Drizzle schema and migration for `sequences`, `modules`, `tags`, `scenarios`, `scenario_tags` with indexes (unique number, lower(name) partial unique, version-parts check) and `pg_trgm` GIN index on `search_text`; verify `pnpm db:generate` and migrations apply on a clean database
- [x] 2.2 Add schema and migration for `scenario_revisions`, `scenario_comments`, `scenario_requirement_links`, `attachments`; verify migration applies and foreign keys/uniques exist
- [x] 2.3 Add RLS (enable, force, `tenant_isolation`) for every new table and revoke UPDATE/DELETE/TRUNCATE on `scenario_revisions` from `testrex_app`; verify the generic RLS test covers the new tables and an integration test that updating a revision as the runtime role fails
- [x] 2.4 Implement `nextSequenceValue(tx, applicationId, kind)`; verify an integration test with parallel transactions yields distinct numbers and that a deleted scenario's number is not reused

## 3. Scenario API — authoring

- [x] 3.1 Implement `POST /scenarios` (key allocation, tag auto-create, module check, version range, search_text, revision r1, audit); verify integration tests for spec scenarios "Create a scenario", "Title required", "Automatic creation", "Reuse existing tag", "Inverted range"
- [x] 3.2 Implement `GET /scenarios/:key` returning current state, current revision, tags, module, author/editor names and permissions-relevant flags; verify tests for viewer read, deleted scenario flag and 404 for another org and another application
- [x] 3.3 Implement `PATCH /scenarios/:key` with `baseRevision` conflict check (409 with latest author/time), changed-field detection, no-op without revision, audit with rich text as revision numbers; verify tests "Edit and save", "Conflicting edit", "No-op save", "Status change audited"
- [x] 3.4 Implement soft delete and restore with audit; verify tests "Delete", "Restore", key not reused after delete, and deleted scenario readable by URL
- [x] 3.5 Enforce permissions on all scenario writes (`scenario.write` + writable app); verify tests tester 403, viewer 403, archived application 409
- [x] 3.6 Implement module endpoints (list, create, rename, delete-if-unused, soft delete) and tag endpoints (list/suggest by prefix); verify tests "Create module inline", "Duplicate module name", "Module in use", "Tags are per application"

## 4. Scenario API — catalog

- [x] 4.1 Implement `GET /scenarios` list with filters (status, priority, module incl. `none`, author, tags AND, version range, deleted) and totals; verify integration tests for each filter spec scenario including "Filter by supported version"
- [x] 4.2 Add search (folded substring on `search_text`, key/number match ranked first, requirement issue keys) and whitelisted sorting with numeric key and severity-ordered priority plus pagination clamping; verify tests "Search by title word", "Search by key number", "Search by requirement", "Sort by updated", page beyond end returns last page
- [x] 4.3 Implement `GET /scenarios/authors` and test case count (constant 0 until test cases exist) in list items; verify test that authors are distinct creators of the application only

## 5. Revisions API

- [x] 5.1 Implement history list (number, author, time, changed fields) and `GET /scenarios/:key/revisions/:n` resolving tag and module names (including soft-deleted modules); verify tests "History list", "Unknown revision", "Content preserved after deletion"
- [x] 5.2 Implement restore (`POST .../revisions/:n/restore` with `baseRevision`), re-attaching tags and un-deleting modules, audited as `scenario.revision_restored`; verify tests "Restore r2" and "Viewer cannot restore"

## 6. Collaboration API

- [x] 6.1 Implement comments list/create/edit/delete with author checks, manager moderation, revision number stamping, audit; verify tests "Tester comments", "Cannot edit others' comments", "Manager moderation", viewer 403 on create
- [x] 6.2 Implement requirement links add/edit/remove with provider detection, duplicate and 50-link limit, search_text refresh, audit; verify tests "Add a link", "Reject unsafe scheme", "Duplicate link", and search by linked key after adding

## 7. Storage and attachments

- [x] 7.1 Create `packages/storage` with `StorageAdapter`, `LocalStorage` (tmp+rename) and `check()`; verify unit tests for put/get/delete/check against a temp dir
- [x] 7.2 Add `S3Storage` (endpoint, path-style, credentials); verify integration test against MinIO (testcontainers or CI service) for put/get/delete and a failing `check()` with a wrong bucket
- [x] 7.3 Add storage config (`STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` with secrets redacted, `ATTACHMENT_MAX_BYTES`) to API and worker env, `.env.example`, and a `storage` check in `/readyz`; verify config tests and the env-example test, and readiness 503 with an unwritable dir
- [x] 7.4 Extend `QuotaService` with `storage.upload` (bytes, usage sum); verify unit test that the no-op allows it and usage is computed per organization
- [x] 7.5 Implement multipart upload (`@fastify/multipart`, streaming size limit, SHA-256, `file-type` sniffing, pending uploads with `scenario_id NULL`), list and remove endpoints with audit; verify tests "Upload", "File too large", editor-only upload, pending upload claimed on scenario create and rejected for another user's pending id
- [x] 7.6 Implement streamed download with app-scoped lookup and safe headers (inline only for PNG/JPEG/GIF/WebP, nosniff, CSP sandbox, immutable caching), serving soft-deleted attachments; verify tests "HTML file", "Other organization", cross-application 404, removed image still downloadable
- [x] 7.7 Validate attachment references on scenario save (must belong to scenario or be caller's pending uploads); verify test that a foreign attachment id in Markdown is rejected
- [x] 7.8 Add worker scheduled system job fanning out per-organization `attachments.purgePending` tenant jobs (delete pending rows older than 24 h and their objects); verify worker integration test that an old pending upload is removed while a recent one and a claimed one remain
- [x] 7.9 Add `/data/storage` owned by `node` to app and worker Dockerfiles and the `storage` volume to `docker-compose.yml`; verify `docker compose up`, upload, recreate the app container and download the same file

## 8. Web foundation

- [x] 8.1 Add `Tooltip`, `Popover`, `Combobox`, `Pagination` and `SortableHead` to `packages/ui`; verify component tests for keyboard open/close and axe checks in light and dark mode
- [x] 8.2 Add shortcut registry on `tinykeys` (input guard, sequences, single-key opt-out in localStorage), `?` help dialog, and move ⌘K into it; verify unit tests for the input guard and opt-out and e2e "Help dialog" and "Disable single-key shortcuts"
- [x] 8.3 Add scenario query/mutation hooks and query keys in `lib/queries.ts`; verify typecheck and a unit test for list query key stability across equivalent search params
- [x] 8.4 Add en/es locale keys for all new UI and audit action labels; verify the locale parity test (same keys in en and es) passes

## 9. Web workspace and grid

- [x] 9.1 Add `WorkspaceLayout` with link tabs, `/a/:app` → `/scenarios` redirect, scenario count, and the Test runs under-construction page; verify e2e "Default tab", "Switch tabs", "Open test runs"
- [x] 9.2 Build the scenario grid with TanStack Table (manual mode), columns, row open by click/Enter, `j`/`k` selection, loading/empty/no-match states; verify e2e "Grid columns", "Open a scenario", "No matches", "New scenario button hidden"
- [x] 9.3 Add tag cell with two chips, `+N` Tooltip listing up to five hidden tags and "and M more", tag chip click filtering; verify component test for 5 and 9 tags and e2e keyboard focus opening the tooltip
- [x] 9.4 Add search box, filter bar (status, module, priority, author, tags, version, show deleted) with removable chips and clear all, sortable headers and pagination, all bound to URL search params via the shared schema; verify e2e "Shared view", "Back button", "Filter resets page"

## 10. Web scenario authoring

- [x] 10.1 Add TipTap editor (StarterKit, Link, Image, Table, TaskList, Placeholder) with Markdown load/save and read-only `MarkdownView`; verify round-trip unit tests over a fixture of headings, nested lists, task lists, tables, code and images, and that raw HTML is not rendered
- [x] 10.2 Build the create/edit form (title, status, priority, module combobox with create, tag combobox with create, version from/up to, description, steps to reach), field validation messages, `Ctrl+S`, unsaved-changes guard; verify e2e "Create a scenario", "Steps to reach with sections", "Unsaved changes", "Invalid version text"
- [x] 10.3 Handle 409 conflicts with a dialog naming the other editor, keeping input and linking to compare; verify e2e "Conflicting edit" with two browser contexts
- [x] 10.4 Build the scenario page (header with key and revision, Details / Test cases (0) / History tabs, side column), edit/delete/restore actions, deleted banner, and hidden actions per permission; verify e2e "Delete", "Restore", "Viewer can read", "Test cases placeholder"

## 11. Web revisions and collaboration

- [x] 11.1 Build the History tab, read-only revision page with "viewing rN of M" banner, and restore action; verify e2e "Open old revision" and "Restore r2"
- [x] 11.2 Build the compare page (field table and Markdown line/word diff with +/− markers and ins/del styles); verify component test that markers exist independent of color and e2e "Compare r2 and r4"
- [x] 11.3 Build the comment thread (Markdown textarea with preview, "on rN", edited marker, edit/delete own, manager delete); verify e2e "Tester comments", "Viewer cannot comment", "Unsafe content"
- [x] 11.4 Build the requirement links panel (add/edit/remove, provider label and key, new tab with `noopener noreferrer`); verify e2e "Jira link" and "Unknown tracker"

## 12. Web attachments

- [x] 12.1 Build the attachments panel (picker, drag and drop, progress, size-limit error, list, download, remove with confirmation); verify e2e "Upload", "File too large", "Viewer downloads"
- [x] 12.2 Add image paste/drop in the editors uploading to the scenario or as pending uploads on the new form and inserting `attachment:` images; verify e2e "Paste screenshot while editing", "Paste before first save", "Remove embedded image"

## 13. Documentation and end-to-end checks

- [x] 13.1 Update `docs/ARCHITECTURE.md` domain diagram (scenario owns test cases, revisions, runs select test cases) and roadmap order; verify the doc renders and matches design.md
- [x] 13.2 Document storage configuration (local volume, S3/MinIO example) in README/deploy docs; verify `.env.example` lists every new variable
- [x] 13.3 Run axe on the workspace, grid, form, scenario, revision, compare and runs pages in light and dark mode; verify no serious or critical violations in CI
- [x] 13.4 Add the Spanish-interface e2e (switch language, open grid and scenario); verify spec scenario "Spanish interface" passes
- [x] 13.5 Run the full test suite (`pnpm test`, integration, e2e) and `openspec validate add-test-scenarios --strict`; verify all pass
