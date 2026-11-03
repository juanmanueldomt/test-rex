<p align="center">
  <img src="docs/logo.svg" alt="testRex" width="420">
</p>

<p align="center">
  Open-source test management with Playwright integration and LLM-assisted test generation.
</p>

---

testRex stores your **test scenarios**, **test cases** and **test runs**, organized by
organization and application. Test cases run automatically with **Playwright** (or by hand),
can be recorded in a browser, and can be drafted, improved and fixed with the **LLM provider
of your choice**.

- **Test cases** verify one or more scenarios with ordered steps; **expected results and
  assertions are highlighted** wherever a test case is shown. Every save is a version.
- **Automated** by default (the worker runs the steps with the Playwright library) or
  **manual** (testers follow the steps and record each result). A **dataset** runs a test
  case once per row, with `{{column}}` values in its steps.
- **Global steps** run before or after every test case or every run, like Playwright hooks;
  a sign-in before the run is shared by every test case.
- **Record** steps by clicking through your application in a browser that testRex runs, or
  import code from `npx playwright codegen`. Every test case and scenario shows its
  **Playwright code**, ready to copy or download.
- **Test runs** end with a full report: pass rate, duration, results per scenario and per
  step, the failing step and error, screenshots, Playwright traces and console errors,
  exportable as JSON or JUnit XML. The **Reports** tab shows trends, the most failing, flaky
  and slowest test cases, and scenario health across runs.
- **AI assistance** with your own key (Anthropic, or any OpenAI-compatible endpoint such as
  OpenAI, Azure OpenAI or Ollama): generate test cases for a scenario, improve one from an
  instruction, or fix a failed automated test from its failure. Nothing is saved until you
  accept the proposal.

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

### File storage

Attachments (files and screenshots on test scenarios) are stored either in a directory or
in an S3-compatible bucket. By default (`STORAGE_DRIVER=local`) compose keeps them in the
`storage` Docker volume, mounted at `/data/storage` in the app and worker containers; back
it up together with the `pgdata` volume. Uploads are limited to `ATTACHMENT_MAX_BYTES`
(25 MB by default).

To use a bucket instead (AWS S3, MinIO, Cloudflare R2, ...), set in `deploy/.env`:

```bash
STORAGE_DRIVER=s3
S3_BUCKET=testrex-attachments
S3_REGION=us-east-1
# For MinIO or another S3-compatible service; leave empty for AWS S3:
S3_ENDPOINT=http://minio:9000
S3_FORCE_PATH_STYLE=true
# Leave both empty to use the default AWS credential chain (e.g. an IAM role):
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

The bucket must exist, and the credentials need to read, write and delete objects in it.
With S3, attachments never touch the containers' disks. `/readyz` reports a `storage`
check and stays unavailable, naming the problem, while the directory is not writable or
the bucket cannot be used.

### Running automated tests

Set the application's **base URL** in _Automation → Settings_. Automated tests and
recordings run in the worker container, so the address must be reachable from there: for an
application on the Docker host, use `http://host.docker.internal:<port>`. Each run can
override the base URL and the browser (Chromium, Firefox or WebKit).

To use AI assistance, an organization admin chooses the provider, model and API key in
_Organization settings → AI_. The key is encrypted with `APP_SECRET` and never shown again.

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

| Path                 | Purpose                                          |
| -------------------- | ------------------------------------------------ |
| `apps/web`           | React single-page app                            |
| `apps/api`           | Fastify API server; also serves the web app      |
| `apps/worker`        | Background jobs (Playwright runs and recordings) |
| `packages/config`    | Environment configuration and logging            |
| `packages/db`        | Database client, schema and migrations           |
| `packages/storage`   | File storage adapters (local directory, S3)      |
| `packages/contracts` | Schemas shared by API and web                    |
| `packages/ui`        | UI component library                             |
| `deploy`             | Dockerfiles and Docker Compose                   |

## License

Licensed under either of [Apache License, Version 2.0](LICENSE-APACHE) or
[MIT license](LICENSE-MIT) at your option.

Unless you explicitly state otherwise, any contribution intentionally submitted for
inclusion in testRex by you, as defined in the Apache-2.0 license, shall be dual licensed
as above, without any additional terms or conditions.
