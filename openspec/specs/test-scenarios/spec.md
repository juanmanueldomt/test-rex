# test-scenarios Specification

## Purpose

Test scenarios describe a feature or flow under test in detail and own the test cases that
verify it, the way a Playwright `spec.ts` file owns its tests. This capability covers creating,
editing, classifying and deleting scenarios.

## Requirements

### Requirement: Scenario keys

Each scenario SHALL receive a key `<APPKEY>-TS-<n>` when created, where `n` is the next number
of a per-application counter starting at 1. Keys MUST be unique within the application, MUST
NOT change, and MUST NOT be reused, even after a scenario is deleted. Concurrent creations MUST
receive distinct numbers.

#### Scenario: First scenario

- **WHEN** an editor creates the first scenario in application `CHK`
- **THEN** it receives key `CHK-TS-1`

#### Scenario: Keys are not reused

- **WHEN** `CHK-TS-5` is the latest scenario, it is deleted, and a new scenario is created
- **THEN** the new scenario receives `CHK-TS-6`

#### Scenario: Concurrent creation

- **WHEN** two editors create scenarios in `CHK` at the same moment
- **THEN** both succeed with different keys

### Requirement: Scenario fields

A scenario SHALL have: a title (required, 1–200 characters), a status (`draft`, `ready`,
`deprecated`; default `draft`), a priority (`critical`, `high`, `medium`, `low`; default
`medium`), an optional module, 0–20 tags, an optional supported version range, a rich-text
**description** and a rich-text **steps to reach** section (each up to 100,000 characters).
The system MUST also expose the author (creator), creation time, last editor and last update
time. Rich text MUST support headings, lists, checklists, bold/italic, inline code, code blocks,
tables, links and images, so that steps to reach can be organized in several headed sections.

#### Scenario: Create a scenario

- **WHEN** an editor submits title "Guest checkout with coupon", module Checkout, tags `smoke` and `cart`, and a description
- **THEN** the scenario is created as `draft`, priority `medium`, with the editor as author, and the scenario page opens

#### Scenario: Title required

- **WHEN** an editor submits the form with an empty title
- **THEN** the scenario is not created and the title field shows a required-field message

#### Scenario: Steps to reach with sections

- **WHEN** an editor writes steps to reach with headings "Test data" and "Navigation", each followed by a list
- **THEN** after saving and reopening, both headed sections and their lists are shown unchanged

### Requirement: Tags

Tags SHALL belong to an application and be created automatically the first time they are
entered on a scenario. Tag names MUST be normalized: trimmed, lowercased and stripped of a
leading `@`; they MUST then match 1–40 characters of letters, digits, `.`, `_` or `-`, starting
with a letter or digit. Tags MUST be displayed with a leading `@` (Playwright tag syntax). The
tag input MUST suggest existing tags of the application as the user types.

#### Scenario: Automatic creation

- **WHEN** an editor types `@Payments` on a scenario in `CHK` where no such tag exists and saves
- **THEN** tag `payments` is created in `CHK` and shown as `@payments`

#### Scenario: Reuse existing tag

- **WHEN** tag `smoke` exists and an editor types `SMOKE`
- **THEN** the existing tag is attached and no duplicate is created

#### Scenario: Invalid tag

- **WHEN** an editor types `smoke test`
- **THEN** the tag is rejected with a message describing the allowed characters

#### Scenario: Tags are per application

- **WHEN** tag `smoke` exists in `CHK` and an editor opens the tag input in application `PAY`
- **THEN** `smoke` is not suggested unless `PAY` has its own `smoke` tag

### Requirement: Modules

Modules SHALL be a flat, per-application list used to group scenarios; each scenario belongs
to at most one module. Editors MUST be able to create a module inline from the module picker
and rename modules. Module names MUST be 1–60 characters and unique within the application
ignoring case. A module that is assigned to any scenario MUST NOT be deletable.

#### Scenario: Create module inline

- **WHEN** an editor types "Payments" in the module picker and no such module exists
- **THEN** the picker offers "Create Payments", and choosing it creates and selects the module

#### Scenario: Duplicate module name

- **WHEN** an editor creates module "checkout" and "Checkout" already exists
- **THEN** creation is rejected and the existing module is offered

#### Scenario: Module in use

- **WHEN** an editor deletes module Checkout that is assigned to a scenario
- **THEN** deletion is rejected with a message naming how many scenarios use it

### Requirement: Supported version range

A scenario SHALL have an optional **from** version and an optional **up to** version of the
product under test, both inclusive. Versions MUST consist of 1 to 4 dot-separated
non-negative integers (for example `3`, `3.2`, `3.2.1`) and MUST be compared numerically part
by part, treating missing parts as 0. When both are present, **from** MUST NOT be greater than
**up to**. An empty bound MUST mean no limit on that side.

#### Scenario: Valid range

- **WHEN** an editor sets from `2.4` and up to `3.10`
- **THEN** the range is saved and `3.9` is considered inside it

#### Scenario: Inverted range

- **WHEN** an editor sets from `3.2` and up to `3.1`
- **THEN** the save is rejected with a message that from must not exceed up to

#### Scenario: Invalid version text

- **WHEN** an editor sets up to `v3.x`
- **THEN** the field shows a format error with an example of a valid version

#### Scenario: Open-ended range

- **WHEN** an editor sets only from `2.4`
- **THEN** the scenario is considered supported for `2.4` and every later version

### Requirement: Edit scenario

Users with permission to edit SHALL be able to change every field except the key and author.
Saving MUST be rejected when the scenario was changed by someone else since the editor opened
it; the message MUST name who changed it and when, and the editor's unsaved input MUST be kept
so it can be copied. Leaving the form with unsaved changes MUST ask for confirmation.

#### Scenario: Edit and save

- **WHEN** an editor changes the status of `CHK-TS-12` from `draft` to `ready` and saves
- **THEN** the status is updated and the last editor and update time reflect the change

#### Scenario: Conflicting edit

- **WHEN** Ana and Luis open `CHK-TS-12`, Ana saves, and then Luis saves
- **THEN** Luis's save is rejected with a message that Ana changed it, and his input remains in the form

#### Scenario: Unsaved changes

- **WHEN** an editor with unsaved changes navigates to another tab
- **THEN** a confirmation asks whether to discard the changes

### Requirement: Delete and restore scenario

Editors SHALL be able to delete a scenario after confirming. Deletion MUST be soft: the scenario
disappears from the default grid, remains reachable by its URL with a "deleted" banner in
read-only mode, and can be restored by an editor. Its key, revisions, comments and attachments
MUST be preserved.

#### Scenario: Delete

- **WHEN** an editor deletes `CHK-TS-12` and confirms
- **THEN** it no longer appears in the grid, and opening its URL shows it read-only with a deleted banner and a restore button

#### Scenario: Restore

- **WHEN** an editor restores deleted scenario `CHK-TS-12`
- **THEN** it appears in the grid again with the same key and history

### Requirement: Scenario owns its test cases

Each test case SHALL belong to exactly one scenario, like a test inside a Playwright spec file.
Until test case management exists, the scenario page MUST show a Test cases tab with a count of
0 and a message that test cases are coming, and the grid MUST show 0 test cases.

#### Scenario: Test cases placeholder

- **WHEN** a user opens scenario `CHK-TS-12`
- **THEN** a "Test cases (0)" tab is shown with a coming-soon message and no create action

### Requirement: Scenario permissions

Creating, editing, deleting and restoring scenarios, and managing their tags, modules,
requirement links and attachments, SHALL require the application `manager` or `editor` role.
Every role with access to the application MUST be able to read scenarios. Archived
applications MUST reject all scenario changes. The interface MUST hide actions the user cannot
perform.

#### Scenario: Tester cannot edit

- **WHEN** a user with the `tester` role sends a request to update `CHK-TS-12`
- **THEN** the request is rejected with HTTP 403 and the scenario page shows no edit button

#### Scenario: Viewer can read

- **WHEN** a `viewer` opens `CHK-TS-12`
- **THEN** all fields, history, comments, links and attachments are visible read-only

#### Scenario: Archived application

- **WHEN** an editor tries to save a scenario in an archived application
- **THEN** the change is rejected with a message that the application is archived

#### Scenario: Other organization

- **WHEN** a user requests a scenario of an application in another organization
- **THEN** the response is HTTP 404

### Requirement: Scenario audit

Every change to scenarios, tags, modules, comments, requirement links and attachments SHALL
record an audit event with actor, action, target (scenario key or item name), time and the
changed values; rich-text changes MUST be recorded as "changed" with the revision numbers
rather than the full text.

#### Scenario: Status change audited

- **WHEN** an editor changes `CHK-TS-12` from `draft` to `ready`
- **THEN** the organization audit log shows the editor, `scenario.updated`, `CHK-TS-12` and `draft → ready`
