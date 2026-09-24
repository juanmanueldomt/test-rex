## Purpose

Defines who can see and change what across organizations and applications, and guarantees
that data from one organization can never be reached from another.

## ADDED Requirements

### Requirement: Application roles

Organization `member`s SHALL receive access per application with one of the roles
`manager`, `editor`, `tester` or `viewer`. Organization `owner`s and `admin`s MUST
implicitly have `manager` rights on every application in their organization.

| Capability                         | manager | editor | tester | viewer |
| ---------------------------------- | ------- | ------ | ------ | ------ |
| View application content           | yes     | yes    | yes    | yes    |
| Record test execution results      | yes     | yes    | yes    | no     |
| Create/edit test cases & scenarios | yes     | yes    | no     | no     |
| Manage app members & settings      | yes     | no     | no     | no     |

#### Scenario: Viewer cannot edit

- **WHEN** a user with `viewer` role on `CHK` attempts a write operation in `CHK`
- **THEN** the request is rejected with HTTP 403

#### Scenario: Admin implicit access

- **WHEN** an organization admin opens an application where they have no explicit role
- **THEN** they have manager rights

#### Scenario: Manager grants access

- **WHEN** an application manager adds organization member Luis as `tester`
- **THEN** Luis can see the application and an audit event is recorded

### Requirement: No access means not found

Requests for resources in an organization or application the user cannot access SHALL
respond as if the resource does not exist.

#### Scenario: Probing another organization

- **WHEN** a user requests `/api/orgs/other-org/apps` for an organization they do not belong to
- **THEN** the response is HTTP 404 without revealing whether the organization exists

### Requirement: Database-enforced tenant isolation

The system SHALL enforce organization isolation at the database layer so that a query
executed for one organization MUST NOT return or modify rows of another organization, even
if application code omits an organization filter.

#### Scenario: Missing filter in application code

- **WHEN** a query without an organization filter runs in the context of organization A
- **THEN** only rows belonging to organization A are returned

#### Scenario: No organization context

- **WHEN** a tenant-table query runs without any organization context set
- **THEN** no rows are returned and writes are rejected

#### Scenario: Cross-tenant write

- **WHEN** code in organization A's context tries to insert a row with organization B's id
- **THEN** the database rejects the insert
