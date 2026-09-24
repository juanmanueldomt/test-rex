## 1. Repository skeleton

- [x] 1.1 Add root `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.nvmrc` (22), `.gitattributes`, `.editorconfig`; verify `pnpm install` succeeds
- [x] 1.2 Add `LICENSE-MIT`, `LICENSE-APACHE`, README (with logo), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY; verify files present and README links resolve
- [x] 1.3 Add shared `tsconfig.base.json`, ESLint flat config and Prettier; verify `pnpm lint` and `pnpm typecheck` pass on the empty workspaces
- [x] 1.4 Scaffold `apps/web`, `apps/api`, `apps/worker`, `packages/{db,contracts,config,ui}` with build scripts; verify `pnpm build` builds all workspaces via Turborepo
- [x] 1.5 Set up Vitest workspace and Changesets; verify `pnpm test` runs and `pnpm changeset` works

## 2. Configuration

- [x] 2.1 Implement Zod env schema and loader in `packages/config` that reports all invalid keys at once; verify unit tests for missing `APP_SECRET` and multiple invalid keys
- [x] 2.2 Add Pino logger with secret redaction; verify a unit test that logged config contains no secret values
- [x] 2.3 Write `deploy/.env.example` documenting every variable; verify it parses with the schema after filling secrets

## 3. Database package

- [x] 3.1 Set up Drizzle client and drizzle-kit config in `packages/db`; verify `pnpm db:generate` produces an (empty) migration
- [x] 3.2 Implement `migrate()` guarded by `pg_advisory_lock`; verify an integration test running two concurrent `migrate()` calls applies each migration once (Testcontainers Postgres)
- [x] 3.3 Implement `withOrg(orgId, fn)` transaction helper that runs `SET LOCAL app.org_id`; verify an integration test reads back `current_setting('app.org_id')`

## 4. API and web

- [x] 4.1 Create Fastify server with `/healthz`, `/readyz`, `/api/version`; verify tests for 200 and for 503 when the DB is down
- [x] 4.2 Run `migrate()` before `listen()` with `AUTO_MIGRATE` switch and a `testrex migrate` CLI command; verify a failing migration keeps readiness at 503
- [x] 4.3 Scaffold Vite React SPA with Tailwind, shadcn/ui, dark mode toggle and the testRex logo; verify `pnpm --filter web build` output is served by the API at `/`

## 5. Worker

- [x] 5.1 Create worker process starting pg-boss with a `system.ping` job and health endpoints; verify an integration test that enqueues and completes `system.ping`
- [x] 5.2 Make worker readiness wait for the expected schema version; verify test with a pending migration reports 503

## 6. Containers and deployment

- [x] 6.1 Write multi-stage `Dockerfile.app` (node slim) with version/commit build args; verify image builds and `/api/version` returns injected values
- [x] 6.2 Write `Dockerfile.worker` based on the Playwright image; verify image builds and `npx playwright --version` runs inside it
- [x] 6.3 Write `deploy/docker-compose.yml` with postgres volume, healthchecks and depends_on; verify `docker compose up -d` becomes healthy within 120 s and data survives `down`/`up`

## 7. CI

- [ ] 7.1 GitHub Actions workflow: install, lint, typecheck, test, build; verify it passes on a PR
- [ ] 7.2 Add compose smoke-test job that boots the stack and curls `/readyz` and `/`; verify the job fails when readiness fails
- [ ] 7.3 Add release workflow publishing images to GHCR on version tags; verify with a dry-run tag
