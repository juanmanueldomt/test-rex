## Why

Scenarios exist, but testRex still cannot hold a single test case, run anything or report a
result, so it is not yet a test management tool. Teams need to write test cases once, link
them to the scenarios they verify, run them automatically with Playwright (or by hand when
automation is not worth it), and see what passed, what failed and why, per run and over time.
Writing and repairing automated tests is the slowest part of that loop, so recording a flow in
a browser and asking an LLM to draft or fix tests must be part of it from the start.

## What Changes

- **Test cases** (`CHK-TC-12`) linked to **one or more** scenarios (many-to-many, replacing
  "each test case belongs to exactly one scenario"). Fields: title, status, priority, tags,
  description, preconditions, an optional dataset, and ordered **steps**. Every step has a
  human description and an optional **expected result**; automated steps add a Playwright
  action (go to, click, fill, press, select, check, hover, wait) and a locator (role, text,
  label, placeholder, alt text, title, test id or CSS). **Assertions** (expect visible, hidden,
  text, value, checked, enabled, count, URL, title) are steps too and, like expected results,
  are shown **with emphasis** wherever a test case is displayed.
- **Execution mode**: `automated` (the default) or `manual`.
- Every save creates an immutable **version** (v1, v2, …) with author and source (`editor`,
  `ai`, `recording`, `restore`); runs pin the version they executed. Optimistic concurrency
  with `baseVersion`; soft delete and restore.
- **Datasets** per application (named columns and rows, CSV import/export). A test case that
  uses a dataset runs once per row (iterations); steps reference columns as `{{column}}`.
- **Automation settings** per application: base URL, browser (Chromium, Firefox, WebKit),
  viewport, action/navigation/assertion timeouts, trace and video capture.
- **Global steps** (hooks) per application in four phases: **before test run**, **before each
  test case**, **after each test case**, **after test run**. Browser state left by "before test
  run" (for example a login) is shared with every test case.
- **Playwright code**: every test case, scenario and run selection can be viewed and
  downloaded as a `@playwright/test` spec, generated from the same steps the engine executes.
- **Recordings**: an in-app **recorder** drives a real browser in the worker; the user clicks
  and types on a live view, testRex writes steps with robust locators (test id, role and name,
  label, …) and assertions picked from the page, then saves them into a test case. Code
  recorded locally with `npx playwright codegen` can also be pasted and imported as steps.
- **Test runs** (`CHK-TR-3`): select scenarios and/or test cases (and modes), choose
  environment overrides, and start. Automated items run in the worker with the **Playwright
  library** (headless browser per test case, global steps, datasets, screenshots, traces and
  ARIA snapshots on failure); manual items are executed step by step in the browser by
  testers. Runs can be cancelled, completed and re-run (all or only failed items).
- **Run report**: totals, pass rate, duration, environment, per-scenario breakdown, global
  step results, per-item iterations with each step's result, failing step and error, console
  errors, artifacts; exported as JSON and JUnit XML.
- **Reports** tab: a global report across runs of a period — pass-rate trend, totals, most
  failing, flaky and slowest test cases, and scenario health.
- **AI assistance** (BYOK): organizations configure an LLM provider (Anthropic, or any
  OpenAI-compatible endpoint such as OpenAI, Azure OpenAI or Ollama); the API key is encrypted
  at rest. Editors can **generate** test cases for a scenario, **revise** a test case from an
  instruction, and **fix** a failed automated test from its failure context; proposals are
  reviewed as a diff before they are saved.
- Workspace tabs become **Test scenarios · Test cases · Test runs · Reports · Automation**;
  new shortcuts (`g c`, `g d`, `g a`, `c` to create on each list).
- All new UI text in English and Spanish; every mutation audited.

## Capabilities

### New Capabilities

- `test-cases`: test case data, keys, scenario links, execution mode, steps and assertions,
  versions, deletion, permissions and audit.
- `test-datasets`: datasets, CSV import/export and iterations.
- `test-automation`: step actions and locators, automation settings, global steps, the
  Playwright engine semantics and generated Playwright code.
- `test-recording`: the in-app recorder and import of Playwright codegen output.
- `test-execution`: test runs, selection, automated and manual execution, cancellation,
  re-runs, artifacts and the run report with exports.
- `test-reporting`: the global report across runs.
- `ai-assistance`: LLM provider settings and AI generation, revision and repair of test cases.

### Modified Capabilities

- `test-scenarios`: "Scenario owns its test cases" becomes "Scenarios and test cases are
  linked" (many-to-many, real counts, a test cases tab with actions).
- `application-workspace`: the workspace has five tabs, the runs placeholder is replaced, and
  the shortcut set grows.

## Impact

- **Database** (migration `0005`): tenant tables `test_cases`, `test_case_scenarios`,
  `test_case_tags`, `test_case_versions` (append-only), `datasets`, `automation_settings`,
  `global_steps`, `test_runs`, `test_run_items`, `run_artifacts`, `recording_sessions`,
  `recording_commands`, `llm_settings`; all with `organization_id` and RLS. Sequences gain
  `TC` and `TR`.
- **API**: routes for test cases, versions, code, datasets, automation, global steps, runs,
  run items, artifacts, exports, reports, recordings, AI and organization LLM settings; a job
  queue client (pg-boss) to hand runs and recordings to the worker.
- **Worker**: `runs.execute` and `recordings.session` jobs using the Playwright library;
  tenant tasks that open short transactions instead of one long one; artifact uploads.
- **Contracts**: step model, validation, descriptions, variable substitution, Playwright code
  generator, codegen parser, CSV, JUnit, run aggregation and report types.
- **Web**: new tabs and pages, step editor with emphasized assertions, recorder, code view,
  runs and manual runner, report pages with charts, organization AI settings.
- **Dependencies**: `@anthropic-ai/sdk` (API), `playwright-core` (worker, matching the
  worker image's browsers).
- **Deploy**: the worker image installs `playwright-core` next to the bundle; CI installs
  Chromium for integration tests.
- **Cloud edition**: run and recording jobs carry the organization and work inside RLS;
  artifacts live under `org/<id>/runs/...` in the storage adapter; recorder and run
  concurrency are bounded per worker; LLM calls go through `QuotaService` (`llm.request`) and
  keys are per organization, so per-plan limits and metering can be added without schema
  changes.

## Non-goals

- Running arbitrary user-written Playwright code in the worker (only the step model runs;
  generated code is for viewing and exporting).
- Linking test cases to files in a Playwright repository and syncing code (planned
  `add-repository-linking`).
- Parallel execution of one run across several workers, sharding, retries of failed steps and
  scheduled (cron) runs.
- Test cycles, builds and environments as managed entities (a run stores its environment).
- Diffing two test case versions side by side, comments and attachments on test cases.
- Artifact retention policies and video for manual executions.
- Streaming LLM output; usage metering beyond the quota hook.
