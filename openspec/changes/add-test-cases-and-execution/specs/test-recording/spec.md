## Purpose

Recordings turn interactions with the application under test into automated steps, either in
testRex's own recorder (a browser driven in the worker through a live view) or by importing
code recorded locally with Playwright codegen.

## ADDED Requirements

### Requirement: Recording sessions

Editors SHALL be able to start a recording session from a test case or from the test case
editor with a start URL (default: the automation base URL). The worker MUST open that URL in a
browser and the page MUST show a live view of it that updates after every interaction and
while the page changes.

#### Scenario: Start recording

- **WHEN** an editor starts recording at `https://shop.example.com`
- **THEN** within a few seconds the live view shows the shop's home page and the recorded steps start with `Go to https://shop.example.com`

### Requirement: Recorded steps

Clicking, typing, pressing keys, choosing options and checking boxes in the live view SHALL be
performed in the browser and recorded as steps. Each target MUST get the first locator that
matches only that element, in this order: test id, role and name, label, placeholder, alt
text, title, text, CSS. Consecutive typing into one field MUST be recorded as one fill step.

#### Scenario: Click a button

- **WHEN** an editor clicks a button "Add to cart" in the live view
- **THEN** the button is clicked and the step `Click button "Add to cart"` is recorded

#### Scenario: Typing is merged

- **WHEN** an editor clicks the "Email" field and types `ana@example.com` in several bursts
- **THEN** one step `Fill label "Email" with "ana@example.com"` is recorded

### Requirement: Portable recorded addresses

Addresses on the origin of the application's base URL SHALL be recorded as paths, in
navigation steps and URL assertions and when importing codegen output, so a recorded test runs
against any environment a run targets.

#### Scenario: Recording on a staging site

- **WHEN** the base URL is `https://staging.shop.test` and an editor starts recording at `https://staging.shop.test/login`
- **THEN** the first step is `Go to /login`

### Requirement: Assertions while recording

In assertion mode, clicking an element SHALL not interact with the page and SHALL offer
assertions for it (visible, text with the element's current text, value, checked); the current
URL and title MUST also be assertable. Chosen assertions MUST be recorded as assertion steps.

#### Scenario: Assert text

- **WHEN** an editor in assertion mode clicks a message reading "Order placed" and chooses text
- **THEN** the step `Expect text "Order placed" to contain "Order placed"` is recorded

### Requirement: Save a recording

Editors SHALL be able to review, delete and reorder recorded steps, then append them to or
replace the steps of a test case; the new version MUST have source `recording`. Stopping the
recording MUST close the browser and keep the recorded steps available to save.

#### Scenario: Append recorded steps

- **WHEN** an editor stops a recording with five steps and appends them to `CHK-TC-2`
- **THEN** the editor shows the five steps after the existing ones, and saving creates a version with source `recording`

### Requirement: Recording limits

A recording session SHALL end after 5 minutes without interaction or 30 minutes in total, and
each worker MUST limit concurrent sessions. Only the user who started a session MAY drive it;
others with access MAY watch it.

#### Scenario: Idle session

- **WHEN** nobody interacts with a recording for 5 minutes
- **THEN** the session ends as expired and its steps can still be saved

### Requirement: Import Playwright codegen

The recorder dialog SHALL accept JavaScript or TypeScript code produced by `npx playwright
codegen`, convert supported statements (navigation, locator actions, `expect` assertions) into
steps, and list unsupported lines with their line numbers instead of failing.

#### Scenario: Import code

- **WHEN** an editor pastes code with `page.getByRole('link', { name: 'Docs' }).click()` and an unsupported `page.waitForEvent('popup')`
- **THEN** a click step on link "Docs" is imported and the popup line is listed as not imported
