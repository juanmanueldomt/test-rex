## Context

Builds on `add-test-scenarios`: scenario rows with append-only revisions, per-application
`sequences` (kind `TS`, with `TC` anticipated), `withOrg`/`inOrg` scopes with RLS on every
tenant table, `audit(tx, …)`, the storage adapter (local or S3) shared by API and worker,
`QuotaService`, the shortcut registry and link tabs in `WorkspaceLayout`. The worker runs
pg-boss on the official Playwright image (1.63) but has no Playwright code yet, and the API
has no job producer. `docs/ARCHITECTURE.md` still says a test case belongs to exactly one
scenario; this change makes the link many-to-many as requested.

See proposal.md for motivation and `specs/` for behavior.

## Goals / Non-Goals

**Goals:**

- One step model used everywhere: authoring, manual execution, the Playwright engine, code
  generation, the recorder, codegen import and the LLM.
- Runs that are reproducible (pinned versions and snapshots) and observable while running.
- No long database transactions while browsers run; no cross-tenant work in jobs.
- AI as a reviewed proposal, never a silent write; provider-neutral, BYOK.

**Non-Goals:**

- Executing user-provided JavaScript; distributed or parallel execution of one run.
- A visual diff of versions, comments/attachments on test cases, scheduled runs.

## Decisions

### Step model (contracts)

```
Step { id, action, target?: Locator, value?: string, description?: string, expected?: string }
Locator { strategy: role|text|label|placeholder|altText|title|testId|css,
          value, name?, exact?, nth? }
actions:    goto click dblclick fill press select check uncheck hover wait manual
assertions: expectVisible expectHidden expectText expectExactText expectValue expectChecked
            expectEnabled expectDisabled expectCount expectUrl expectTitle
```

Per-action rules (target required/forbidden, value required, numeric for `wait` and
`expectCount`) live in one table in `packages/contracts/src/steps.ts`; the Zod schema enforces
them, and `describeStep()` renders the readable text used by the UI, generated code comments
and JUnit. Assertions are the `expect*` actions; "expected result" is the free-text `expected`
of any step. Both are rendered by one `StepsView` component with the emphasized treatment
(primary border, check icon, "Expected" label), so manual runner, report and editor agree.

Alternative: storing Playwright code per test case. Rejected: arbitrary code in a multi-tenant
worker is remote code execution, cannot be reported per step and is hard for testers to read.
Code is generated from steps instead (`codegen.ts`), so the "Code" tab is always in sync.

### Data model

```
test_cases           id, org, application_id, number, title, status, priority,
                     execution_mode, description_md, preconditions_md, steps jsonb,
                     dataset_id?, search_text, current_version, current_version_id,
                     created_by/at, updated_by/at, deleted_at/by        unique(app, number)
test_case_scenarios  (test_case_id, scenario_id) + org                 current links
test_case_tags       (test_case_id, tag_id) + org                      reuses `tags`
test_case_versions   id, org, test_case_id, number, full snapshot (incl. steps, scenario_ids,
                     tag_ids, dataset_id), changed_fields, source, author_id/label, created_at
datasets             id, org, application_id, name, description, columns text[], rows jsonb,
                     created/updated/deleted                            unique lower(name) live
automation_settings  application_id PK, org, base_url, browser, viewport, timeouts,
                     trace_on_failure, video_on_failure, updated_by/at
global_steps         id, org, application_id, phase, name, enabled, position, steps jsonb
test_runs            id, org, application_id, number, title, status, base_url, browser,
                     settings jsonb, hooks jsonb, hook_results jsonb, counts…, created_by,
                     created_at, started_at, finished_at, cancelled_by
test_run_items       id, org, run_id, test_case_id, test_case_version_id, position,
                     execution_mode, title, scenario_ids, steps jsonb, dataset jsonb, status,
                     iterations jsonb, error, duration_ms, started/finished_at, executed_by
run_artifacts        id, org, application_id, run_id, item_id, iteration, kind, storage_key,
                     content_type, size_bytes
recording_sessions   id, org, application_id, created_by, status, start_url, current_url,
                     title, steps jsonb, frame bytea, frame_version, element jsonb, error,
                     timestamps
recording_commands   id bigserial, org, session_id, payload jsonb
llm_settings         organization_id PK, provider, model, base_url, api_key_encrypted,
                     updated_by/at
```

Test cases follow the scenario pattern (denormalized current row + full snapshots) so the
catalog filters on one table and runs pin `test_case_versions.id`. Run items additionally copy
the pinned steps and dataset rows: reports then need no joins into mutable tables and the
worker reads one row per item. `steps` is `jsonb` validated by the shared Zod schema on write.
`test_case_versions` is append-only like `scenario_revisions` (runtime role has no UPDATE or
DELETE). Counters use `sequences` kinds `TC` and `TR`.

### Scenario links

`test_case_scenarios` replaces "owned by one scenario". The API validates 1–20 scenario ids of
the same application (deleted scenarios may stay linked, new links must be live). Scenario
`testCaseCount` becomes a subquery over live linked test cases; the grid and page use it.

### Runs: creation and snapshots

`POST /runs` resolves the selection inside one transaction: live non-deprecated test cases of
the selected scenarios plus explicitly selected live test cases, filtered by mode, deduplicated
and ordered by first selected scenario then key. For each it inserts an item copying the
current version's steps, mode, title, scenario ids and dataset rows (an empty dataset yields a
`blocked` item). The run stores the automation settings with overrides and the enabled global
steps by phase. Runs with automated items start `queued` and a `runs.execute` job is sent;
manual-only runs start `running`.

### Job queue from the API

The API gets a `JobQueue` service backed by pg-boss (`supervise: false`, `schedule: false`,
connected with `DATABASE_MIGRATION_URL` like the worker), created lazily on first use; it
creates the queue before sending. Queue names and payloads are in contracts. Integration tests
inject an in-memory queue. Alternative: a polling table read by the worker. Rejected: a global
table would bypass RLS or need security-definer functions, and pg-boss already provides
expiry, retries and visibility.

### Worker: tenant tasks without long transactions

`registerTenantJob` runs a whole job in one transaction, which is wrong for minutes of browser
work and would hide progress. A new `registerTenantTask` validates `organizationId` the same
way and passes `inOrg(fn)`, which opens a short `withOrg` transaction per database touch. All
reads and writes still go through RLS with the job's organization.

### Execution engine

`apps/worker/src/execution/engine.ts` maps steps to the Playwright library
(`playwright-core`): locators to `getByRole`/`getByText`/…/`locator(css)` with `nth`, actions
to the locator methods (strict mode makes ambiguous locators fail with the match count), and
assertions to a polling helper (`expect.poll`-like, 100 ms interval, assertion timeout) that
reports expected and received values; using `@playwright/test`'s `expect` outside its runner
is unsupported. Variables are substituted per iteration before execution.

`run-executor.ts`: load run and items → launch the run's browser once → before-run hooks in
their own context, then `storageState()` → for each item (re-reading cancellation between
steps) and each iteration: new context (base URL, viewport, timeouts, storage state, video if
enabled), tracing if enabled, before-each → steps → after-each, collect console errors; on
failure capture screenshot, URL, `ariaSnapshot()` of `body` (truncated), trace/video; upload
artifacts; write the item. Then after-run hooks, totals and completion. A crash in browser
launch marks remaining items blocked with the error. Jobs use `retryLimit: 0` and an
expiry of 2 hours; cancellation is cooperative.

### Recorder

A `recordings.session` job keeps one browser page open for up to 30 minutes. The API stores
user input as `recording_commands` rows (click x/y, text, key, select, scroll, navigate,
assert, stop); the worker polls them every 150 ms, applies them with `page.mouse`/`keyboard`,
and after each one stores a JPEG frame in `recording_sessions.frame` (only when it changed)
plus the steps. For clicks the worker first resolves the element under the point
(`elementFromPoint`, then the nearest interactive ancestor) and builds candidate locators in
priority order (test id, role+name, label, placeholder, alt, title, text, CSS); each candidate
is checked with Playwright to match exactly one element that is the clicked one. Typing into
the same element extends the previous fill step. The web page polls state every 500 ms and
loads the frame by version. Concurrency per worker is 2 sessions.

Alternatives: a browser extension or injected script recording in the user's browser
(rejected: cross-origin and CSP restrictions, extra install), Playwright `codegen` only
(rejected as the sole path: needs a local Node toolchain; kept as an import option).

### Generated code

`playwrightSpec({ appKey, testCases, hooks, settings, datasets })` writes TypeScript with
`test.use({ baseURL, viewport })`, before-run hooks as `test.beforeAll` saving storage state
reused through `test.use({ storageState })`, before/after-each hooks, a `test.describe` per
scenario, tags via `{ tag: [...] }`, datasets as `for (const [index, row] of data.entries())`
loops and `${row.column}` placeholders. Assertions map to web-first `expect` calls. Strings
are escaped by one helper; output is deterministic and unit-tested.

### Codegen import

`parsePlaywrightCode()` tokenizes each statement (strings, template literals without
expressions, numbers, booleans, object literals, regex as text) into a call chain
`page.getByX(args).nth(n).action(args)` or `expect(chain).toX(args)` and maps supported shapes
to steps; everything else is returned as `{ line, text, reason }` warnings.

### LLM layer

`apps/api/src/services/llm/` defines `LlmProvider.generate({ system, prompt, schema })`
returning validated JSON. `AnthropicProvider` uses the official `@anthropic-ai/sdk`
(`beta.messages.parse` with `betaZodOutputFormat` structured output, `effort: high`, server-side
`fallbacks: 'default'` on models that support it, refusal handling); default model
`claude-opus-5-5`. `OpenAiCompatibleProvider` calls `POST {baseUrl}/chat/completions` with
`response_format: json_object` and validates with Zod (OpenAI, Azure OpenAI v1, Ollama, vLLM).
The architecture named the Vercel AI SDK; a thin interface over the official Anthropic SDK and
one documented HTTP shape keeps dependencies small and the behavior testable with fakes.

The output schema is AI-specific (all fields required, empty string for "none") and converted
into the step model; invalid steps are dropped with issues so one bad step does not lose a
proposal. Keys are encrypted with AES-256-GCM using a key derived (HKDF-SHA256) from
`APP_SECRET`; `v1:` prefixed. Every call runs `quota.check('llm.request')` and has a 120 s
timeout. Fix requests include the item's failing step, error, URL and the ARIA snapshot.

### Reports

Run reports are computed from the run and its items (all snapshots), so they stay stable.
The global report runs aggregate SQL over `test_runs`/`test_run_items` of the period: totals,
last 30 runs for the trend, per-test-case failure counts, flakiness (passed and failed in the
period), average automated duration, and per-scenario health from `scenario_ids` arrays.
Pass rate everywhere is passed ÷ (passed + failed + blocked).

### Web

New routes: `/test-cases` (grid), `/test-cases/new`, `/test-cases/:key` (`?tab=steps|code|
history|runs`), `/test-cases/:key/edit`, `/runs` (list + new run dialog), `/runs/:key`
(report, manual runner, live polling every 2 s while active), `/reports`, `/automation`
(`?tab=settings|global-steps|datasets`), `/automation/datasets/:id`, and an organization
settings "AI" tab. A shared `StepsEditor` (action-aware fields, reorder, duplicate, recorder
and AI buttons) and `StepsView` (emphasized expectations, per-step results) are used by test
cases, global steps, the recorder and runs. Charts are inline SVG with table equivalents.

### Permissions

`testcase.write` (manager, editor): test cases, datasets, global steps, automation settings,
recordings and AI. `execution.write` (manager, editor, tester): runs and manual results.
`org.manage`: LLM settings. All writes also require a writable (not archived) application.

### Audit events

`test_case.created|updated|deleted|restored|version_restored`, `dataset.created|updated|
deleted`, `global_step.created|updated|deleted`, `automation.updated`, `run.created|cancelled|
completed`, `run_item.executed`, `llm.settings_updated`. Steps and rich text are logged as
version numbers; the API key never appears.

### Tenant isolation

Every new table has `organization_id NOT NULL`, RLS enabled and forced, and the standard
`tenant_isolation` policy in the migration that creates it, so the generic RLS test covers
them. Application scoping is enforced in routes by filtering on `req.application.id` and
looking up every id from a request with that filter (scenario ids, dataset ids, item ids,
artifact ids, session ids). Worker jobs carry `organizationId`, are validated by
`tenantJobPayload` and only touch data through `withOrg`. Artifact keys are prefixed
`org/<orgId>/runs/<runId>/`; downloads check the artifact's application.

## Risks / Trade-offs

- [Browsers are heavy; a long run blocks a worker slot] → One run per worker slot
  (`localConcurrency` 1 for runs, 2 for recordings); scale workers horizontally.
- [Recorder latency (poll + screenshot) feels slower than a local browser] → Frames only after
  changes, 150 ms command polling, local echo of typed text; codegen import as alternative.
- [Heuristic locators can still be brittle] → Uniqueness verified with Playwright before a
  locator is accepted; failures capture ARIA snapshots and the AI fix proposes new locators.
- [LLM output does not match the schema] → Structured output where available, Zod validation,
  partial acceptance with issues listed.
- [Stale `running` runs after a worker crash] → `retryLimit: 0`, expiry 2 h; users can cancel.
- [Large artifacts grow storage] → Captured only for failures; retention is a follow-up.

## Migration Plan

Additive: migration `0005_test_cases_and_runs` creates the new types, tables, indexes, RLS
policies and revokes UPDATE/DELETE on `test_case_versions`. No existing row changes. The worker
image installs `playwright-core` matching its browsers next to the bundle; CI installs Chromium
before integration tests. Rollback: redeploy the previous images; they ignore the new tables.
