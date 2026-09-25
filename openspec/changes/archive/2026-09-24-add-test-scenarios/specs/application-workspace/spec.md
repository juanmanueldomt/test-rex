## Purpose

Turns an application's home page into a workspace where people switch between test scenarios
and test runs, and gives testRex a consistent, discoverable and accessible set of keyboard
shortcuts.

## ADDED Requirements

### Requirement: Application workspace tabs

The application home SHALL present two tabs, **Test scenarios** and **Test runs**, each at its
own URL (`/o/:orgSlug/a/:appKey/scenarios` and `/o/:orgSlug/a/:appKey/runs`). Opening
`/o/:orgSlug/a/:appKey` MUST redirect to the scenarios tab. The active tab MUST be indicated
visually and to assistive technology, and switching tabs MUST NOT reload the page.

#### Scenario: Default tab

- **WHEN** a user opens `/o/acme/a/CHK`
- **THEN** the URL becomes `/o/acme/a/CHK/scenarios` and the Test scenarios tab is active

#### Scenario: Switch tabs

- **WHEN** a user on the scenarios tab selects Test runs
- **THEN** the URL becomes `/o/acme/a/CHK/runs` and the Test runs tab is active

#### Scenario: Tab state survives reload and sharing

- **WHEN** a user reloads or shares a URL of either tab
- **THEN** the same tab opens, including its filters in the URL

#### Scenario: Scenario count on tab

- **WHEN** application `CHK` has 24 scenarios that are not deleted
- **THEN** the Test scenarios tab label shows 24

### Requirement: Test runs placeholder

The Test runs tab SHALL show an "under construction" message explaining that test runs are
coming, and MUST NOT offer any action that creates data.

#### Scenario: Open test runs

- **WHEN** a user opens the Test runs tab
- **THEN** an under-construction message is shown and no create button is present

### Requirement: Keyboard shortcuts

The web app SHALL provide keyboard shortcuts for frequent actions: `c` new scenario, `/` focus
search, `j`/`k` move the row selection, `Enter` open the selected row, `g` then `s` go to test
scenarios, `g` then `r` go to test runs, `e` edit the open scenario, `Ctrl`/`⌘`+`S` save,
`Esc` cancel or close, and `?` open the shortcut help. Single-key shortcuts MUST NOT fire while
focus is in a text field, editor or select. A shortcut MUST do nothing when its action is not
available to the user (for example `c` without permission to create).

#### Scenario: Create with keyboard

- **WHEN** an editor presses `c` on the scenarios tab
- **THEN** the new scenario form opens

#### Scenario: Typing does not trigger shortcuts

- **WHEN** a user types the letter `c` in the search box
- **THEN** the letter is entered and no form opens

#### Scenario: Save with keyboard

- **WHEN** a user presses `Ctrl+S` while editing a scenario
- **THEN** the scenario is saved and the browser's save dialog does not open

#### Scenario: Shortcut without permission

- **WHEN** a viewer presses `c`
- **THEN** nothing happens

### Requirement: Shortcut help and opt-out

Pressing `?` SHALL open a dialog listing the shortcuts available on the current page in the
user's language. Users MUST be able to turn single-key shortcuts off (WCAG 2.1.4); the choice
MUST persist in that browser, and modifier shortcuts and `Esc` MUST keep working.

#### Scenario: Help dialog

- **WHEN** a user presses `?` on the scenarios tab
- **THEN** a dialog lists the shortcuts for that page and `Esc` closes it

#### Scenario: Disable single-key shortcuts

- **WHEN** a user turns off single-key shortcuts and later presses `c`
- **THEN** nothing happens, while `Ctrl+S` still saves in the editor

### Requirement: Localized interface

Every text introduced by the workspace, scenarios, revisions, comments, requirement links and
attachments SHALL be available in English and Spanish and follow the language chosen in the
language switcher. Dates and relative times MUST be formatted for that language. Scenario
content entered by users is not translated.

#### Scenario: Spanish interface

- **WHEN** a user switches the language to Español and opens the scenarios tab
- **THEN** tabs, column headers, filters, buttons, empty states and relative times appear in Spanish
