import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createTestDatabase, startPostgres } from '@testrex/db/testing';
import { BASE_URL, E2E_PORT } from '../playwright.config';

async function waitForReady(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`API did not become ready at ${url}`);
}

export default async function globalSetup() {
  const cli = resolve(import.meta.dirname, '../../api/dist/cli.js');
  const web = resolve(import.meta.dirname, '../dist/index.html');
  if (!existsSync(cli) || !existsSync(web)) {
    throw new Error('Build the API and web app first: pnpm build');
  }

  const container = await startPostgres();
  const database = await createTestDatabase(container, { migrate: false });
  const server = spawn(process.execPath, [cli, 'serve'], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: database.appUrl,
      DATABASE_MIGRATION_URL: database.ownerUrl,
      APP_SECRET: 'e2e-secret-that-is-at-least-32-characters-long',
      HOST: '127.0.0.1',
      PORT: String(E2E_PORT),
      PUBLIC_URL: BASE_URL,
      ALLOW_SIGNUP: 'true',
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  await waitForReady(`${BASE_URL}/readyz`);

  return async () => {
    server.kill();
    await container.stop();
  };
}
