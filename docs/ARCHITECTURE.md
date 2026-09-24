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
   ├── Artifact storage (local volume or S3-compatible)
   └── LLM providers (Anthropic, OpenAI, Azure, Ollama; BYOK per organization)
```

Self-hosted: `docker compose up` (app, worker, postgres).
Cloud (later): same images, stateless, scaled independently; git remotes only (no
mounted paths); quotas and metering through hooks that are no-ops when self-hosted.

## Domain

```
Organization ─< Membership (owner | admin | member)
  └─< Application (key e.g. CHK) ─< ApplicationMember (manager | editor | tester | viewer)
        ├─< Folder ─< TestCase ─< TestCaseVersion ─< Step
        ├─< TestScenario ─< ScenarioVersion ─< ScenarioItem → TestCaseVersion
        ├─< TestCycle ─< TestRun ─< TestExecution (pins TestCaseVersion) ─< StepResult
        ├─< Repository (git remote or mounted path) ─< AutomationLink
        └─< Environment / Build
```

Versioning: test cases and scenarios are append-only versions; executions pin versions;
generated code is versioned in git on `testrex/*` branches (never pushed to default
branches); every mutation is written to the audit log.

## Roadmap (OpenSpec changes)

| #   | Change                                                                          | Status                               |
| --- | ------------------------------------------------------------------------------- | ------------------------------------ |
| 1   | `bootstrap-monorepo`: repo, CI, compose deployment, health, migrations          | implemented, CI unverified on GitHub |
| 2   | `add-org-app-tenancy`: auth, organizations, applications, RBAC, RLS, audit      | implemented                          |
| 3   | `add-test-case-management`: folders, test cases, steps, custom fields, search   | planned                              |
| 4   | `add-test-case-versioning`: versions, diff, restore                             | planned                              |
| 5   | `add-test-scenarios`: scenarios composed of pinned or latest test cases         | planned                              |
| 6   | `add-test-execution`: cycles, runs, runner UI, attachments, storage adapter     | planned                              |
| 7   | `add-dashboards-and-import`: reporting, CSV and QMetry import/export            | planned                              |
| 8   | `add-repository-linking`: git remotes + mounted paths, indexing                 | planned                              |
| 9   | `add-playwright-reporter`: `@testrex/playwright-reporter`, tag-based linking    | planned                              |
| 10  | `add-llm-providers`: provider config, encrypted keys, usage metering            | planned                              |
| 11  | `add-test-generation`: generation pipeline, validation/repair, diff review, PRs | planned                              |
| 12  | `add-cloud-edition`: billing, quotas, SSO, Helm/IaC                             | planned                              |
