## 1. Database foundation

- [x] 1.1 Add Postgres init script creating `testrex_owner` and `testrex_app` roles, and support `DATABASE_MIGRATION_URL`; verify the app connects as the non-owner role in compose
- [x] 1.2 Create tables organizations, memberships, invitations, applications, application_members, audit_events with UUIDv7 ids; verify `pnpm db:generate` and migration apply cleanly
- [x] 1.3 Add RLS policies (ENABLE + FORCE) on all tenant tables and INSERT/SELECT-only grant on audit_events; verify integration tests for cross-tenant read, cross-tenant insert and unset-context queries
- [x] 1.4 Add a generic CI test that enumerates every table with `organization_id` and asserts RLS is enabled and forced; verify it fails when a policy is removed

## 2. Authentication

- [x] 2.1 Create `packages/auth` wrapping Better Auth (email/password, sessions, rate limit) mounted at `/api/auth/*`; verify registration/sign-in/sign-out integration tests
- [x] 2.2 Implement first-user-is-instance-admin and `ALLOW_SIGNUP` policy; verify tests for empty instance, disabled sign-up with and without invitation
- [x] 2.3 Implement brute-force protection (10 failures / 15 min per email) and generic error messages; verify test for lockout and message text

## 3. Organizations and applications API

- [x] 3.1 Implement org context pre-handler (slug → org + membership, 404 when not a member) and `withOrg` wrapping; verify tests for member, non-member and nonexistent org returning identical 404
- [x] 3.2 Implement permission constants, role→permission map and `requirePermission`; verify table-driven unit tests covering every role × permission cell from the spec
- [x] 3.3 Organization CRUD, slug validation and suggestion, member role changes and last-owner protection; verify tests for each spec scenario
- [x] 3.4 Invitations: hashed tokens, 7-day expiry, accept flow, wrong-account handling, `Mailer` interface with SMTP and link-only modes; verify tests for accept, expired, wrong account and no-SMTP
- [x] 3.5 Application CRUD with key validation, suggestion, immutability, archive/restore and read-only enforcement; verify tests for each spec scenario
- [x] 3.6 Application member management with the four application roles; verify viewer 403 and admin implicit-manager tests
- [x] 3.7 `audit()` helper writing within the same transaction for every mutating route above, and audit list endpoint with filters; verify tests that each action creates the expected event and members get 403

## 4. Web UI

- [x] 4.1 Sign-in, sign-up and invitation acceptance pages with shared Zod validation; verify Playwright e2e for register → onboarding
- [x] 4.2 Onboarding wizard (org → first app → invite, skippable); verify e2e completes and lands on the application home
- [x] 4.3 App shell: top bar with org switcher, app switcher, ⌘K palette, dark mode, en/es i18n; verify e2e switching orgs updates URL and data
- [x] 4.4 Organization settings: members table with inline roles, invitations with copy link, audit log view with filters; verify e2e for invite-by-link and role change
- [x] 4.5 Application list and settings: create, rename, archive/restore, app members; verify e2e and that controls are hidden without permission
- [x] 4.6 Friendly "not found or no access" page; verify e2e visiting another org's URL
- [x] 4.7 Accessibility check (axe) on all new pages; verify no serious or critical violations in CI

## 5. Cloud-readiness hooks

- [x] 5.1 Add `organizations.plan` and a no-op `QuotaService` interface called on org/app/member creation; verify unit test that the no-op allows everything
- [x] 5.2 Require `organizationId` in the base job payload schema and run worker handlers inside `withOrg`; verify a test job cannot read another org's data
