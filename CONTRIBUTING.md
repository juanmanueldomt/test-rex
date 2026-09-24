# Contributing to testRex

Thanks for helping! This project is developed **spec-first** with
[OpenSpec](https://github.com/Fission-AI/OpenSpec).

## Workflow

1. **Propose.** For any behavior change, open a change proposal in `openspec/changes/<name>/`
   (`proposal.md`, delta specs, `design.md`, `tasks.md`). With Claude Code you can use
   `/openspec-propose`. Validate with `npx openspec validate <name> --strict`.
2. **Review.** The proposal is reviewed in a pull request before implementation starts.
3. **Implement.** Work through `tasks.md`, ticking tasks as they are verified.
4. **Archive.** When merged, archive the change so its specs move into `openspec/specs/`.

Pure refactors, tooling and docs changes do not need a proposal.

## Local setup

```bash
corepack enable
pnpm install
pnpm build
pnpm test          # unit tests
pnpm test:int      # integration tests (requires Docker)
```

## Running locally

The app needs PostgreSQL with the two roles testRex expects (the API refuses to serve with a
superuser connection, because Row-Level Security would not apply):

```bash
cd deploy && cp .env.example .env    # set APP_SECRET and POSTGRES_PASSWORD
docker compose up -d postgres
export POSTGRES_PASSWORD=...          # same value as in .env
export DATABASE_URL=postgres://testrex_app:$POSTGRES_PASSWORD@localhost:5432/testrex
export DATABASE_MIGRATION_URL=postgres://testrex_owner:$POSTGRES_PASSWORD@localhost:5432/testrex
export APP_SECRET=$(openssl rand -hex 32)
export PUBLIC_URL=http://localhost:5173   # the Vite dev server, which proxies /api
pnpm dev
```

(Expose the database port for local development by adding `ports: ['5432:5432']` to the
`postgres` service.)

## End-to-end and accessibility tests

```bash
pnpm build
pnpm --filter @testrex/web exec playwright install chromium   # once
pnpm --filter @testrex/web e2e
```

The suite starts its own PostgreSQL (Testcontainers) and the built API, then drives the web
app in Chromium. `e2e/a11y.spec.ts` runs axe (WCAG 2.1 AA) on every page in light and dark
mode and fails on serious or critical violations.

## Conventions

- TypeScript everywhere; `pnpm lint`, `pnpm typecheck` and `pnpm format:check` must pass.
- [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.
- Add a changeset (`pnpm changeset`) for user-visible changes.
- Every tenant table has `organization_id` and Row-Level Security; `pnpm test:int` fails if a
  table with `organization_id` is not protected. Run tenant queries inside `withOrg()`.
- User-facing text goes through i18n (`apps/web/src/locales/en.json` and `es.json`).
- Unit tests: `*.test.ts`. Integration tests (database, containers): `*.int.test.ts`.

## License

By contributing you agree that your contributions are dual licensed under MIT OR Apache-2.0.
