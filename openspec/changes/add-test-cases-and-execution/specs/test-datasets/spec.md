## Purpose

Datasets hold the data that drives test cases: named columns and rows of values, so one test
case can run once per row without copying it.

## ADDED Requirements

### Requirement: Datasets

An application SHALL have datasets with a name (1–80 characters, unique within the application
ignoring case), an optional description, 1–50 columns and 0–500 rows. Column names MUST be
valid variable names (a letter or `_` followed by letters, digits or `_`) and unique within the
dataset; every row MUST have one value (up to 1,000 characters) per column.

#### Scenario: Create a dataset

- **WHEN** an editor creates dataset "Coupons" with columns `code` and `discount` and two rows
- **THEN** the dataset is saved and can be selected on test cases of the application

#### Scenario: Invalid column

- **WHEN** an editor names a column `first name`
- **THEN** the save is rejected with a message describing valid column names

### Requirement: CSV import and export

The dataset editor SHALL import a CSV file (comma or semicolon separated, quoted values, first
line as column names) into the columns and rows, and export the dataset as CSV.

#### Scenario: Import CSV

- **WHEN** an editor imports a CSV whose first line is `code;discount` followed by three lines
- **THEN** the editor shows columns `code` and `discount` with three rows ready to save

### Requirement: Dataset iterations

A test case that uses a dataset SHALL run once per row (an iteration), with the row's values
available to its steps as `{{column}}`. Each iteration MUST have its own result; the test case
result MUST be the worst iteration result. A run MUST snapshot the rows it uses.

#### Scenario: Two rows, one failure

- **WHEN** an automated test case with a two-row dataset passes for row 1 and fails for row 2
- **THEN** the run shows both iterations and the test case as failed

#### Scenario: Empty dataset

- **WHEN** a test case's dataset has no rows when the run starts
- **THEN** its run item is blocked with a message that the dataset has no rows

### Requirement: Dataset deletion

Editors SHALL be able to delete a dataset that no live test case uses. Deleting a dataset in
use MUST be rejected with the number of test cases using it. Deletion MUST be soft so past
versions and runs keep their data.

#### Scenario: Dataset in use

- **WHEN** an editor deletes dataset "Coupons" used by two test cases
- **THEN** deletion is rejected with a message that two test cases use it

### Requirement: Dataset permissions and audit

Creating, editing and deleting datasets SHALL require `testcase.write`; all roles MUST be able
to read them. Every change MUST be audited (`dataset.created`, `dataset.updated`,
`dataset.deleted`).

#### Scenario: Viewer reads datasets

- **WHEN** a viewer opens the Automation tab
- **THEN** datasets are listed read-only without edit actions
