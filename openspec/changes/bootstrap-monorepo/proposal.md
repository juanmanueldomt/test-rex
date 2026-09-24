## Why

testRex has no code yet. Before any product features can be built we need a repository
skeleton, a build/test pipeline and a one-command deployment, so that every later change
lands on a runnable, releasable base. Deployability is a core product promise, so it must
exist from day one rather than being retrofitted.

## What Changes

- Create the pnpm + Turborepo monorepo with `apps/web`, `apps/api`, `apps/worker` and
  `packages/{db,contracts,ui,config}` as empty-but-wired workspaces.
- Shared TypeScript, ESLint, Prettier and Vitest configuration.
- `apps/api` boots a Fastify server that serves the built SPA, exposes health and
  version endpoints, and runs database migrations on startup.
- `apps/worker` boots a pg-boss consumer and exposes a health endpoint.
- `packages/db` contains Drizzle setup and the migration runner (no domain tables yet).
- Environment configuration validated at startup with clear error messages.
- Dockerfiles for app and worker, plus `deploy/docker-compose.yml` (app, worker, postgres).
- GitHub Actions CI: install, lint, typecheck, unit test, build images, compose smoke test.
- Repository hygiene: dual `LICENSE-MIT` / `LICENSE-APACHE`, README, CONTRIBUTING,
  CODE_OF_CONDUCT, Changesets for release versioning.

## Capabilities

### New Capabilities

- `self-hosted-deployment`: starting testRex with a single command, startup configuration
  validation, automatic schema migration, and health/version reporting.

### Modified Capabilities

<!-- none -->

## Impact

- New repository layout; every later change builds on it.
- Runtime dependencies: Node 22+, PostgreSQL 16, Docker (for deployment only).
- Cloud edition: containers are stateless and configured solely through environment
  variables, so the same images can later run on Kubernetes/ECS behind a load balancer.
  Migrations are guarded by a Postgres advisory lock so multiple replicas can start safely.

## Non-goals

- No authentication, organizations or domain entities (covered by `add-org-app-tenancy`).
- No Helm chart or cloud infrastructure-as-code yet.
- No object storage (S3) adapter yet; introduced with the first feature that stores files.
- No UI beyond a placeholder page proving the SPA is served.
