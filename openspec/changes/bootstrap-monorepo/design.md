## Context

Greenfield repository. See proposal.md for motivation and `openspec/config.yaml` for the
agreed stack. Specs for observable behavior are in `specs/self-hosted-deployment/spec.md`.

## Goals / Non-Goals

**Goals:**

- A layout that later features slot into without restructuring.
- The same container images serve self-hosted and (later) cloud deployments.
- CI proves the compose deployment actually works on every PR.

**Non-Goals:**

- Performance tuning, horizontal-scaling configuration, Helm.

## Decisions

### Repository layout

```
apps/web        React + Vite SPA (placeholder page)
apps/api        Fastify server; serves apps/web/dist at /, API under /api
apps/worker     pg-boss consumer process
packages/db     Drizzle client, schema (empty), migrations, migrate() with advisory lock
packages/contracts  Zod schemas shared by api and web
packages/config Env schema (Zod) + loader shared by api and worker
packages/ui     shadcn/ui-based component library (empty scaffold)
deploy/         Dockerfiles, docker-compose.yml, .env.example
```

Alternative considered: Nx. Turborepo is lighter and sufficient for this size.

### Two images, not one

`testrex-app` (Node slim, api + static web) and `testrex-worker` (based on
`mcr.microsoft.com/playwright`). The worker image is large because of browsers; keeping it
separate keeps the app image small and lets the cloud edition scale workers independently.
Alternative: single image with a role flag. Rejected because every API replica would carry
browsers.

### Migrations on startup with an advisory lock

`packages/db` exposes `migrate()` which takes `pg_advisory_lock(<constant>)`, applies
pending migrations, then releases. drizzle-kit generates the SQL files and journal, but a
small runner (`packages/db/src/migrate.ts`) applies them one transaction per migration and
records them in `_testrex_migrations`. Drizzle's own migrator applies everything in a single
transaction and cannot report which migration failed, which the spec requires.

The API starts listening first and then migrates. Until migrations are done, only
`/healthz` and `/readyz` are served (everything else returns 503), so liveness works during
long upgrades while no traffic reaches an outdated schema. Connection errors while migrating
(database still starting or restarting) are retried with backoff; only a failing migration
is terminal. The worker does not migrate; it waits for the schema before starting pg-boss.
A dedicated `testrex migrate` command exists for cloud pipelines.

Both processes attach an `error` listener to the connection pool: without it, a database
restart drops idle connections and crashes the process.

### Build and packaging

Shared `packages/*` are consumed as TypeScript source (no build step); apps are bundled.
`apps/api` and `apps/worker` are bundled with tsup into self-contained files, so the
runtime images contain only Node, `dist/` and `migrations/`, with no `node_modules`.

### Configuration

Zod schema in `packages/config`, parsed once at boot with `safeParse`; all issues are
printed together. Secrets are marked in the schema and redacted by a logger serializer.
Pino is used for structured JSON logs.

### Health endpoints

`/healthz` (liveness: process up) and `/readyz` (readiness: `SELECT 1`, migrations done,
pg-boss started) on both processes; API adds `/api/version` returning
`{ version, commit }` injected at build time via build args.

### Tenant isolation

No tenant data exists yet. The DB connection helper is designed now to accept a per-request
`orgId` and execute `SET LOCAL app.org_id` inside a transaction, so `add-org-app-tenancy`
only has to add RLS policies.

### Release versioning

Changesets manages versions of the app and publishable packages. Image tags: `x.y.z`,
`x.y`, `latest`, plus `sha-<commit>`.

## Risks / Trade-offs

- [Worker image size, measured 3.6 GB uncompressed with Chromium, Firefox and WebKit] →
  Pulled only once; documented. Later, an optional "no-browsers" or Chromium-only worker
  variant for teams that only use the external reporter.
- [Auto-migration on startup can surprise operators during upgrades] → Documented upgrade
  notes per release, and `AUTO_MIGRATE=false` switch plus `testrex migrate` command.
- [Windows contributors and line endings/shell scripts] → `.gitattributes` with LF, and all
  scripts are Node-based instead of bash.

## Migration Plan

Not applicable (first release). Rollback is simply stopping the containers.
