## Purpose

Test runs execute a selection of test cases, automatically with Playwright or by hand, and
keep a complete, reproducible report of each execution.

## ADDED Requirements

### Requirement: Run keys

Each test run SHALL receive a key `<APPKEY>-TR-<n>` from a per-application counter starting at
1 that never reuses numbers.

#### Scenario: First run

- **WHEN** a tester starts the first run in `CHK`
- **THEN** it receives key `CHK-TR-1`

### Requirement: Create a test run

Users with `execution.write` SHALL create runs by selecting scenarios and/or test cases and the
modes to include. Scenario selection MUST include their live, non-deprecated test cases;
explicit test cases MUST be included unless deleted. Each test case MUST appear once. A run
without items MUST be rejected.

#### Scenario: Scenarios and a test case

- **WHEN** a tester selects `CHK-TS-1` (cases TC-1, TC-2) and `CHK-TC-2` explicitly
- **THEN** the run has two items, TC-1 and TC-2

#### Scenario: Only automated

- **WHEN** a tester selects scenario `CHK-TS-1` with modes automated only
- **THEN** manual test cases of `CHK-TS-1` are not included

### Requirement: Reproducible runs

A run SHALL pin, per item, the test case version, its dataset rows and its scenarios, and SHALL
snapshot the automation settings (with overrides) and enabled global steps. Later edits MUST
NOT change what a run executes or reports.

#### Scenario: Edit during a run

- **WHEN** an editor changes `CHK-TC-1` while run `CHK-TR-4` is queued
- **THEN** `CHK-TR-4` executes and reports the version it pinned

### Requirement: Run and item status

Run status SHALL be `queued`, `running`, `completed` or `cancelled`. Item status SHALL be
`queued` or `untested` before execution, `running`, then `passed`, `failed`, `blocked` or
`skipped`. A run MUST complete automatically when every item has a final status.

#### Scenario: Automated run completes

- **WHEN** the worker finishes every item of a run that has only automated items
- **THEN** the run becomes `completed` with its finish time

#### Scenario: Mixed run

- **WHEN** a run's automated items finish while two manual items are untested
- **THEN** the run stays `running` until the manual items are recorded

### Requirement: Automated execution

Runs with automated items SHALL be handed to the worker, which executes them in order with the
Playwright engine, records each item's start, finish, duration, iterations and step results as
it goes, and makes progress visible while the run is running.

#### Scenario: Live progress

- **WHEN** a user watches a running run with ten automated items
- **THEN** the run page updates each item's status and the progress without reloading

### Requirement: Failure artifacts

For each failed automated iteration the worker SHALL store a screenshot, the page URL, the ARIA
snapshot of the page, console errors and, when enabled, the Playwright trace and video, in the
storage adapter under the organization's prefix. Artifacts MUST be downloadable only by users
with access to the application.

#### Scenario: Screenshot of a failure

- **WHEN** step 4 of `CHK-TC-2` fails in `CHK-TR-5`
- **THEN** the report of that item shows step 4's error with a screenshot and a trace download

### Requirement: Manual execution

Testers SHALL execute manual items step by step: mark each step passed, failed, blocked or
skipped with an optional actual result, per dataset iteration, and set the item result with
notes. The executor and time MUST be recorded and the item MAY be executed again while the run
is not completed.

#### Scenario: Record a manual result

- **WHEN** a tester marks step 2 failed with actual result "No discount shown" and saves
- **THEN** the item is failed, shows the tester as executor and the failed step with the actual result

### Requirement: Cancel, complete and re-run

Users with `execution.write` SHALL be able to cancel a queued or running run (the worker stops
before the next step and unfinished items become `skipped`), complete a running run (untested
items become `skipped`) and re-run a run, with all items or only failed and blocked items, as a
new run with the current versions.

#### Scenario: Re-run failed

- **WHEN** a tester re-runs `CHK-TR-5`, in which 2 of 10 items failed, choosing only failed
- **THEN** a new run with those 2 test cases is created

### Requirement: Run report

Each run SHALL have a report with totals by status, pass rate (passed ÷ executed items),
duration, environment, browser, who started it, per-scenario breakdown, global step results,
and for every item its iterations, step results with the failing step emphasized, errors,
executor and artifacts.

#### Scenario: Report of a finished run

- **WHEN** a user opens `CHK-TR-5` with 8 passed and 2 failed items
- **THEN** the report shows 80% pass rate, both failures with their failing steps first, and the duration

### Requirement: Report exports

The run report SHALL be downloadable as JSON (the complete report) and as JUnit XML (one test
case per item, with failures and skipped items) for CI tools.

#### Scenario: JUnit export

- **WHEN** a user downloads the JUnit XML of `CHK-TR-5`
- **THEN** the file contains 10 test cases, 2 with a failure element holding the error

### Requirement: Run permissions and audit

Creating, cancelling, completing and re-running runs and recording manual results SHALL
require `execution.write` (manager, editor, tester); viewers MUST read runs and reports.
Archived applications MUST reject run changes. Run creation, cancellation, completion and
manual results MUST be audited.

#### Scenario: Viewer cannot start a run

- **WHEN** a viewer sends a request to create a run
- **THEN** the request is rejected with HTTP 403
