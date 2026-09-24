## Purpose

Keeps a tamper-resistant record of who changed access and structure in an organization,
so administrators can investigate and meet compliance needs.

## ADDED Requirements

### Requirement: Record security-relevant changes

The system SHALL record an audit event for: organization creation and rename, member
invite/join/removal, organization and application role changes, and application
create/rename/archive/restore. Each event MUST include actor, action, target, organization,
timestamp (UTC) and the before/after values that changed.

#### Scenario: Role change recorded

- **WHEN** an admin changes Luis's application role from `tester` to `editor`
- **THEN** an audit event records the admin as actor, Luis as target, and `tester` → `editor`

### Requirement: Audit events are append-only

Audit events SHALL NOT be editable or deletable through the application.

#### Scenario: Attempt to modify

- **WHEN** any API client attempts to update or delete an audit event
- **THEN** no such operation exists and the database role used by the app lacks UPDATE/DELETE on the table

### Requirement: View audit log

Organization owners and admins SHALL be able to view and filter the audit log by actor,
action and date range, newest first.

#### Scenario: Filter by actor

- **WHEN** an owner filters the audit log by actor "Ana"
- **THEN** only events performed by Ana are listed

#### Scenario: Member cannot view

- **WHEN** an organization `member` opens the audit log
- **THEN** access is denied with HTTP 403
