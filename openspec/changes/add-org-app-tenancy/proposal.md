## Why

Every testRex entity (test cases, scenarios, runs, repositories) belongs to an organization
and an application. Segmentation, user accounts and permissions must exist before any of
those entities, and isolation must be strong enough for the future multi-tenant cloud
edition. Retrofitting it later would mean touching every table and query.

## What Changes

- User accounts with email/password sign-in, sessions and sign-out; first user of a fresh
  self-hosted instance becomes instance administrator; public sign-up can be disabled.
- Organizations: create, rename, switch between, and invite members by link or email.
- Applications inside an organization, each with a unique short key (e.g. `CHK`) used to
  build human-readable IDs such as `CHK-TC-142` later.
- Role-based access control at two levels: organization roles and per-application roles.
- Database-enforced tenant isolation (organization_id on every tenant table + Postgres RLS).
- Audit log of membership, role and application changes.
- UI: sign-in/sign-up, onboarding (create first org and app), org switcher, application
  list, member and role management, URL scheme `/o/:orgSlug/a/:appKey/...`.

## Capabilities

### New Capabilities

- `user-authentication`: account registration, sign-in, sessions, sign-out, sign-up policy.
- `organization-management`: organizations, membership, invitations, organization roles.
- `application-management`: applications within an organization and their keys.
- `access-control`: permission model across org and application roles, and tenant isolation guarantees.
- `audit-log`: recording and viewing security-relevant changes.

### Modified Capabilities

<!-- none -->

## Impact

- New tables: users/sessions/accounts (Better Auth), organizations, memberships,
  invitations, applications, application_members, audit_events. RLS policies on all tenant tables.
- New API routes under `/api/auth/*`, `/api/orgs/*`, `/api/orgs/:org/apps/*`.
- New optional SMTP configuration; without it invitations are shared as copyable links.
- Cloud edition: users can belong to many organizations; isolation is enforced by the
  database, not only application code; organization records carry a `plan` field and quota
  hooks (no-ops for self-hosted) so billing can be attached later without schema changes.

## Non-goals

- SSO (OIDC/SAML), SCIM and 2FA. The auth layer is chosen so these can be added later.
- Billing, plans UI and quota enforcement.
- Test cases, scenarios, runs or folders (next changes).
- Custom roles; only the fixed role set below is supported.
