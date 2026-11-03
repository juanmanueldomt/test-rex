## Purpose

Lets organizations connect their own LLM provider and use it to draft, revise and repair test
cases, always as proposals that people review before anything is saved.

## ADDED Requirements

### Requirement: LLM provider settings

Organization owners and admins SHALL configure one LLM provider for the organization: Anthropic
or an OpenAI-compatible endpoint (base URL), a model and an API key. The key MUST be encrypted
at rest, MUST never be returned by the API or written to logs or the audit log, and MAY be kept
when other settings change. Other members MUST only see whether AI is available.

#### Scenario: Configure Anthropic

- **WHEN** an owner saves provider Anthropic, model `claude-opus-5-5` and an API key
- **THEN** the settings show the provider, model and "key saved" without the key itself

#### Scenario: Member cannot read settings

- **WHEN** an organization member requests the LLM settings
- **THEN** the response is HTTP 403

### Requirement: Connection test

Owners and admins SHALL be able to test the configured provider; the result MUST state success
or the provider's error (for example an invalid key) without exposing the key.

#### Scenario: Invalid key

- **WHEN** an owner tests a provider whose key is rejected
- **THEN** testRex reports that the provider rejected the credentials

### Requirement: Generate test cases

Editors SHALL ask the LLM to propose 1–10 test cases for a scenario, with optional instructions
and a mode. The prompt MUST include the scenario's title, description, steps to reach, existing
test case titles, the base URL and the step format. Proposals MUST be validated against the
step rules; invalid parts MUST be reported, not saved.

#### Scenario: Three proposals

- **WHEN** an editor asks for 3 automated test cases for `CHK-TS-1`
- **THEN** three proposals with titles and steps are shown for review, each linked to `CHK-TS-1`

### Requirement: Revise a test case

Editors SHALL ask the LLM to change a test case with an instruction; the proposal MUST be shown
as a comparison of the current and proposed steps with the model's summary of the change.

#### Scenario: Add an assertion

- **WHEN** an editor asks to "verify the cart total after applying the coupon"
- **THEN** the proposal shows the added assertion step highlighted against the current steps

### Requirement: Fix a failed test

For a failed automated run item, editors SHALL ask the LLM for a fix; the request MUST include
the pinned steps, the failing step and error, the page URL and the ARIA snapshot captured at
failure, so locators can be corrected from the real page.

#### Scenario: Locator changed

- **WHEN** a step failed because button "Pay" is now named "Pay now" and the editor asks for a fix
- **THEN** the proposal changes that step's locator name to "Pay now" and explains why

### Requirement: Review before saving

AI proposals SHALL never be saved automatically. Editors MUST be able to edit, accept or
discard each proposal; accepted proposals are saved through the normal create or update rules,
with version source `ai`.

#### Scenario: Accept a revision

- **WHEN** an editor accepts a revision proposal for `CHK-TC-2` at v3
- **THEN** v4 is created with source `ai`, unless `CHK-TC-2` changed meanwhile

### Requirement: AI availability and errors

AI actions SHALL require `testcase.write` and be hidden when the organization has no provider.
Provider failures, timeouts, refusals and invalid output MUST produce a clear message, and
every AI request MUST pass the organization's quota check.

#### Scenario: No provider

- **WHEN** an editor's organization has no LLM provider
- **THEN** AI buttons are not shown and AI endpoints answer with code `AI_NOT_CONFIGURED`
