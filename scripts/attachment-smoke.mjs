#!/usr/bin/env node
// Checks that attachments survive re-creating the app container (compose "storage" volume).
//   node scripts/attachment-smoke.mjs upload   http://localhost:8080 state.json
//   docker compose up -d --force-recreate app
//   node scripts/attachment-smoke.mjs download http://localhost:8080 state.json
// `upload` registers the first account on an empty instance, creates an application and a
// scenario, and uploads a file; `download` fetches it again and compares the bytes.
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [phase, baseUrl, statePath] = process.argv.slice(2);
if (!['upload', 'download'].includes(phase) || !baseUrl || !statePath) {
  console.error('Usage: node scripts/attachment-smoke.mjs upload|download <base-url> <state.json>');
  process.exit(2);
}
const origin = new URL(baseUrl).origin;

async function call(method, path, { cookie, json, body, headers = {} } = {}) {
  const res = await fetch(`${origin}${path}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(json ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: json ? JSON.stringify(json) : body,
  });
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
  return res;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

if (phase === 'upload') {
  const email = `smoke-${randomBytes(4).toString('hex')}@example.com`;
  const password = randomBytes(12).toString('hex');
  const signUp = await call('POST', '/api/auth/sign-up/email', {
    json: { name: 'Smoke Test', email, password },
  });
  const cookie = signUp.headers
    .getSetCookie()
    .map((line) => line.split(';')[0])
    .join('; ');
  const org = await (await call('POST', '/api/orgs', { cookie, json: { name: 'Smoke' } })).json();
  const apps = `/api/orgs/${org.slug}/apps`;
  await call('POST', apps, { cookie, json: { name: 'Smoke', key: 'SMK' } });
  const scenario = await (
    await call('POST', `${apps}/SMK/scenarios`, { cookie, json: { title: 'Smoke scenario' } })
  ).json();
  const content = randomBytes(64 * 1024);
  const form = new FormData();
  form.append('file', new Blob([content]), 'smoke.bin');
  const attachment = await (
    await call('POST', `${apps}/SMK/scenarios/${scenario.key}/attachments`, { cookie, body: form })
  ).json();
  writeFileSync(
    statePath,
    JSON.stringify({ cookie, url: attachment.url, sha256: sha256(content) }),
  );
  console.log(`ok   uploaded ${attachment.url}`);
} else {
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const res = await call('GET', state.url, { cookie: state.cookie });
  const bytes = Buffer.from(await res.arrayBuffer());
  if (sha256(bytes) !== state.sha256) {
    console.error(`FAIL downloaded content differs (${bytes.length} bytes)`);
    process.exit(1);
  }
  console.log(`ok   downloaded ${state.url} unchanged`);
}
