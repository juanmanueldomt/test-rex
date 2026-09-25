import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { BASE_URL } from '../playwright.config';

export const PASSWORD = 'correct-horse-battery';

let counter = 0;
/** Unique suffix so parallel tests never collide on emails, slugs or names. */
export function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}${counter}${Math.random().toString(36).slice(2, 6)}`;
}

export function uniqueEmail(prefix = 'user'): string {
  return `${unique(prefix)}@e2e.test`.toLowerCase();
}

const origin = { origin: BASE_URL };

/** Registers through the API; the session cookie lands in the page's browser context. */
export async function registerViaApi(
  request: APIRequestContext,
  name: string,
  email = uniqueEmail(name.split(' ')[0]),
) {
  const res = await request.post('/api/auth/sign-up/email', {
    data: { name, email, password: PASSWORD },
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return { name, email };
}

export async function createOrgViaApi(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.post('/api/orgs', { data: { name }, headers: origin });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).slug;
}

export async function createAppViaApi(
  request: APIRequestContext,
  orgSlug: string,
  name: string,
  key: string,
) {
  const res = await request.post(`/api/orgs/${orgSlug}/apps`, {
    data: { name, key },
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Owner invites `email`; returns the invitation link (no SMTP in e2e). */
export async function inviteViaApi(
  request: APIRequestContext,
  orgSlug: string,
  email: string,
  role = 'member',
): Promise<string> {
  const res = await request.post(`/api/orgs/${orgSlug}/invitations`, {
    data: { email, role },
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return (await res.json()).link;
}

export async function acceptViaApi(request: APIRequestContext, link: string) {
  const token = link.split('/invite/')[1]!;
  const res = await request.post(`/api/invitations/${token}/accept`, { headers: origin });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function grantAppRoleViaApi(
  request: APIRequestContext,
  orgSlug: string,
  appKey: string,
  userEmail: string,
  role: string,
) {
  const members = await (await request.get(`/api/orgs/${orgSlug}/members`)).json();
  const member = members.find((m: { email: string }) => m.email === userEmail);
  const res = await request.put(`/api/orgs/${orgSlug}/apps/${appKey}/members/${member.userId}`, {
    data: { role },
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

export async function fillSignUp(
  page: Page,
  name: string,
  email: string | null,
  password = PASSWORD,
) {
  await page.getByLabel('Full name').fill(name);
  if (email !== null) await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
}

export interface ScenarioInput {
  title: string;
  status?: string;
  priority?: string;
  moduleId?: string | null;
  tags?: string[];
  versionFrom?: string;
  versionTo?: string;
  description?: string;
  stepsToReach?: string;
}

export async function createScenarioViaApi(
  request: APIRequestContext,
  orgSlug: string,
  appKey: string,
  input: ScenarioInput,
): Promise<{ key: string; id: string; revision: number }> {
  const res = await request.post(`/api/orgs/${orgSlug}/apps/${appKey}/scenarios`, {
    data: input,
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

export async function updateScenarioViaApi(
  request: APIRequestContext,
  orgSlug: string,
  appKey: string,
  key: string,
  input: Partial<ScenarioInput> & { baseRevision: number },
) {
  const res = await request.patch(`/api/orgs/${orgSlug}/apps/${appKey}/scenarios/${key}`, {
    data: input,
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

export async function createModuleViaApi(
  request: APIRequestContext,
  orgSlug: string,
  appKey: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const res = await request.post(`/api/orgs/${orgSlug}/apps/${appKey}/modules`, {
    data: { name },
    headers: origin,
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  return res.json();
}

/** A signed-in owner with a fresh organization and application CHK. */
export async function ownerWithApp(request: APIRequestContext, name = 'Ana Owner') {
  await registerViaApi(request, name);
  const slug = await createOrgViaApi(request, unique('Scenario Org'));
  await createAppViaApi(request, slug, 'Checkout Web', 'CHK');
  return { slug, app: `/o/${slug}/a/CHK` };
}

/** Registers `name` in a new browser page, adds them to the organization with an app role. */
export async function memberWithRole(
  browser: Browser,
  owner: APIRequestContext,
  slug: string,
  name: string,
  role: 'manager' | 'editor' | 'tester' | 'viewer',
) {
  const email = uniqueEmail(name.split(' ')[0]);
  const link = await inviteViaApi(owner, slug, email);
  const page = await browser.newPage();
  await registerViaApi(page.request, name, email);
  await acceptViaApi(page.request, link);
  await grantAppRoleViaApi(owner, slug, 'CHK', email, role);
  return page;
}
