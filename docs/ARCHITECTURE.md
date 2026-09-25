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
testrex-app ── Fastify API + static SPA + SSE + auth
   │   jobs (pg-boss, stored in Postgres)
   ▼
testrex-worker ── git · repo indexing · LLM generation · Playwright runs
   │
   ├── PostgreSQL 16  (data, queue, Row-Level Security per organization)
   ├── File storage (local volume or S3-compatible bucket; attachments, run artifacts)
   └── LLM providers (Anthropic, OpenAI, Azure, Ollama; BYOK per organization)
```

Self-hosted: `docker compose up` (app, worker, postgres).
Cloud (later): same images, stateless, scaled independently; git remotes only (no
mounted paths); quotas and metering through hooks that are no-ops when self-hosted.

## Domain

```
Organization ─< Membership (owner | admin | member)
  └─< Application (key e.g. CHK) ─< ApplicationMember (manager | editor | tester | viewer)
        ├─< Module                    flat grouping of scenarios (replaces folders)
        ├─< Tag                       Playwright-style @tags, per application
        ├─< TestScenario (CHK-TS-12) ─< ScenarioRevision (r1, r2, … immutable)
        │     ├─< TestCase (CHK-TC-142) ─< TestCaseVersion ─< Step
        │     └─< Comment · RequirementLink · Attachment
        ├─< TestCycle ─< TestRun ─< RunItem → TestCaseVersion (+ ScenarioRevision) ─< StepResult
        ├─< Repository (git remote or mounted path) ─< AutomationLink
        └─< Environment / Build
```

A test scenario is the testRex counterpart of a Playwright `spec.ts` file: it describes a
feature or flow and owns its test cases, and each test case belongs to exactly one scenario.
A test run selects test cases, either all cases of some scenarios or individual ones, and
every run item pins the test case version (and scenario revision) it ran against.

Versioning: scenario revisions and test case versions are append-only; runs pin them;
generated code is versioned in git on `testrex/*` branches (never pushed to default
branches); every mutation is written to the audit log.

## Roadmap (OpenSpec changes)

| #   | Change                                                                                                                          | Status                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `bootstrap-monorepo`: repo, CI, compose deployment, health, migrations                                                          | implemented, CI unverified on GitHub |
| 2   | `add-org-app-tenancy`: auth, organizations, applications, RBAC, RLS, audit                                                      | implemented                          |
| 3   | `add-test-scenarios`: workspace, scenarios, modules, tags, revisions, comments, requirement links, attachments, storage adapter | implemented                          |
| 4   | `add-test-cases`: test cases within scenarios, steps, custom fields, versions, diff, restore                                    | planned                              |
| 5   | `add-test-execution`: cycles, runs selecting whole scenarios or individual test cases, runner UI                                | planned                              |
| 6   | `add-dashboards-and-import`: reporting, CSV and QMetry import/export                                                            | planned                              |
| 7   | `add-repository-linking`: git remotes + mounted paths, indexing                                                                 | planned                              |
| 8   | `add-playwright-reporter`: `@testrex/playwright-reporter`, tag-based linking                                                    | planned                              |
| 9   | `add-llm-providers`: provider config, encrypted keys, usage metering                                                            | planned                              |
| 10  | `add-test-generation`: generation pipeline, validation/repair, diff review, PRs                                                 | planned                              |
| 11  | `add-cloud-edition`: billing, quotas, SSO, Helm/IaC                                                                             | planned                              |
