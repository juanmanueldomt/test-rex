# Security Policy

## Reporting a vulnerability

Please **do not** open public issues for security problems. Report them privately through
[GitHub private vulnerability reporting](../../security/advisories/new).

Include the affected version, steps to reproduce and the impact you observed. We aim to
acknowledge reports within 3 business days and to publish a fix and advisory as soon as a
patch is available.

## Supported versions

Until 1.0, only the latest released minor version receives security fixes.

## Scope notes

testRex runs code from linked test repositories and sends content to configured LLM
providers. Issues that allow cross-organization data access, secret disclosure, or code
execution outside the worker sandbox are considered high severity.
