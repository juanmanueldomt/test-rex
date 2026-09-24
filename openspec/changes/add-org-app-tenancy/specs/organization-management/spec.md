## Purpose

Organizations are the top-level tenant in testRex: they own applications and all test
data, and define who can access it.

## ADDED Requirements

### Requirement: Create organization

An authenticated user SHALL be able to create an organization with a name and a URL slug;
the creator MUST become its owner. Slugs MUST be unique across the instance, lowercase,
3–40 characters of letters, digits and hyphens.

#### Scenario: Create first organization during onboarding

- **WHEN** a newly registered user submits organization name "Acme QA"
- **THEN** an organization with suggested slug `acme-qa` is created and the user is its owner

#### Scenario: Slug taken

- **WHEN** a user submits slug `acme-qa` and it already exists
- **THEN** creation is rejected and an available alternative slug is suggested

### Requirement: Multiple organization membership

A user SHALL be able to belong to several organizations and switch between them; the
current organization MUST be reflected in the URL.

#### Scenario: Switch organization

- **WHEN** a member of "Acme QA" and "Beta Labs" selects "Beta Labs" in the organization switcher
- **THEN** the UI navigates to `/o/beta-labs` and only Beta Labs data is shown

### Requirement: Organization roles

Each membership SHALL have exactly one organization role: `owner`, `admin` or `member`.
An organization MUST always have at least one owner.

#### Scenario: Last owner cannot leave

- **WHEN** the only owner tries to leave or demote themself
- **THEN** the action is rejected with a message to transfer ownership first

#### Scenario: Admin changes a member role

- **WHEN** an admin promotes a member to admin
- **THEN** the member's role becomes admin and an audit event is recorded

#### Scenario: Admin cannot manage owners

- **WHEN** an admin tries to demote or remove an owner
- **THEN** the action is rejected

### Requirement: Invitations

Owners and admins SHALL be able to invite people by email with a chosen role. Each
invitation MUST produce a single-use link that expires after 7 days. When email delivery is
configured the link is emailed; otherwise it is shown for copying.

#### Scenario: Accept invitation as existing user

- **WHEN** an existing user signed in with the invited email opens a valid invitation link
- **THEN** they become a member with the invited role and the invitation is consumed

#### Scenario: Expired invitation

- **WHEN** someone opens an invitation link older than 7 days
- **THEN** the page states the invitation has expired and asks them to request a new one

#### Scenario: Wrong account

- **WHEN** a user signed in with a different email opens an invitation link
- **THEN** the invitation is not accepted and the page offers to sign in with the invited email

#### Scenario: No email delivery configured

- **WHEN** an admin creates an invitation on an instance without SMTP settings
- **THEN** the invitation link is displayed with a copy button

### Requirement: Remove member

Owners and admins SHALL be able to remove members; removal MUST immediately revoke access
to all of the organization's applications.

#### Scenario: Removed member loses access

- **WHEN** a member is removed and then requests any resource of that organization
- **THEN** the request is denied with HTTP 404
