## Purpose

Lets the team discuss scenarios through comments and trace each scenario to the requirements
it verifies in external trackers such as Jira, GitHub and Azure DevOps.

## ADDED Requirements

### Requirement: Comments

The scenario page SHALL show a comment thread, oldest first. Users with the application role
`manager`, `editor` or `tester` MUST be able to add comments of 1–10,000 characters written in
Markdown; `viewer`s MUST be able to read them only. Each comment MUST show its author, time and
the scenario revision that was current when it was written. Comment Markdown MUST be rendered
safely (no raw HTML or scripts).

#### Scenario: Tester comments

- **WHEN** a tester adds the comment "Coupon field is hidden on mobile" to `CHK-TS-12` at r4
- **THEN** the comment appears with the tester's name, time and "on r4"

#### Scenario: Viewer cannot comment

- **WHEN** a `viewer` opens `CHK-TS-12`
- **THEN** comments are visible and there is no comment input

#### Scenario: Unsafe content

- **WHEN** a comment contains `<script>alert(1)</script>`
- **THEN** it is shown as text and no script runs

### Requirement: Edit and delete comments

Authors SHALL be able to edit and delete their own comments; edited comments MUST show an
"edited" marker. Application managers MUST be able to delete any comment. Deleted comments MUST
be removed from the thread and kept only for the audit log.

#### Scenario: Edit own comment

- **WHEN** a tester edits their comment
- **THEN** the new text is shown with an "edited" marker

#### Scenario: Cannot edit others' comments

- **WHEN** an editor tries to edit a comment written by someone else
- **THEN** no edit action is shown and the request is rejected with HTTP 403

#### Scenario: Manager moderation

- **WHEN** a manager deletes a comment written by a tester
- **THEN** the comment disappears from the thread and an audit event is recorded

### Requirement: Requirement links

Editors SHALL be able to add, edit and remove links from a scenario to requirements, each with
an `http` or `https` URL and an optional label up to 200 characters. A scenario MUST NOT have
the same URL twice and MUST NOT exceed 50 links. Links MUST open in a new tab without giving the
target page access to testRex.

#### Scenario: Add a link

- **WHEN** an editor adds `https://acme.atlassian.net/browse/SHOP-481` to `CHK-TS-12`
- **THEN** the link is listed on the scenario

#### Scenario: Reject unsafe scheme

- **WHEN** an editor adds `javascript:alert(1)`
- **THEN** the link is rejected with a message that only http and https URLs are allowed

#### Scenario: Duplicate link

- **WHEN** an editor adds a URL already linked to the scenario
- **THEN** the link is rejected as a duplicate

### Requirement: Recognized trackers

Links to known trackers SHALL be shown with the tracker's name and issue key instead of the raw
URL: Jira (`…/browse/ABC-123` → `ABC-123`), GitHub issues and pull requests
(`github.com/owner/repo/issues/42` or `/pull/42` → `owner/repo#42`) and Azure DevOps work items
(`…/_workitems/edit/123` → `#123`). Other URLs MUST be shown with their label, or their host
when there is no label. Recognized issue keys MUST be searchable from the scenario grid.

#### Scenario: Jira link

- **WHEN** a scenario links to `https://acme.atlassian.net/browse/SHOP-481` without a label
- **THEN** the link shows "Jira · SHOP-481"

#### Scenario: Unknown tracker

- **WHEN** a scenario links to `https://wiki.acme.com/checkout` with label "Checkout rules"
- **THEN** the link shows "Checkout rules"
