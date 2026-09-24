## Purpose

Lets an operator run a complete testRex instance with a single command and know whether it
is healthy, correctly configured and which version is running.

## ADDED Requirements

### Requirement: Single-command startup

The system SHALL start all required services (web/API, worker, database) with one
`docker compose up` command using the compose file shipped in the repository, with no
additional manual steps other than providing a secrets `.env` file.

#### Scenario: Fresh install starts

- **WHEN** an operator copies `.env.example` to `.env`, sets the required secrets and runs `docker compose up -d`
- **THEN** within 120 seconds the web UI is reachable on the configured port and all services report healthy

#### Scenario: Data survives restart

- **WHEN** the operator runs `docker compose down` followed by `docker compose up -d`
- **THEN** all previously stored data is still present

### Requirement: Startup configuration validation

The system SHALL validate its configuration at startup and MUST refuse to start when a
required setting is missing or invalid, reporting every offending setting by name.

#### Scenario: Missing required secret

- **WHEN** the API starts without `APP_SECRET` set
- **THEN** the process exits with a non-zero code and logs an error naming `APP_SECRET`

#### Scenario: Multiple invalid settings

- **WHEN** the API starts with an invalid `DATABASE_URL` and a non-numeric `PORT`
- **THEN** the error output lists both `DATABASE_URL` and `PORT`

#### Scenario: Secrets are not logged

- **WHEN** the system logs its effective configuration at startup
- **THEN** secret values are redacted

### Requirement: Automatic schema migration

The system SHALL apply pending database migrations automatically before accepting traffic,
and concurrent instances MUST NOT apply the same migration twice.

#### Scenario: Upgrade applies migrations

- **WHEN** an operator starts a newer image against a database created by an older version
- **THEN** pending migrations are applied before the API reports ready

#### Scenario: Concurrent replicas

- **WHEN** two API instances start at the same time against the same database
- **THEN** each migration is applied exactly once and both instances become ready

#### Scenario: Failed migration

- **WHEN** a migration fails
- **THEN** the instance does not report ready and logs the failing migration name

### Requirement: Health and version reporting

The API and worker SHALL each expose a liveness endpoint and a readiness endpoint, and the
API SHALL expose the running application version.

#### Scenario: Ready only when dependencies are reachable

- **WHEN** the database is unreachable
- **THEN** the readiness endpoint responds with HTTP 503 while the liveness endpoint responds with HTTP 200

#### Scenario: Version is reported

- **WHEN** a client requests the version endpoint
- **THEN** the response contains the SemVer version and the git commit of the running build
