## MODIFIED Requirements

### Requirement: Application workspace tabs

The application home SHALL present five tabs, each at its own URL under `/o/:orgSlug/a/:appKey`:
**Test scenarios** (`/scenarios`), **Test cases** (`/test-cases`), **Test runs** (`/runs`),
**Reports** (`/reports`) and **Automation** (`/automation`). Opening the application MUST
redirect to scenarios. The active tab MUST be indicated visually and to assistive technology.

#### Scenario: Default tab

- **WHEN** a user opens `/o/acme/a/CHK`
- **THEN** the URL becomes `/o/acme/a/CHK/scenarios` and the Test scenarios tab is active

#### Scenario: Switch tabs

- **WHEN** a user on the scenarios tab selects Test cases
- **THEN** the URL becomes `/o/acme/a/CHK/test-cases` and the Test cases tab is active

#### Scenario: Tab state survives reload and sharing

- **WHEN** a user reloads or shares a URL of any tab
- **THEN** the same tab opens, including its filters in the URL

#### Scenario: Scenario count on tab

- **WHEN** application `CHK` has 24 live scenarios and 80 live test cases
- **THEN** the Test scenarios tab shows 24 and the Test cases tab shows 80

### Requirement: Keyboard shortcuts

The web app SHALL provide shortcuts: `c` create on the current list, `/` focus search, `j`/`k`
move the row selection, `Enter` open it, `g` then `s`, `c`, `r`, `d` or `a` go to scenarios,
test cases, runs, reports or automation, `e` edit the open item, `Ctrl`/`⌘`+`S` save, `Esc`
cancel or close, and `?` help. Single-key shortcuts MUST NOT fire while typing and MUST do
nothing when the action is not allowed.

#### Scenario: Create with keyboard

- **WHEN** an editor presses `c` on the test cases tab
- **THEN** the new test case form opens

#### Scenario: Typing does not trigger shortcuts

- **WHEN** a user types the letter `c` in the search box
- **THEN** the letter is entered and no form opens

#### Scenario: Save with keyboard

- **WHEN** a user presses `Ctrl+S` while editing a test case
- **THEN** the test case is saved and the browser's save dialog does not open

#### Scenario: Shortcut without permission

- **WHEN** a viewer presses `c` on the test cases tab
- **THEN** nothing happens

### Requirement: Localized interface

Every text of the workspace, scenarios, test cases, datasets, global steps, recordings, runs,
reports and AI assistance SHALL be available in English and Spanish and follow the language
switcher. Dates, durations and percentages MUST be formatted for that language. Content entered
by users and AI proposals are not translated.

#### Scenario: Spanish interface

- **WHEN** a user switches the language to Español and opens a run report
- **THEN** headings, statuses, buttons, durations and relative times appear in Spanish

## REMOVED Requirements

### Requirement: Test runs placeholder

**Reason**: Test runs are implemented by this change (`test-execution`).
**Migration**: The Test runs tab lists runs and creates them instead of showing a placeholder.
