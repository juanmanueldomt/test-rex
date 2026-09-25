// Integration-test harness: a real database (RLS roles and migrations), the full route stack,
// and a small cookie-keeping client that behaves like a browser.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiEnvSchema, createLogger, loadConfig } from '@testrex/config';
import { createDb, type DbHandle } from '@testrex/db';
import { createTestDatabase, type TestDatabase } from '@testrex/db/testing';
import { LocalStorage, type StorageAdapter } from '@testrex/storage';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance, InjectOptions } from 'fastify';
import pg from 'pg';
import { createApiServices, registerApi } from '../api';
import { buildServer } from '../server';
import type { ApiServices } from '../services/index';
import type { MailMessage, Mailer } from '../services/mailer';
import type { QuotaService } from '../services/quota';

export const PUBLIC_URL = 'http://testrex.test';

/** Response bodies are asserted field by field in tests, so they are loosely typed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Loose = any;
export const PASSWORD = 'correct-horse-battery';

export interface HarnessOptions {
  allowSignup?: boolean;
  mailer?: Mailer;
  quota?: QuotaService;
  now?: () => Date;
  /** Defaults to a temporary directory removed on close. */
  storage?: StorageAdapter;
  /** ATTACHMENT_MAX_BYTES. */
  attachmentMaxBytes?: number;
}

export interface Harness {
  app: FastifyInstance;
  services: ApiServices;
  database: TestDatabase;
  /** Superuser pool for fixtures and assertions that must bypass RLS. */
  superPool: pg.Pool;
  client(): TestClient;
  close(): Promise<void>;
}

export async function createHarness(
  container: StartedPostgreSqlContainer,
  options: HarnessOptions = {},
): Promise<Harness> {
  const database = await createTestDatabase(container);
  const handle: DbHandle = createDb(database.appUrl);
  const superPool = new pg.Pool({ connectionString: database.superUrl });
  // TEST_LOG_LEVEL=error shows server-side failures while debugging a test.
  const logger = createLogger({
    level: (process.env.TEST_LOG_LEVEL as 'error' | undefined) ?? 'silent',
  });
  const storageDir = mkdtempSync(join(tmpdir(), 'testrex-api-storage-'));
  const config = loadConfig(apiEnvSchema, {
    APP_SECRET: 'test-secret-that-is-at-least-32-characters',
    DATABASE_URL: database.appUrl,
    DATABASE_MIGRATION_URL: database.ownerUrl,
    PUBLIC_URL,
    ALLOW_SIGNUP: options.allowSignup === false ? 'false' : 'true',
    STORAGE_DIR: storageDir,
    ...(options.attachmentMaxBytes
      ? { ATTACHMENT_MAX_BYTES: String(options.attachmentMaxBytes) }
      : {}),
  });
  const services = createApiServices({
    config,
    logger,
    db: handle.db,
    mailer: options.mailer,
    quota: options.quota,
    now: options.now,
    storage: options.storage ?? new LocalStorage(storageDir),
  });
  const app = await buildServer({
    logger,
    version: { version: 'test', commit: 'test' },
    checkDatabase: async () => true,
    migrationState: () => ({ status: 'done' }),
    registerRoutes: (instance) => registerApi(instance, services),
  });
  return {
    app,
    services,
    database,
    superPool,
    client: () => new TestClient(app),
    async close() {
      await app.close();
      await handle.close();
      await superPool.end();
      rmSync(storageDir, { recursive: true, force: true });
    },
  };
}

export interface TestResponse<T = Loose> {
  status: number;
  body: T;
  headers: Record<string, unknown>;
  /** The body bytes (for downloads). */
  raw: Buffer;
}

export interface UploadFile {
  name: string;
  content: Buffer | string;
  /** What the browser claims; the API detects the real type from the content. */
  type?: string;
}

/** Keeps cookies between requests and sends the Origin a browser on PUBLIC_URL would. */
export class TestClient {
  private cookies = new Map<string, string>();
  user?: { id: string; name: string; email: string };

  constructor(private readonly app: FastifyInstance) {}

  get cookieHeader(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  /** Replaces this client's cookies (e.g. to replay an old session). */
  setCookieHeader(header: string): void {
    this.cookies = new Map(
      header
        .split('; ')
        .filter(Boolean)
        .map((pair) => pair.split('=') as [string, string]),
    );
  }

  async request<T = Loose>(
    method: InjectOptions['method'],
    url: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<TestResponse<T>> {
    const response = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
      headers: {
        origin: PUBLIC_URL,
        ...(body === undefined || Buffer.isBuffer(body)
          ? {}
          : { 'content-type': 'application/json' }),
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader } : {}),
        ...headers,
      },
    });
    const setCookie = response.headers['set-cookie'];
    for (const line of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const [pair, ...attributes] = line.split(';');
      const [name, ...value] = pair!.trim().split('=');
      const expired = attributes.some((a) => /max-age=0\b/i.test(a.trim()));
      if (expired || value.join('=') === '') this.cookies.delete(name!);
      else this.cookies.set(name!, value.join('='));
    }
    let parsed: unknown = response.body;
    try {
      parsed = response.body ? JSON.parse(response.body) : undefined;
    } catch {
      // Non-JSON body; keep the text.
    }
    return {
      status: response.statusCode,
      body: parsed as T,
      headers: response.headers,
      raw: response.rawPayload,
    };
  }

  /** Sends one file as multipart/form-data, like a browser file input. */
  upload<T = Loose>(url: string, file: UploadFile) {
    const boundary = `----testrex${Math.random().toString(16).slice(2)}`;
    const payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${file.name}"\r\n` +
          `Content-Type: ${file.type ?? 'application/octet-stream'}\r\n\r\n`,
      ),
      Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return this.request<T>('POST', url, payload, {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    });
  }

  get = <T = Loose>(url: string) => this.request<T>('GET', url);
  post = <T = Loose>(url: string, body: unknown = {}, headers?: Record<string, string>) =>
    this.request<T>('POST', url, body, headers);
  patch = <T = Loose>(url: string, body: unknown) => this.request<T>('PATCH', url, body);
  put = <T = Loose>(url: string, body: unknown) => this.request<T>('PUT', url, body);
  delete = <T = Loose>(url: string) => this.request<T>('DELETE', url);

  async signUp(name: string, email: string, headers?: Record<string, string>) {
    const res = await this.post(
      '/api/auth/sign-up/email',
      { name, email, password: PASSWORD },
      headers,
    );
    if (res.status === 200) this.user = { id: res.body.user.id, name, email };
    return res;
  }

  async signIn(email: string, password = PASSWORD) {
    const res = await this.post('/api/auth/sign-in/email', { email, password });
    if (res.status === 200) {
      this.user = { id: res.body.user.id, name: res.body.user.name, email: res.body.user.email };
    }
    return res;
  }
}

/** Registers a user and returns their signed-in client. */
export async function signedUp(
  harness: Harness,
  name: string,
  email?: string,
): Promise<TestClient> {
  const client = harness.client();
  const res = await client.signUp(
    name,
    email ?? `${name.toLowerCase().replace(/\W+/g, '.')}@example.com`,
  );
  if (res.status !== 200)
    throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return client;
}

/** Creates an organization owned by `owner` and returns its slug. */
export async function createOrg(owner: TestClient, name: string, slug?: string): Promise<string> {
  const res = await owner.post('/api/orgs', { name, ...(slug ? { slug } : {}) });
  if (res.status !== 201) throw new Error(`org creation failed: ${JSON.stringify(res.body)}`);
  return res.body.slug;
}

/** Adds `member` to an organization with `role` through the invitation flow. */
export async function addMember(
  owner: TestClient,
  slug: string,
  member: TestClient,
  role: 'owner' | 'admin' | 'member' = 'member',
): Promise<void> {
  const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
    email: member.user!.email,
    role,
  });
  if (invite.status !== 201) throw new Error(`invite failed: ${JSON.stringify(invite.body)}`);
  const token = decodeURIComponent(invite.body.link.split('/invite/')[1]);
  const accept = await member.post(`/api/invitations/${token}/accept`);
  if (accept.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accept.body)}`);
}

/** Mailer that records messages instead of sending them. */
export function recordingMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    enabled: true,
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

/** Grants `member` (an organization member) a role on an application. */
export async function grantAppRole(
  manager: TestClient,
  slug: string,
  appKey: string,
  member: TestClient,
  role: 'manager' | 'editor' | 'tester' | 'viewer',
): Promise<void> {
  const res = await manager.put(`/api/orgs/${slug}/apps/${appKey}/members/${member.user!.id}`, {
    role,
  });
  if (res.status !== 200) throw new Error(`grant failed: ${JSON.stringify(res.body)}`);
}

/** Creates an application and returns its key. */
export async function createApp(owner: TestClient, slug: string, name: string, key: string) {
  const res = await owner.post(`/api/orgs/${slug}/apps`, { name, key });
  if (res.status !== 201) throw new Error(`app creation failed: ${JSON.stringify(res.body)}`);
  return key;
}

export interface ScenarioTeam {
  slug: string;
  owner: TestClient;
  manager: TestClient;
  editor: TestClient;
  editor2: TestClient;
  tester: TestClient;
  viewer: TestClient;
  /** Base URL of application CHK's API. */
  chk: string;
  /** Base URL of application PAY's API (same organization). */
  pay: string;
}

/**
 * An organization "acme" with applications CHK and PAY and one member per application role
 * on CHK (Ana and Luis are both editors). Everyone except the owner is an organization member.
 */
export async function scenarioTeam(harness: Harness): Promise<ScenarioTeam> {
  const owner = await signedUp(harness, 'Olivia Owner');
  const manager = await signedUp(harness, 'Mia Manager');
  const editor = await signedUp(harness, 'Ana Editor');
  const editor2 = await signedUp(harness, 'Luis Editor');
  const tester = await signedUp(harness, 'Tom Tester');
  const viewer = await signedUp(harness, 'Vera Viewer');
  const slug = await createOrg(owner, 'Acme QA', 'acme');
  await createApp(owner, slug, 'Checkout', 'CHK');
  await createApp(owner, slug, 'Payments', 'PAY');
  const roles = [
    [manager, 'manager'],
    [editor, 'editor'],
    [editor2, 'editor'],
    [tester, 'tester'],
    [viewer, 'viewer'],
  ] as const;
  for (const [member, role] of roles) {
    await addMember(owner, slug, member, 'member');
    await grantAppRole(owner, slug, 'CHK', member, role);
  }
  await grantAppRole(owner, slug, 'PAY', editor, 'editor');
  return {
    slug,
    owner,
    manager,
    editor,
    editor2,
    tester,
    viewer,
    chk: `/api/orgs/${slug}/apps/CHK`,
    pay: `/api/orgs/${slug}/apps/PAY`,
  };
}
