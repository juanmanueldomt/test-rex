import { expect, test } from '@playwright/test';
import {
  acceptViaApi,
  createAppViaApi,
  createOrgViaApi,
  inviteViaApi,
  registerViaApi,
  unique,
  uniqueEmail,
} from './helpers';

test('create, rename, archive and restore an application', async ({ page }) => {
  await registerViaApi(page.request, 'Ada Admin');
  const slug = await createOrgViaApi(page.request, unique('Apps Org'));

  await page.goto(`/o/${slug}`);
  await expect(page.getByText('Create your first application')).toBeVisible();
  await page.getByRole('button', { name: 'New application' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New application' });
  await dialog.getByLabel('Application name').fill('Payments Service');
  await expect(dialog.getByLabel('Key')).toHaveValue('PS');
  await dialog.getByLabel('Key').fill('PAY');
  await dialog.getByRole('button', { name: 'Create application' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/PAY$`));
  await expect(page.getByRole('heading', { name: 'Payments Service' })).toBeVisible();

  // Rename; the key stays.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Key')).toHaveValue('PAY');
  await expect(page.getByLabel('Key')).toHaveAttribute('readonly', '');
  await page.getByLabel('Name', { exact: true }).fill('Payments');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved')).toBeVisible();

  // Archive with confirmation; it disappears from the default list.
  await page.getByRole('tab', { name: 'Archive' }).click();
  await page.getByRole('button', { name: 'Archive application' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Archive application' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}$`));
  await expect(page.getByRole('heading', { name: 'Payments' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Show archived' }).click();
  await page.getByRole('link', { name: /Payments/ }).click();
  await expect(page.getByText('This application is archived and read-only.')).toBeVisible();
  await page.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('This application is archived and read-only.')).toHaveCount(0);
});

test('app members: a viewer sees the app but none of the management controls', async ({
  page,
  browser,
}) => {
  await registerViaApi(page.request, 'Manu Manager');
  const slug = await createOrgViaApi(page.request, unique('Access Org'));
  await createAppViaApi(page.request, slug, 'Checkout', 'CHK');
  await createAppViaApi(page.request, slug, 'Billing', 'BIL');

  const viewerEmail = uniqueEmail('vera');
  const link = await inviteViaApi(page.request, slug, viewerEmail, 'member');
  const viewer = await browser.newPage();
  await registerViaApi(viewer.request, 'Vera Viewer', viewerEmail);
  await acceptViaApi(viewer.request, link);

  // Before access: the member sees no applications and cannot create one.
  await viewer.goto(`/o/${slug}`);
  await expect(viewer.getByText('No applications yet')).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'New application' })).toHaveCount(0);

  // Manager grants viewer access through the application members table.
  await page.goto(`/o/${slug}/a/CHK/settings?tab=members`);
  await page.getByRole('combobox', { name: 'Role for Vera Viewer' }).selectOption('viewer');
  await expect(page.getByText('Access updated for Vera Viewer')).toBeVisible();

  await viewer.reload();
  await expect(viewer.getByRole('heading', { name: 'Checkout' })).toBeVisible();
  await expect(viewer.getByRole('heading', { name: 'Billing' })).toHaveCount(0);
  await viewer.getByRole('link', { name: /Checkout/ }).click();
  await expect(viewer.getByText('Viewer')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('link', { name: 'Open settings' })).toHaveCount(0);

  // Settings are read-only for a viewer: no save button, no role pickers, no archive tab.
  await viewer.goto(`/o/${slug}/a/CHK/settings`);
  await expect(
    viewer.getByText('Only application managers can change these settings.'),
  ).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Save changes' })).toHaveCount(0);
  await expect(viewer.getByRole('tab', { name: 'Archive' })).toHaveCount(0);
  await viewer.getByRole('tab', { name: 'Members' }).click();
  await expect(viewer.getByRole('combobox')).toHaveCount(0);
  await viewer.close();
});

test('an organization admin is an implicit manager of every application', async ({
  page,
  browser,
}) => {
  await registerViaApi(page.request, 'Owen Owner');
  const slug = await createOrgViaApi(page.request, unique('Implicit Org'));
  await createAppViaApi(page.request, slug, 'Search', 'SRC');
  const adminEmail = uniqueEmail('adri');
  const link = await inviteViaApi(page.request, slug, adminEmail, 'admin');
  const admin = await browser.newPage();
  await registerViaApi(admin.request, 'Adri Admin', adminEmail);
  await acceptViaApi(admin.request, link);

  await admin.goto(`/o/${slug}/a/SRC/settings?tab=members`);
  await expect(admin.getByRole('row', { name: /Adri Admin/ })).toContainText(
    'via organization admin',
  );
  await admin.close();
});
