## 1. Contracts

- [x] 1.1 Add the step model (actions, assertions, locators, per-action rules), `describeStep`, variable extraction and substitution; verify unit tests for each action's required fields, manual steps in automated mode and unknown variables
- [x] 1.2 Add test case schemas (create/update with `baseVersion`, 1–20 scenarios, mode default automated), keys `CHK-TC-n`/`CHK-TR-n`, list query shared by API and URL; verify schema tests for defaults, limits and key parsing
- [x] 1.3 Add dataset schemas and CSV parse/format (comma/semicolon, quotes, CRLF); verify round-trip unit tests
- [x] 1.4 Add automation settings, global step and run schemas, run/item status aggregation, pass rate and JUnit XML export; verify unit tests for worst-iteration results and XML escaping
- [x] 1.5 Add the Playwright spec generator (hooks, storage state, datasets, tags, escaping); verify snapshot-style unit tests
- [x] 1.6 Add the codegen parser (locators, chained `nth/first/last`, actions, `expect` assertions, warnings); verify unit tests with real codegen output
- [x] 1.7 Add AI request/response schemas and LLM settings schemas, new audit actions and job queue names; verify locale test covers new audit actions

## 2. Database

- [x] 2.1 Add Drizzle schema and migration `0005` for test cases, links, tags, versions, datasets, automation settings and global steps with RLS; verify migrations apply and the generic RLS test passes
- [x] 2.2 Add runs, items, artifacts, recording sessions/commands and LLM settings with RLS; revoke UPDATE/DELETE on `test_case_versions`; verify an integration test that updating a version as the runtime role fails
- [x] 2.3 Extend sequences with `TC` and `TR`; verify distinct numbers in integration tests

## 3. API — test cases and automation

- [x] 3.1 Implement test case create/read/update/delete/restore with scenario links, tags, dataset check, versions, conflict detection and audit; verify integration tests for spec scenarios
- [x] 3.2 Implement the catalog (search, filters, sort, paging, last result) and scenario test case counts/list; verify integration tests
- [x] 3.3 Implement versions list/read/restore and generated code endpoints for test cases and scenarios; verify integration tests
- [x] 3.4 Implement datasets CRUD with in-use protection, automation settings and global steps CRUD with audit; verify integration tests including permissions

## 4. API — runs and reports

- [x] 4.1 Implement the job queue service (pg-boss producer, in-memory for tests) and run creation with selection, snapshots and job dispatch; verify integration tests for selection rules and blocked empty datasets
- [x] 4.2 Implement run list/detail, item detail, manual results, cancel, complete, re-run and artifact download; verify integration tests including permissions and cross-application 404
- [x] 4.3 Implement run report JSON and JUnit exports and the global report; verify integration tests with fixture results

## 5. Worker

- [x] 5.1 Add `registerTenantTask` with per-call `withOrg` transactions; verify it rejects payloads without organization
- [x] 5.2 Implement the step engine on `playwright-core` (locators, actions, polling assertions, variables); verify tests against a local HTTP fixture site in Chromium
- [x] 5.3 Implement the run executor (hooks, storage state, iterations, cancellation, artifacts, totals); verify an integration test executing a run end to end against the fixture site
- [x] 5.4 Implement the recorder session job (commands, frames, locator candidates verified for uniqueness, typing merge, assertions, limits); verify an integration test that records click and fill steps
- [x] 5.5 Install `playwright-core` in the worker image and Chromium in CI; verify the worker builds (bundle built and started locally; the Docker image and the CI workflow were not run in the development environment)

## 6. API — recordings and AI

- [x] 6.1 Implement recording session routes (start, state, frame, commands, stop) with ownership checks; verify integration tests with the in-memory queue
- [x] 6.2 Implement LLM settings (encrypted key, never returned), connection test and provider layer (Anthropic SDK, OpenAI-compatible); verify unit tests for encryption and providers with fakes
- [x] 6.3 Implement generate, revise and fix endpoints with validation and quota checks; verify integration tests with a fake provider

## 7. Web

- [x] 7.1 Add workspace tabs, routes, shortcuts and query hooks; verify typecheck and locale parity
- [x] 7.2 Build the test case catalog, page (steps with emphasized expectations, code, history, runs) and form with the steps editor; verify component tests
- [x] 7.3 Build the recorder dialog (live view, assertion mode, codegen import) and AI dialogs (generate, revise, fix) with proposal review
- [x] 7.4 Build the automation tab (settings, global steps, datasets with CSV) and the organization AI settings tab
- [x] 7.5 Build runs list, new run dialog, run page with live progress, report, manual runner and exports
- [x] 7.6 Build the reports tab with trend chart, tables and accessible equivalents
- [x] 7.7 Add en/es texts for every new screen and audit action; verify the locale tests

## 8. Documentation and release

- [x] 8.1 Update README and ARCHITECTURE (many-to-many links, execution, AI, roadmap) and add a changeset
- [x] 8.2 Run format, lint, typecheck, unit and integration tests and a browser smoke test of the main flows (integration tests ran against a local PostgreSQL 16 instead of Testcontainers)
