## Purpose

Scenario revisions keep an immutable record of every version of a scenario's content, so
people can see who changed what, compare and restore versions, and future test runs can pin
the exact revision they executed.

## ADDED Requirements

### Requirement: Revision on every change

Creating a scenario SHALL create revision 1. Each later save that changes at least one
revisioned field (title, status, priority, module, tags, supported version range, description,
steps to reach) MUST create the next revision number. A save that changes nothing MUST NOT
create a revision. Revisions MUST record their author and time, MUST be immutable, and MUST NOT
be deleted, even when the scenario is deleted. Comments, requirement links and attachments are
not part of revisions.

#### Scenario: First revision

- **WHEN** an editor creates `CHK-TS-12`
- **THEN** it has revision r1 authored by the editor

#### Scenario: Change creates a revision

- **WHEN** an editor changes the title of `CHK-TS-12` at r3 and saves
- **THEN** r4 is created and becomes the current revision

#### Scenario: No-op save

- **WHEN** an editor saves `CHK-TS-12` without changing anything
- **THEN** no new revision is created

#### Scenario: Revisions cannot be modified

- **WHEN** any client attempts to change or delete revision r2 through the API
- **THEN** no such operation exists

### Requirement: Revision history

The scenario page SHALL have a History tab listing revisions newest first, each with its
number, author, relative time and a summary of changed fields (for example
"status: draft → ready; description changed"). The current revision number MUST be shown next to
the scenario key.

#### Scenario: History list

- **WHEN** a user opens the History tab of `CHK-TS-12` with 4 revisions
- **THEN** r4, r3, r2 and r1 are listed with author, time and changed fields

### Requirement: View a revision

Users SHALL be able to open any revision read-only at a stable URL
(`/o/:orgSlug/a/:appKey/scenarios/:scenarioKey/revisions/:n`), showing all revisioned fields as
they were, with a banner indicating it is not the current revision.

#### Scenario: Open old revision

- **WHEN** a user opens r2 of `CHK-TS-12`
- **THEN** the title, fields and rich text of r2 are shown read-only with a "viewing r2 of 4" banner

#### Scenario: Unknown revision

- **WHEN** a user opens r9 of a scenario that has 4 revisions
- **THEN** a not-found message is shown

### Requirement: Compare revisions

Users SHALL be able to compare any two revisions of a scenario. The comparison MUST list changed
fields with old and new values, and MUST show description and steps to reach as a text diff
with added and removed content marked in a way that does not rely on color alone.

#### Scenario: Compare r2 and r4

- **WHEN** a user compares r2 with r4 of `CHK-TS-12`
- **THEN** changed fields show old and new values and the description shows removed and added lines

### Requirement: Restore a revision

Editors SHALL be able to restore an earlier revision. Restoring MUST create a new revision whose
revisioned fields equal the restored one, MUST keep all existing revisions, and MUST recreate
tags or modules that no longer exist. Restoring MUST be subject to the same conflict check as an
edit.

#### Scenario: Restore r2

- **WHEN** an editor restores r2 of `CHK-TS-12`, whose current revision is r4
- **THEN** r5 is created with the content of r2 and r1–r4 are unchanged

#### Scenario: Viewer cannot restore

- **WHEN** a `viewer` opens r2
- **THEN** no restore action is shown and a restore request is rejected with HTTP 403

### Requirement: Revisions are referenceable

Each revision SHALL have a stable identifier that other records (such as future test runs) can
reference, and the revision's content MUST remain retrievable by that identifier after later
edits, deletion of the scenario, or renaming of its module.

#### Scenario: Content preserved after deletion

- **WHEN** scenario `CHK-TS-12` at r4 is deleted
- **THEN** revision r4 can still be retrieved with its original content
