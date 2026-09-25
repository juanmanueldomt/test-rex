## Purpose

The scenario catalog is the grid on the Test scenarios tab where people find, filter and open
scenarios, and share exact views of the list through the URL.

## ADDED Requirements

### Requirement: Scenario grid

The Test scenarios tab SHALL show a grid with the columns key, title, status, module,
priority, tags, test cases (count), author and updated (relative time, with the exact time and
last editor on hover or focus). Selecting a row MUST open the scenario. Users with permission
to create MUST see a **New scenario** button. The default order MUST be by key, newest first.

#### Scenario: Grid columns

- **WHEN** a user opens the scenarios tab of `CHK`
- **THEN** each row shows key, title, status, module, priority, tags, test case count, author and updated

#### Scenario: Open a scenario

- **WHEN** a user clicks the row of `CHK-TS-12` or selects it and presses Enter
- **THEN** the scenario page `/o/acme/a/CHK/scenarios/CHK-TS-12` opens

#### Scenario: New scenario button hidden

- **WHEN** a `tester` opens the scenarios tab
- **THEN** no New scenario button is shown

### Requirement: Tag overflow

A row SHALL show up to two tag chips. When a scenario has more tags, the row MUST show the first
two (alphabetical) followed by a `+N` badge. Hovering or keyboard-focusing the badge MUST open a
popover listing up to five of the hidden tags and, if more remain, "and M more". Selecting a tag
chip MUST filter the grid by that tag.

#### Scenario: Many tags

- **WHEN** a scenario has tags `cart`, `mobile`, `payments`, `regression`, `smoke`
- **THEN** the row shows `@cart`, `@mobile` and `+3`, and hovering `+3` lists `@payments`, `@regression`, `@smoke`

#### Scenario: More than five hidden

- **WHEN** a scenario has 9 tags
- **THEN** the popover lists five hidden tags and "and 2 more"

#### Scenario: Keyboard access

- **WHEN** a keyboard user tabs to the `+3` badge
- **THEN** the popover opens and its content is announced to screen readers

### Requirement: Search

The grid SHALL provide a text search that matches, ignoring case and accents, the scenario key
(full key such as `CHK-TS-12` or the number alone), title, description, steps to reach, and the
issue keys of requirement links.

#### Scenario: Search by title word

- **WHEN** a user searches `coupon`
- **THEN** only scenarios whose title or rich text contains "coupon" are listed

#### Scenario: Search by key number

- **WHEN** a user searches `12`
- **THEN** `CHK-TS-12` is listed first

#### Scenario: Search by requirement

- **WHEN** a user searches `SHOP-481` and `CHK-TS-12` links to Jira issue SHOP-481
- **THEN** `CHK-TS-12` is listed

### Requirement: Filters

The grid SHALL filter by status, module (including "no module"), priority and author, each
allowing several values (a row matches any selected value), by tags (a row MUST have all
selected tags), and by supported version (a row matches when the version is inside its range;
empty bounds are unlimited). Deleted scenarios MUST be hidden unless the "show deleted" filter
is on. Active filters MUST be visible and removable individually or all at once.

#### Scenario: Filter by status and module

- **WHEN** a user selects status `ready` and module Checkout
- **THEN** only ready scenarios in Checkout are listed

#### Scenario: Filter by tags

- **WHEN** a user selects tags `smoke` and `cart`
- **THEN** only scenarios with both tags are listed

#### Scenario: Filter by supported version

- **WHEN** a user filters by version `3.1` and scenarios have ranges `2.4–3.0`, `3.0–`, and no range
- **THEN** the scenarios with ranges `3.0–` and no range are listed

#### Scenario: Show deleted

- **WHEN** a user turns on "show deleted"
- **THEN** deleted scenarios are listed and marked as deleted

### Requirement: Sorting

Users SHALL be able to sort the grid by key, title, status, priority, module, author or updated,
ascending or descending, by activating the column header. Sorting by key MUST order numerically
(`CHK-TS-9` before `CHK-TS-10`). Priority MUST sort by severity, not alphabetically.

#### Scenario: Sort by updated

- **WHEN** a user activates the Updated header twice
- **THEN** the grid is sorted by last update, oldest first, and the header announces the sort direction

### Requirement: Server-side pagination

The grid SHALL be paginated by the server with page numbers, a page size of 25 (default), 50 or
100, and the total number of matching scenarios. Search, filters, sorting and pagination MUST be
evaluated on the server over all matching scenarios. Changing search, filters or sort MUST
return to page 1. Requesting a page beyond the last MUST show the last page.

#### Scenario: Page navigation

- **WHEN** 130 scenarios match and the page size is 50
- **THEN** the grid shows "1–50 of 130" and pages 1, 2 and 3

#### Scenario: Filter resets page

- **WHEN** a user on page 3 changes the status filter
- **THEN** page 1 of the new results is shown

### Requirement: View state in the URL

Search text, filters, sort, page and page size SHALL be stored in the URL query string, so that
reloading, sharing a link or using the browser back and forward buttons reproduces the same
view. Default values MUST be omitted from the URL.

#### Scenario: Shared view

- **WHEN** a user copies the URL of a view filtered by tag `smoke`, sorted by priority, page 2, and a colleague opens it
- **THEN** the colleague sees the same filter, sort and page

#### Scenario: Back button

- **WHEN** a user applies a filter and presses the browser back button
- **THEN** the previous unfiltered view is shown

### Requirement: Empty and loading states

The grid SHALL show a loading placeholder while data loads, an empty state with a create action
(when permitted) when the application has no scenarios, and a "no matching scenarios" state
with a clear-filters action when filters exclude everything.

#### Scenario: No matches

- **WHEN** a search matches nothing
- **THEN** a "no matching scenarios" message and a Clear filters button are shown
