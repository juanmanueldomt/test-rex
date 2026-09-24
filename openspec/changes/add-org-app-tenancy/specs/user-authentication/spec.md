## Purpose

Lets people create a testRex account, sign in and out securely, and lets operators control
who may register on their instance.

## ADDED Requirements

### Requirement: Account registration

The system SHALL allow a person to register with name, email and password when sign-up is
enabled. Emails MUST be unique case-insensitively and passwords MUST be at least 10 characters.

#### Scenario: Successful registration

- **WHEN** a visitor submits a valid name, unused email and 12-character password
- **THEN** an account is created and the user is signed in and taken to onboarding

#### Scenario: Duplicate email

- **WHEN** a visitor registers with `Ana@Example.com` and `ana@example.com` already exists
- **THEN** registration is rejected with a message that the email is already in use

#### Scenario: Weak password

- **WHEN** a visitor submits a 6-character password
- **THEN** registration is rejected and the password field shows the minimum length

### Requirement: First user becomes instance administrator

On a self-hosted instance with no users, the first registered account SHALL become the
instance administrator, regardless of the sign-up setting.

#### Scenario: Fresh instance

- **WHEN** the first person registers on an empty instance
- **THEN** that account is marked instance administrator

### Requirement: Sign-up policy

The system SHALL support disabling public sign-up; when disabled, only people holding a
valid invitation MAY register.

#### Scenario: Sign-up disabled without invitation

- **WHEN** public sign-up is disabled and a visitor opens the registration page without an invitation
- **THEN** registration is not offered and the page explains that an invitation is required

#### Scenario: Sign-up disabled with invitation

- **WHEN** public sign-up is disabled and a visitor opens a valid invitation link
- **THEN** the visitor can register with the invited email

### Requirement: Sign-in and sessions

The system SHALL authenticate users by email and password, issue an HTTP-only secure
session cookie, and rate-limit failed attempts.

#### Scenario: Valid credentials

- **WHEN** a user signs in with correct credentials
- **THEN** a session is created and the user lands on their last used organization

#### Scenario: Invalid credentials

- **WHEN** a user signs in with a wrong password
- **THEN** sign-in fails with a generic message that does not reveal whether the email exists

#### Scenario: Brute-force protection

- **WHEN** more than 10 failed sign-in attempts occur for the same email within 15 minutes
- **THEN** further attempts for that email are rejected until the window expires

### Requirement: Sign-out

The system SHALL invalidate the current session on sign-out.

#### Scenario: Session invalidated

- **WHEN** a user signs out and the old session cookie is replayed
- **THEN** the request is treated as unauthenticated
