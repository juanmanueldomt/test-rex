## Purpose

Test cases describe one check of a scenario as ordered steps with expected results, either for
a person to execute or for testRex to run with Playwright. This capability covers their data,
links to scenarios, versions, catalog, permissions and audit.

## ADDED Requirements

### Requirement: Test case keys

Each test case SHALL receive a key `<APPKEY>-TC-<n>` from a per-application counter starting at

1. Keys MUST be unique within the application, MUST NOT change and MUST NOT be reused, even
   after deletion.

#### Scenario: First test case

- **WHEN** an editor creates the first test case in application `CHK`
- **THEN** it receives key `CHK-TC-1`

#### Scenario: Keys are not reused

- **WHEN** `CHK-TC-4` is deleted and a new test case is created
- **THEN** the new test case receives `CHK-TC-5`

### Requirement: Test case fields

A test case SHALL have a title (1–200 characters), a status (`draft`, `ready`, `deprecated`;
default `draft`), a priority (`critical`, `high`, `medium`, `low`; default `medium`), 0–20
tags, a rich-text description and preconditions (up to 100,000 characters each), an optional
dataset of the same application and 0–200 ordered steps. Author, creation time, last editor and
update time MUST be exposed.

#### Scenario: Create a test case

- **WHEN** an editor submits title "Apply a valid coupon", scenario `CHK-TS-3`, tag `smoke` and two steps
- **THEN** the test case is created as `draft`, priority `medium`, automated, with version v1 and the editor as author

#### Scenario: Title required

- **WHEN** an editor submits a test case without title
- **THEN** nothing is created and the title is reported as required

### Requirement: Linked scenarios

Every test case SHALL be linked to between 1 and 20 scenarios of its own application, and a
scenario MAY be linked to any number of test cases. Saving a test case without scenarios, or
with a scenario of another application, MUST be rejected. Links to scenarios deleted later MUST
be kept and shown as deleted.

#### Scenario: One test case, two scenarios

- **WHEN** an editor links `CHK-TC-7` to `CHK-TS-1` and `CHK-TS-2`
- **THEN** both scenarios list `CHK-TC-7` among their test cases and count it

#### Scenario: No scenario

- **WHEN** an editor removes the last scenario of a test case and saves
- **THEN** the save is rejected with a message that at least one scenario is required

### Requirement: Execution mode

A test case SHALL have an execution mode, `automated` or `manual`, and new test cases MUST
default to `automated`. Automated test cases MUST only contain steps that can be executed
automatically; a step without an automatic action MUST be rejected in automated mode. Manual
test cases MAY contain any step.

#### Scenario: Default mode

- **WHEN** an editor creates a test case without choosing a mode
- **THEN** its mode is `automated`

#### Scenario: Manual-only step in an automated test case

- **WHEN** an editor saves an automated test case with a step that only has a description
- **THEN** the save is rejected and that step is reported as needing an action

### Requirement: Steps and expected results

Each step SHALL have a stable identifier, an action, an optional description (up to 2,000
characters) and an optional expected result (up to 2,000 characters). Steps with an automatic
action MUST also carry the locator and value that action needs. When a step has no description,
the interface MUST describe it from its action, locator and value.

#### Scenario: Readable automated step

- **WHEN** a step clicks the button named "Apply" and has no description
- **THEN** it is shown as `Click button "Apply"`

#### Scenario: Missing locator

- **WHEN** an editor saves a click step without a locator
- **THEN** the save is rejected and the step is reported as needing a target

### Requirement: Emphasized assertions

Assertion steps and expected results SHALL be displayed with emphasis wherever a test case's
steps are shown (test case page, editor, manual runner, run report and versions): a distinct
visual treatment that does not rely on color alone and an accessible label naming them as
expected results.

#### Scenario: Assertion in the step list

- **WHEN** a user opens a test case whose step 3 expects the text "Discount applied" to be visible
- **THEN** step 3 is highlighted as an expected result with a check icon and the label "Expected"

### Requirement: Test case versions

Every save that changes a test case SHALL append an immutable version (v1, v2, …) holding a
full snapshot, the changed fields, the author and the source (`editor`, `ai`, `recording`,
`restore`). Saving without changes MUST NOT create a version. Users MUST be able to list
versions, open one read-only and restore it, which creates a new version.

#### Scenario: Version history

- **WHEN** an editor saves `CHK-TC-2` three times with changes
- **THEN** its history lists v1 to v4 with author, time, source and changed fields

#### Scenario: Restore a version

- **WHEN** an editor restores v2 of `CHK-TC-2` whose current version is v4
- **THEN** v5 is created with the content of v2 and source `restore`

### Requirement: Edit test case

Users with permission SHALL be able to change every field except the key and author. Saving
MUST be rejected when the test case changed since the editor opened it, naming who changed it
and when, and keeping the unsaved input. Leaving the form with unsaved changes MUST ask for
confirmation.

#### Scenario: Conflicting edit

- **WHEN** Ana and Luis open `CHK-TC-2`, Ana saves and then Luis saves
- **THEN** Luis's save is rejected with a message that Ana changed it

### Requirement: Delete and restore test case

Editors SHALL be able to delete a test case after confirming. Deletion MUST be soft: the test
case leaves the catalog and new runs, stays readable by URL with a deleted banner, keeps its
key, versions and past results, and can be restored.

#### Scenario: Delete

- **WHEN** an editor deletes `CHK-TC-2`
- **THEN** it no longer appears in the catalog or in run selections, and its URL shows it read-only with a restore button

### Requirement: Test case catalog

The Test cases tab SHALL list test cases with key, title, mode, status, priority, scenarios,
step count, dataset and last result, with search (key, title, steps text), filters (status,
mode, priority, scenario, tag, deleted), sorting and server-side pagination kept in the URL.

#### Scenario: Filter by scenario and mode

- **WHEN** a user filters by scenario `CHK-TS-1` and mode manual
- **THEN** only manual test cases linked to `CHK-TS-1` are listed and the URL keeps both filters

#### Scenario: Last result

- **WHEN** `CHK-TC-3` failed in the most recent run that executed it
- **THEN** the catalog shows "Failed" as its last result with the run key

### Requirement: Test case permissions

Creating, editing, deleting and restoring test cases SHALL require the application `manager`
or `editor` role (`testcase.write`). Every role with access MUST be able to read them. Archived
applications MUST reject changes, and the interface MUST hide actions the user cannot perform.

#### Scenario: Tester cannot edit

- **WHEN** a tester sends a request to update `CHK-TC-2`
- **THEN** the request is rejected with HTTP 403

#### Scenario: Other application

- **WHEN** a user requests `CHK-TC-2` through application `PAY`
- **THEN** the response is HTTP 404

### Requirement: Test case audit

Every change to test cases SHALL record an audit event with actor, action, target
(`CHK-TC-2 · title`), time and changed values; rich text and steps MUST be recorded as changed
with the version numbers rather than their content.

#### Scenario: Created audited

- **WHEN** an editor creates `CHK-TC-1`
- **THEN** the audit log shows `test_case.created` for `CHK-TC-1 · <title>`
