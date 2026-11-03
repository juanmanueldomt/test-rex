---
'@testrex/api': minor
'@testrex/web': minor
'@testrex/worker': minor
'@testrex/contracts': minor
'@testrex/db': minor
---

Add test cases, test runs, reports and AI assistance.

- Test cases linked to one or more scenarios, with versioned steps whose expected results and
  assertions are highlighted, automated (Playwright) or manual execution, and datasets that
  run a test case once per row.
- Global steps before or after each test case and each run, and per-application automation
  settings (base URL, browser, viewport, timeouts, trace and video on failure).
- A recorder that drives a browser in the worker, import of `npx playwright codegen` output,
  and generated `@playwright/test` code for every test case and scenario.
- Test runs executed by the worker with the Playwright library or step by step by testers,
  with a full report (JSON and JUnit XML exports) and a global report across runs.
- AI assistance with the organization's own LLM key (Anthropic or OpenAI-compatible):
  generate, improve and fix test cases, always reviewed before saving.
- Migration `0005` adds the new tenant tables with Row-Level Security.
