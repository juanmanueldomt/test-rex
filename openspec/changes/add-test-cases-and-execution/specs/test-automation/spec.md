## Purpose

Defines what an automated step can do, how testRex runs it with the Playwright library, the
application settings and global steps that surround every test case, and the Playwright code
generated from the same steps.

## ADDED Requirements

### Requirement: Step actions

Automated steps SHALL use one of these actions: go to a URL (absolute or relative to the base
URL), click, double-click, fill, press a key, select an option, check, uncheck, hover and wait
(0–60,000 ms). Assertions SHALL be: visible, hidden, text contains, exact text, value, checked,
enabled, disabled, element count, URL contains and title contains. A `manual` action marks a
step for people only.

#### Scenario: Fill and press

- **WHEN** a test case fills the field labelled "Email" with `ana@example.com` and presses `Enter`
- **THEN** the engine types the value into that field and presses Enter on it

### Requirement: Locators

Steps that target an element SHALL use a locator by role and accessible name, text, label,
placeholder, alt text, title, test id or CSS selector, with optional exact matching and an
optional index for repeated elements. Locators MUST behave like the Playwright locator of the
same kind, including waiting until the element is actionable.

#### Scenario: Role and name

- **WHEN** a step clicks role `button` with name `Apply`
- **THEN** the engine clicks `page.getByRole('button', { name: 'Apply' })`

#### Scenario: Ambiguous locator

- **WHEN** a locator matches three elements and no index is set
- **THEN** the step fails with an error that the locator matched three elements

### Requirement: Variables

Step values and locators SHALL support `{{name}}` placeholders resolved from the current
dataset row and the built-in variables `baseUrl`, `runKey`, `iteration`, `timestamp` and
`uuid`. An unknown variable MUST fail the step with a message naming it.

#### Scenario: Dataset value

- **WHEN** a step fills `{{code}}` and the current row has `code = SAVE10`
- **THEN** the field receives `SAVE10`

### Requirement: Automation settings

Each application SHALL have automation settings: base URL, browser (`chromium`, `firefox`,
`webkit`), viewport size, action, navigation and assertion timeouts, and whether to keep traces
and videos of failed test cases. Runs MUST snapshot the settings they use and MAY override the
base URL and browser.

#### Scenario: Base URL override

- **WHEN** a tester starts a run with base URL `https://staging.example.com`
- **THEN** relative `go to` steps of that run open pages on the staging host

### Requirement: Global steps

Each application SHALL have ordered, named global steps in four phases: before test run,
before each test case, after each test case and after test run. Each global step holds
automated steps and can be disabled. Runs MUST snapshot the enabled global steps.

#### Scenario: Before each test case

- **WHEN** a global step "Accept cookies" exists in phase before each test case and a run executes three automated test cases
- **THEN** "Accept cookies" runs at the start of each of the three test cases

### Requirement: Global step semantics

Before-run steps SHALL run once in their own browser context, whose cookies and storage MUST
then be the starting state of every test case. If they fail, automated items MUST be blocked
with the error. A failing before-each step fails the iteration without running its steps;
after-each steps run even after failures; after-run failures are reported on the run.

#### Scenario: Shared login

- **WHEN** a before-run global step signs in and a test case opens `/account`
- **THEN** the test case starts signed in

#### Scenario: Failing setup

- **WHEN** the before-run global step fails
- **THEN** every automated item of the run is blocked with that error and after-run steps still run

### Requirement: Playwright engine

Automated items SHALL be executed by the worker with the Playwright library: one browser per
run, a new browser context per test case iteration with the run's base URL, viewport and
timeouts, and steps executed in order until the first failure. Assertions MUST retry until they
pass or the assertion timeout elapses, reporting expected and received values.

#### Scenario: Assertion timeout

- **WHEN** an assertion expects text "Paid" and the element shows "Pending" for the whole timeout
- **THEN** the step fails with a message that names the expected "Paid" and the received "Pending"

### Requirement: Generated Playwright code

Users SHALL be able to view, copy and download a `@playwright/test` spec generated from a test
case or from all test cases of a scenario, including the application's global steps as hooks,
dataset rows as parameterized tests, tags as Playwright tags and the base URL. Generated code
MUST NOT require testRex to run.

#### Scenario: Code of a test case

- **WHEN** a user opens the Code tab of `CHK-TC-2`
- **THEN** a spec with `test('CHK-TC-2 · <title>', …)` and one Playwright call per step is shown with copy and download actions
