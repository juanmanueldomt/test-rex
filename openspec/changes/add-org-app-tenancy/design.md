## Context

Builds on `bootstrap-monorepo` (Fastify API, Drizzle, `withOrg()` helper that sets
`app.org_id`). See proposal.md for motivation and the specs under `specs/` for behavior.

## Goals / Non-Goals

**Goals:**

- One permission check path used by every future route.
- Isolation that holds even when a developer forgets a `WHERE organization_id = ...`.
- An auth layer that can grow to SSO/2FA without migration pain.

**Non-Goals:**

- Custom roles, fine-grained per-folder permissions, SSO.

## Decisions

### Better Auth for identity

Better Auth provides email/password, sessions, rate limiting and an organization plugin,
and has OIDC/SAML/2FA plugins for later. Only its user/session/account tables are used;
organizations, memberships and invitations are testRex's own tables (not the plugin's) because
they need RLS, application-level roles and audit hooks.
Alternatives: Lucia (deprecated), Auth.js (weaker non-Next support), Keycloak (heavy to
deploy, contradicts easy self-hosting).

### Tenant isolation with Postgres RLS

- Two DB roles: `testrex_owner` (migrations) and `testrex_app` (runtime, not BYPASSRLS,
  not table owner).
- Every tenant table has `organization_id uuid not null`, RLS enabled and forced, and the
  policy `USING (organization_id = app_current_org())` with the same `WITH CHECK`.
  `app_current_org()` is `NULLIF(current_setting('app.org_id', true), '')::uuid`: after a
  transaction-local `set_config` ends, Postgres resets the setting to `''` (not NULL), which
  would make a plain `::uuid` cast raise an error instead of returning no rows.
- `withContext(db, { orgId, userId }, fn)` sets `app.org_id` and `app.user_id` with
  transaction-local scope (`withOrg` is the org-only shorthand). `memberships` has an extra
  SELECT-only policy `user_id = app_current_user()`, so the organization switcher can list a
  user's own memberships across organizations without bypassing RLS.
- The org pre-handler resolves `:orgSlug` through the global `organizations` table, then
  checks membership inside that organization's RLS scope; all route work runs inside
  `withOrg(orgId, …, userId)`.
- Workers run tenant jobs through `registerTenantJob`, which validates `organizationId` with
  the shared `tenantJobPayload` schema and runs the handler inside `withOrg`.
- Global tables (users, sessions, accounts, verifications, auth_failed_attempts,
  organizations) are not RLS-protected.
- The API and worker refuse to become ready when `DATABASE_URL` connects as a superuser or
  BYPASSRLS role, because RLS would silently not apply. A missing `DATABASE_MIGRATION_URL`
  only produces a warning (the runtime role then owns the schema, so RLS still applies via
  FORCE, but the audit log is not append-only at the database level).
- The job queue (pg-boss) connects with `DATABASE_MIGRATION_URL`: it creates and migrates its
  own schema and per-queue tables, and holds no tenant rows outside job payloads.
- `_testrex_migrations` is readable by every role (readiness checks) but writable only by
  the owner.
- Application keys are additionally protected by a `BEFORE UPDATE OF key` trigger.
  Alternative: schema-per-tenant. Rejected: migration fan-out and connection pooling issues
  at cloud scale.

### Database roles in docker-compose

`deploy/postgres/init-roles.sh` runs on first initialization, creates `testrex_owner` (owns
the database) and `testrex_app`, and disables the superuser's password so it is reachable
only through the container's local socket. Both roles use `POSTGRES_PASSWORD`: the split
protects against privilege escalation from SQL executed by the application, not against
credential theft (the app container holds both URLs to migrate on startup), so a second
secret would add setup friction without adding protection.

### Permission model

`packages/contracts` defines `Permission` constants (e.g. `app.read`, `execution.write`,
`testcase.write`, `app.manage`) and a static role→permissions map matching the spec table.
Fastify preHandlers from `createGuards()` (`guards.org`, `guards.app`,
`guards.orgPermission(p)`, `guards.appPermission(p)`, `guards.writableApp`) resolve the
effective app role (owner/admin ⇒ manager) and return 404 for no membership and 403 for an
insufficient role; archived applications answer 409 to writes.
The web app receives the effective permission set in the context payload to hide or disable UI.

### URL and identity scheme

`/o/:orgSlug/a/:appKey/...` in the SPA; API mirrors it: `/api/orgs/:orgSlug/apps/:appKey/...`.
Application keys are immutable; a per-application `sequence` table will issue item numbers
(`CHK-TC-142`) in later changes.

### Audit log

`audit_events` table with RLS, written in the same transaction as the change through an
`audit(tx, event)` helper. `testrex_app` receives only INSERT/SELECT grants.
Partitioning by month is deferred until cloud volume requires it.

### Invitations and email

Invitation links carry `<organizationId>.<secret>`: the secret is 32 random bytes, stored
only as its SHA-256 hash, and the organization id lets the server look the invitation up
inside that organization's RLS scope without any bypass. Invitations expire after 7 days and
are consumed with a conditional update, so they are single-use under concurrency. A new
invitation for the same address revokes the previous pending one. Email is sent through a
`Mailer` interface: SMTP (Nodemailer) when `SMTP_URL` is set, otherwise the API returns the
link for the UI to show; if sending fails the link is returned as a fallback.

### Sign-up policy and brute-force protection

`ALLOW_SIGNUP` defaults to `false` (secure default for self-hosting): the first account is
always allowed and becomes instance administrator; afterwards registration needs a valid
invitation for the same email, passed in the `x-testrex-invitation` header. The check runs in
`packages/auth` before Better Auth, and a `user.create.before` hook fails closed for any
user creation that did not pass it. Failed sign-ins are recorded per email in
`auth_failed_attempts` (shared by all API replicas, unlike an in-memory limiter); 10 failures
within 15 minutes lock that email until the window passes, for known and unknown emails
alike so the lockout reveals nothing.

### Cross-site requests

Besides SameSite=Lax session cookies, non-GET `/api` requests carrying an `Origin` header
that differs from `PUBLIC_URL` are rejected (Better Auth applies its own origin check to
`/api/auth/*`). `PUBLIC_URL` is also the base for invitation links and decides whether
cookies are marked Secure.

### Cloud readiness

`organizations.plan` (default `self_hosted`) and a `QuotaService` interface with a no-op
implementation are added now; nothing enforces them yet.

### UX

Onboarding wizard: create org, create first app, invite teammates (skippable). The org switcher
and the app switcher live in the top bar, and both are reachable via ⌘K. Members table with
inline role dropdowns. All forms validate with the shared Zod schemas, whose messages are
i18n keys translated in the web app (en, es). Role pickers are native `<select>` elements
for keyboard and screen-reader support. The "new application" dialog is URL-driven
(`?new=app`) so ⌘K and the app switcher can open it. Light-mode primary is emerald-700 to
meet WCAG AA contrast with white text; every page is checked with axe in CI (light and dark).

## Risks / Trade-offs

- [RLS misconfiguration silently disables isolation] → Automated test suite that, for every
  table with `organization_id`, asserts RLS is enabled and forced and that cross-tenant
  reads, writes and unset-context queries fail. Runs in CI.
- [Connection pool leaking `app.org_id` between requests] → Only `SET LOCAL` inside
  transactions; test that a subsequent request without context sees nothing.
- [Better Auth API changes] → Wrapped behind `packages/auth` so the rest of the code does not
  depend on it directly.
- [404-vs-403 semantics confuse users] → UI shows a friendly "not found or no access" page.

## Migration Plan

Additive migrations only. The runtime role split requires `DATABASE_URL` (app role) and
`DATABASE_MIGRATION_URL` (owner role); in docker-compose both roles are created by an init
script (fresh volumes only; there are no earlier releases to upgrade). If only
`DATABASE_URL` is provided the app uses it for migrations too, with a warning, as long as that
role does not bypass RLS; otherwise it refuses to become ready.
