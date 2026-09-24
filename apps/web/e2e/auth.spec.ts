import { expect, test } from '@playwright/test';
import {
  createOrgViaApi,
  fillSignUp,
  inviteViaApi,
  PASSWORD,
  registerViaApi,
  unique,
  uniqueEmail,
} from './helpers';

test('a visitor registers and is taken to onboarding', async ({ page }) => {
  await page.goto('/sign-up');
  await expect(
    page.getByRole('heading', { name: /create your account|set up testrex/i }),
  ).toBeVisible();
  await fillSignUp(page, 'Ana García', uniqueEmail('ana'));
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole('heading', { name: 'Create your organization' })).toBeVisible();
});

test('a weak password is rejected with the minimum length on the field', async ({ page }) => {
  await page.goto('/sign-up');
  await fillSignUp(page, 'Bo', uniqueEmail('bo'), 'short1');
  await expect(page.getByText('Use at least 10 characters')).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveAttribute('aria-invalid', 'true');
  await expect(page).toHaveURL(/\/sign-up/);
});

test('sign-in shows a generic error, then lands on the last used organization', async ({
  page,
}) => {
  const user = await registerViaApi(page.request, 'Carla Díaz');
  const slug = await createOrgViaApi(page.request, unique('Carla Org'));
  // Start signed out.
  await page.context().clearCookies();

  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill('wrong-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Invalid email or password.')).toBeVisible();

  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
});

test('protected pages send anonymous visitors to sign-in', async ({ page }) => {
  await page.goto('/o/some-org/settings');
  await expect(page).toHaveURL(/\/sign-in\?redirect=/);
});

test('when sign-up is closed, registration explains an invitation is needed', async ({ page }) => {
  await page.route('**/api/instance', (route) =>
    route.fulfill({ json: { signupEnabled: false, needsSetup: false, emailDelivery: false } }),
  );
  await page.goto('/sign-up');
  await expect(page.getByRole('heading', { name: 'Registration is by invitation' })).toBeVisible();
  await expect(page.getByLabel('Password')).toHaveCount(0);
});

test('an invited person registers from the invitation link and joins the organization', async ({
  browser,
  page,
}) => {
  await registerViaApi(page.request, 'Olivia Owner');
  const orgName = unique('Invite Org');
  const slug = await createOrgViaApi(page.request, orgName);
  const invitee = uniqueEmail('luis');
  const link = await inviteViaApi(page.request, slug, invitee);

  const guest = await browser.newPage();
  await guest.goto(link);
  await expect(guest.getByRole('heading', { name: `You are invited to ${orgName}` })).toBeVisible();
  await guest.getByRole('link', { name: 'Create account' }).click();
  await expect(guest.getByRole('heading', { name: `Join ${orgName}` })).toBeVisible();
  await expect(guest.getByLabel('Email')).toHaveValue(invitee);
  await fillSignUp(guest, 'Luis Pérez', null);
  await expect(guest).toHaveURL(new RegExp(`/o/${slug}$`));
  await expect(guest.getByRole('button', { name: 'Switch organization' })).toContainText(orgName);
  await guest.close();
});
