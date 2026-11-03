## RENAMED Requirements

- FROM: `### Requirement: Scenario owns its test cases`
- TO: `### Requirement: Scenarios and test cases are linked`

## MODIFIED Requirements

### Requirement: Scenarios and test cases are linked

A scenario SHALL be linked to any number of test cases, and each test case to one or more
scenarios. The scenario page MUST show a Test cases tab with the count and list of its live
linked test cases (key, title, mode, status, last result) and, for editors, actions to create a
test case for the scenario, generate test cases with AI, run the scenario and view its
Playwright code. The grid MUST show the same count.

#### Scenario: Test cases tab

- **WHEN** a user opens scenario `CHK-TS-12`, linked to `CHK-TC-1` and `CHK-TC-4`
- **THEN** a "Test cases (2)" tab lists both test cases

#### Scenario: New test case from a scenario

- **WHEN** an editor chooses "New test case" on `CHK-TS-12`
- **THEN** the test case form opens with `CHK-TS-12` already selected as its scenario

#### Scenario: Test cases placeholder

- **WHEN** a user opens scenario `CHK-TS-13`, which has no test cases yet
- **THEN** a "Test cases (0)" tab shows an empty state that explains test cases and, for editors, offers to create one

#### Scenario: Deleted test cases are not counted

- **WHEN** `CHK-TC-4` is deleted
- **THEN** `CHK-TS-12` shows "Test cases (1)"
