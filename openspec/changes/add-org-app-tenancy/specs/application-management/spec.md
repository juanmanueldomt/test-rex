## Purpose

Applications segment an organization's testing work by product or system under test; each
application owns its own test cases, scenarios, runs and repositories.

## ADDED Requirements

### Requirement: Create application

Organization owners and admins SHALL be able to create applications with a name, optional
description and a key. Keys MUST be 2–10 uppercase letters or digits, start with a letter,
and be unique within the organization.

#### Scenario: Create application

- **WHEN** an admin creates application "Checkout Web" with key `CHK`
- **THEN** the application is created and reachable at `/o/:orgSlug/a/CHK`

#### Scenario: Key suggested from name

- **WHEN** an admin types the name "Checkout Web" without choosing a key
- **THEN** the form suggests key `CW`

#### Scenario: Duplicate key in same organization

- **WHEN** an admin creates an application with key `CHK` and `CHK` already exists in that organization
- **THEN** creation is rejected with a message that the key is in use

#### Scenario: Same key in different organizations

- **WHEN** two different organizations each create an application with key `CHK`
- **THEN** both succeed

### Requirement: Application key immutability

An application's key SHALL NOT change after creation, because it is embedded in the
identifiers of its items; name and description MAY be edited.

#### Scenario: Rename application

- **WHEN** an admin renames "Checkout Web" to "Checkout"
- **THEN** the name changes and the key remains `CHK`

### Requirement: Archive application

Owners and admins SHALL be able to archive and restore applications. Archived applications
MUST be read-only and hidden from default lists.

#### Scenario: Archived application is read-only

- **WHEN** a user tries to modify anything in an archived application
- **THEN** the change is rejected with a message that the application is archived

#### Scenario: Restore

- **WHEN** an admin restores an archived application
- **THEN** it becomes editable and visible again

### Requirement: Application list

Users SHALL see only the applications they have access to in the current organization.

#### Scenario: Restricted member

- **WHEN** a `member` with access to only `CHK` opens the application list
- **THEN** only `CHK` is shown
