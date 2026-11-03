## Purpose

The global report summarizes every test run of an application over a period, so teams see
quality trends and the test cases that need attention without opening runs one by one.

## ADDED Requirements

### Requirement: Global report

The Reports tab SHALL summarize the runs created in a selectable period (7, 30 or 90 days;
default 30) with: number of runs, executed items, overall pass rate, failed items, average run
duration and runs by status. Cancelled runs MUST be counted as runs but excluded from rates.

#### Scenario: Thirty days

- **WHEN** a user opens Reports and 12 runs were created in the last 30 days
- **THEN** the report shows 12 runs and the pass rate of their executed items

#### Scenario: No runs

- **WHEN** no run exists in the period
- **THEN** the report explains that there are no runs yet and links to the runs tab

### Requirement: Pass-rate trend

The report SHALL chart the most recent runs of the period (up to 30) in chronological order
with each run's passed, failed, blocked and skipped counts and its pass rate, and each entry
MUST link to its run. The chart MUST have an accessible table equivalent.

#### Scenario: Open a run from the trend

- **WHEN** a user activates the bar of `CHK-TR-9` in the trend
- **THEN** the run page of `CHK-TR-9` opens

### Requirement: Test cases that need attention

The report SHALL list the most failing test cases (failure count and rate, last failure), flaky
test cases (both passed and failed in the period's completed runs) and the slowest automated
test cases (average duration), each linking to the test case.

#### Scenario: Flaky test case

- **WHEN** `CHK-TC-4` passed in 3 runs and failed in 2 runs of the period
- **THEN** it is listed as flaky with 2 failures out of 5 executions

### Requirement: Scenario health

The report SHALL show, per scenario with executions in the period, its executed items and pass
rate, ordered from the lowest pass rate.

#### Scenario: Least healthy first

- **WHEN** scenario `CHK-TS-2` has a 50% pass rate and `CHK-TS-1` 90%
- **THEN** `CHK-TS-2` is listed before `CHK-TS-1`
