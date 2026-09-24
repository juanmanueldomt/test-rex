#!/usr/bin/env node
// Waits until every URL answers 200, or exits 1 after the timeout.
// Usage: node scripts/smoke-test.mjs [--timeout 120] <url> [url...]
const args = process.argv.slice(2);
let timeoutSeconds = 120;
const urls = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timeout') timeoutSeconds = Number(args[++i]);
  else urls.push(args[i]);
}
if (urls.length === 0 || !Number.isFinite(timeoutSeconds)) {
  console.error('Usage: node scripts/smoke-test.mjs [--timeout 120] <url> [url...]');
  process.exit(2);
}

const deadline = Date.now() + timeoutSeconds * 1000;
const pending = new Set(urls);
const lastResult = new Map();

while (pending.size > 0 && Date.now() < deadline) {
  for (const url of pending) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      lastResult.set(url, `HTTP ${res.status}`);
      if (res.status === 200) {
        pending.delete(url);
        console.log(`ok   ${url}`);
      }
    } catch (error) {
      lastResult.set(url, error.cause?.code ?? error.message);
    }
  }
  if (pending.size > 0) await new Promise((r) => setTimeout(r, 2000));
}

for (const url of pending) console.error(`FAIL ${url} (last result: ${lastResult.get(url)})`);
process.exitCode = pending.size === 0 ? 0 : 1;
