# attachments Specification

## Purpose

Stores files that support test design (screenshots, specifications, data files) next to the
items they belong to, including images pasted into rich text, with storage that works both
self-hosted and in the future cloud edition.

## Requirements

### Requirement: Attach files to a scenario

Editors SHALL be able to attach files to a scenario by choosing them or dragging them onto the
attachments area. Each file MUST NOT exceed the configured maximum size (default 25 MB). The
attachment list MUST show name, size, type, uploader and time, and every user with access to the
application MUST be able to download attachments.

#### Scenario: Upload

- **WHEN** an editor drops `checkout-flow.pdf` (2 MB) on `CHK-TS-12`
- **THEN** it appears in the attachment list with its name, size, uploader and time

#### Scenario: File too large

- **WHEN** an editor uploads a 40 MB file and the limit is 25 MB
- **THEN** the upload is rejected with a message stating the limit

#### Scenario: Viewer downloads

- **WHEN** a `viewer` selects an attachment
- **THEN** the file downloads

### Requirement: Images in rich text

Pasting or dropping an image (PNG, JPEG, GIF or WebP) into the description or steps to reach
editor SHALL upload it as an attachment of the scenario and insert it at the cursor. This MUST
also work on the new scenario form before the scenario is first saved: such uploads MUST be
attached to the scenario when it is saved, and uploads never attached MUST be discarded after
24 hours.

#### Scenario: Paste screenshot while editing

- **WHEN** an editor pastes a screenshot into the steps to reach of `CHK-TS-12` and saves
- **THEN** the image is shown in place and listed among the scenario's attachments

#### Scenario: Paste before first save

- **WHEN** an editor pastes an image into the description of a new scenario and saves it
- **THEN** the created scenario shows the image and lists it as an attachment

#### Scenario: Abandoned upload

- **WHEN** an editor pastes an image into a new scenario form and never saves it
- **THEN** the uploaded file is removed after 24 hours

### Requirement: Remove attachments

Editors SHALL be able to remove an attachment after confirming. A removed attachment MUST
disappear from the attachment list, but images it provides MUST keep displaying in revisions
that embed them, so history stays intact.

#### Scenario: Remove embedded image

- **WHEN** an editor removes an image attachment embedded in r3 and saves r4 without it
- **THEN** the attachment is gone from the list and viewing r3 still shows the image

### Requirement: Safe file delivery

Files SHALL be downloaded through testRex with the access checks of the application they belong
to. The file type MUST be determined from the file content, not only from the name or the
browser's claim. Only PNG, JPEG, GIF and WebP images MUST be displayed inline; every other type,
including SVG and HTML, MUST be delivered as a download.

#### Scenario: HTML file

- **WHEN** a user opens an attached `report.html`
- **THEN** the browser downloads it instead of rendering it

#### Scenario: Other organization

- **WHEN** a user requests an attachment of an application in another organization
- **THEN** the response is HTTP 404

### Requirement: Storage backends

Attachments SHALL be stored either in a local directory (self-hosted default, persisted in a
Docker volume) or in an S3-compatible bucket, chosen by configuration. With S3 the application
MUST NOT keep attachment data on local disk. The application MUST refuse to become ready when
the configured storage is not writable, reporting the reason. Storage locations MUST be
separated by organization.

#### Scenario: Local storage in compose

- **WHEN** testRex runs with the default docker compose configuration and the app container is recreated
- **THEN** previously uploaded attachments are still downloadable

#### Scenario: Misconfigured S3

- **WHEN** the S3 bucket does not exist or the credentials are wrong
- **THEN** the readiness check fails with a message naming the storage problem

### Requirement: Storage quota hook

Every upload SHALL be checked against the organization's storage quota before it is stored, and
stored bytes MUST be tracked per organization. Self-hosted instances MUST have no quota.

#### Scenario: Self-hosted upload

- **WHEN** an editor uploads a file on a self-hosted instance
- **THEN** the quota check allows it and the organization's stored bytes increase by the file size
