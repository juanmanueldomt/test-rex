# testRex architecture

![testRex](https://fastlogy.com/img/test-rex-logo.svg)

Open-source test management platform (QMetry-like) with Playwright repository integration
and LLM-assisted test generation. Licensed under MIT OR Apache-2.0.

Development is spec-driven with [OpenSpec](https://github.com/Fission-AI/OpenSpec): every
feature starts as a change proposal in `openspec/changes/`, and accepted behavior lives in
`openspec/specs/`. Stack and conventions are recorded in `openspec/config.yaml`.

## Runtime topology

```
Browser (React SPA)
   │
   ▼
testrex-app ── Fastify API + static SPA + auth + AI assistance (LLM calls)
   │   jobs (pg-boss, stored in Postgres): runs.execute · recordings.session
   ▼
testrex-worker ── Playwright runs · live recordings (later: git, repo indexing)
   │
   ├── PostgreSQL 16  (data, queue, Row-Level Security per organization)
   ├── File storage (local volume or S3-compatible bucket; attachments, run artifacts)
   └── LLM providers (Anthropic, or OpenAI-compatible: OpenAI, Azure, Ollama; BYOK per organization)
```

Self-hosted: `docker compose up` (app, worker, postgres).
Cloud (later): same images, stateless, scaled independently; git remotes only (no
mounted paths); quotas and metering through hooks that are no-ops when self-hosted.

## Domain

```
Organization ─< Membership (owner | admin | member)
  ├── LlmSettings              provider, model, API key (AES-256-GCM, key from APP_SECRET)
  └─< Application (key e.g. CHK) ─< ApplicationMember (manager | editor | tester | viewer)
        ├─< Module                    flat grouping of scenarios (replaces folders)
        ├─< Tag                       Playwright-style @tags, per application
        ├─< TestScenario (CHK-TS-12) ─< ScenarioRevision (r1, r2, … immutable)
        │     └─< Comment · RequirementLink · Attachment
        ├─< TestCase (CHK-TC-142) >─< TestScenario          many-to-many
        │     └─< TestCaseVersion (v1, v2, … immutable: steps, dataset, scenario links)
        ├─< Dataset                   columns × rows; a test case runs once per row
        ├── AutomationSettings        base URL, browser, viewport, timeouts, trace/video
        ├─< GlobalStep                before run · before each · after each · after run
        ├─< TestRun (CHK-TR-7) ─< RunItem (pinned version, steps, rows) ─< iteration ─< step result
        │     └─< RunArtifact         screenshot, trace, video (files in storage)
        ├─< RecordingSession ─< RecordingCommand
        ├─< Repository (git remote or mounted path) ─< AutomationLink        (planned)
        └─< TestCycle · Environment / Build                                (planned)
```

A test scenario is the testRex counterpart of a Playwright `spec.ts` file: it describes a
feature or flow, and its Playwright code is a spec with all its test cases. Test cases verify
one or more scenarios (many-to-many). A test case is **automated** (the worker runs its steps
with the Playwright library) or **manual** (a tester follows them and records each step's
result). Steps are a typed model (actions, locators, assertions, `{{variables}}`), not free
code, so the same steps drive the engine, the generated `@playwright/test` code, the recorder
and AI proposals. A test run selects test cases, either all cases of some scenarios or
individual ones; every run item pins the test case version, its steps, dataset rows and the
enabled global steps, so later edits never change a run's report.

Versioning: scenario revisions and test case versions are append-only; runs pin them;
generated code will be versioned in git on `testrex/*` branches (never pushed to default
branches); every mutation is written to the audit log.

## Execution

- **Runs**: the API stores the run with its snapshots and queues `runs.execute`. The worker
  launches a headless browser (`playwright-core`, matching the browsers of the Playwright
  image), runs the _before run_ global steps once and shares their cookies and storage, then
  executes each automated item, once per dataset row, in a fresh browser context: _before
  each_ steps, the test case steps, _after each_ steps. Assertions retry until the assertion
  timeout. A failure keeps the error, the page URL, console errors and the ARIA snapshot
  with the result, and a screenshot plus, if enabled, a trace and video under
  `org/<id>/runs/<run>/` in the storage adapter. Every database write
  is a short transaction inside Row-Level Security; cancellation is checked between steps.
  Manual items are executed in the browser and saved through the API; a run completes when no
  item is left to execute.
- **Recordings**: `recordings.session` drives a browser in the worker. The UI sends clicks,
  typing and assertions as commands and shows JPEG frames; the worker records steps with the
  first locator that matches only the target element. Sessions end after 5 minutes idle or 30
  minutes in total.
- **AI assistance**: the API calls the organization's provider synchronously (Anthropic
  through the official SDK with structured outputs, or an OpenAI-compatible chat completions
  endpoint in JSON mode). Answers are validated against the step model and shown as proposals
  or diffs; nothing is saved until a person accepts it. Rotating `APP_SECRET` makes stored keys
  unreadable until an admin enters them again.

## Roadmap (OpenSpec changes)

| #   | Change                                                                                                                                                                                          | Status                               |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `bootstrap-monorepo`: repo, CI, compose deployment, health, migrations                                                                                                                          | implemented, CI unverified on GitHub |
| 2   | `add-org-app-tenancy`: auth, organizations, applications, RBAC, RLS, audit                                                                                                                      | implemented                          |
| 3   | `add-test-scenarios`: workspace, scenarios, modules, tags, revisions, comments, requirement links, attachments, storage adapter                                                                 | implemented                          |
| 4   | `add-test-cases-and-execution`: test cases linked to scenarios, steps and assertions, datasets, global steps, automated and manual runs, recorder, run and global reports, AI assistance (BYOK) | implemented                          |
| 5   | `add-test-cycles`: cycles grouping runs, environments and builds, scheduled runs, custom fields, version diff                                                                                   | planned                              |
| 6   | `add-dashboards-and-import`: dashboards, CSV and QMetry import/export                                                                                                                           | planned                              |
| 7   | `add-repository-linking`: git remotes + mounted paths, indexing                                                                                                                                 | planned                              |
| 8   | `add-playwright-reporter`: `@testrex/playwright-reporter`, tag-based linking                                                                                                                    | planned                              |
| 9   | `add-llm-usage`: usage metering and limits (provider settings and encrypted keys ship with #4)                                                                                                  | planned                              |
| 10  | `add-test-generation`: Playwright code in linked repositories, validation/repair, PRs (AI test case drafts ship with #4)                                                                        | planned                              |
| 11  | `add-cloud-edition`: billing, quotas, SSO, Helm/IaC                                                                                                                                             | planned                              |
