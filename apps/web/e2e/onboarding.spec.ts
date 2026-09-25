import { expect, test } from '@playwright/test';
import { registerViaApi, unique, uniqueEmail } from './helpers';

test('onboarding creates the organization and first application, then lands on the application', async ({
  page,
}) => {
  await registerViaApi(page.request, 'Nora Nuevo');
  await page.goto('/onboarding');

  const orgName = unique('Acme QA');
  await expect(page.getByText('Step 1 of 3')).toBeVisible();
  await page.getByLabel('Organization name').fill(orgName);
  const slug = await page.getByLabel('URL').inputValue();
  expect(slug).toBe(orgName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Step 2 of 3')).toBeVisible();
  await page.getByLabel('Application name').fill('Checkout Web');
  await expect(page.getByLabel('Key')).toHaveValue('CW');
  await expect(page.getByText('Prefixes item IDs, like CW-TC-1')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByText('Step 3 of 3')).toBeVisible();
  await page.getByRole('button', { name: 'Skip for now' }).click();

  // The application home opens on the test scenarios tab.
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CW/scenarios$`));
  await expect(page.getByRole('heading', { name: 'Checkout Web' })).toBeVisible();
  await expect(page.getByText('No test scenarios yet')).toBeVisible();
});

test('invitations sent during onboarding are shown as copyable links', async ({ page }) => {
  await registerViaApi(page.request, 'Iris Invita');
  await page.goto('/onboarding');
  await page.getByLabel('Organization name').fill(unique('Team Org'));
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Application name').fill('Mobile API');
  await page.getByRole('button', { name: 'Continue' }).click();

  const email = uniqueEmail('mate');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Role').selectOption('admin');
  await page.getByRole('button', { name: 'Send invitations' }).click();

  const link = page.getByRole('textbox', { name: `Invitation link ${email}` });
  await expect(link).toHaveValue(/\/invite\//);
  await page.getByRole('button', { name: 'Go to Mobile API' }).click();
  await expect(page.getByRole('heading', { name: 'Mobile API' })).toBeVisible();
});
