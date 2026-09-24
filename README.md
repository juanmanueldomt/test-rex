<p align="center">
  <img src="docs/logo.svg" alt="testRex" width="420">
</p>

<p align="center">
  Open-source test management with Playwright integration and LLM-assisted test generation.
</p>

---

testRex stores your **test cases**, **test scenarios** and **test runs**, organized by
organization and application, links them to your existing **Playwright** repository, and
uses the LLM provider of your choice to **generate Playwright tests** from test cases.

> **Status:** early development. See the [architecture and roadmap](docs/ARCHITECTURE.md).

## Quick start (self-hosted)

Requirements: Docker with Compose v2.

```bash
git clone <this repository> testrex
cd testrex/deploy
cp .env.example .env        # then set APP_SECRET and POSTGRES_PASSWORD
docker compose up -d
```

Open <http://localhost:8080>. Check health with `curl http://localhost:8080/readyz`.

Configuration is documented in [`deploy/.env.example`](deploy/.env.example).

## Development

Requirements: Node 22+, pnpm (via `corepack enable`), Docker (for integration tests).

```bash
pnpm install
pnpm build          # build all workspaces
pnpm test           # unit tests
pnpm test:int       # integration tests (uses Testcontainers + Docker)
pnpm lint && pnpm typecheck
```

Features are developed spec-first with [OpenSpec](https://github.com/Fission-AI/OpenSpec):
proposals live in [`openspec/changes`](openspec/changes) and accepted behavior in
[`openspec/specs`](openspec/specs). See [CONTRIBUTING](CONTRIBUTING.md).

## Repository layout

| Path                 | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `apps/web`           | React single-page app                              |
| `apps/api`           | Fastify API server; also serves the web app        |
| `apps/worker`        | Background jobs (git, generation, Playwright runs) |
| `packages/config`    | Environment configuration and logging              |
| `packages/db`        | Database client, schema and migrations             |
| `packages/contracts` | Schemas shared by API and web                      |
| `packages/ui`        | UI component library                               |
| `deploy`             | Dockerfiles and Docker Compose                     |

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in testRex by you, as defined in the Apache-2.0 license, shall be dual licensed
as above, without any additional terms or conditions.
