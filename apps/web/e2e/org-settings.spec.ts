import { expect, test } from '@playwright/test';
import { createOrgViaApi, fillSignUp, registerViaApi, unique, uniqueEmail } from './helpers';

test('an admin invites by link, the invitee joins, and the admin changes their role', async ({
  page,
  browser,
}) => {
  await registerViaApi(page.request, 'Olga Owner');
  const orgName = unique('Settings Org');
  const slug = await createOrgViaApi(page.request, orgName);

  // Invite by link (no email delivery configured).
  await page.goto(`/o/${slug}/settings?tab=invitations`);
  const invitee = uniqueEmail('pablo');
  await page.getByLabel('Email address').fill(invitee);
  await page.getByRole('button', { name: 'Invite' }).click();
  await expect(page.getByText('Share this invitation link')).toBeVisible();
  const link = await page.getByRole('textbox', { name: 'Invitation link' }).inputValue();
  expect(link).toContain('/invite/');
  await expect(page.getByRole('cell', { name: invitee, exact: true })).toBeVisible();

  // The invitee opens the link in their own browser and joins.
  const guest = await browser.newPage();
  await guest.goto(link);
  await guest.getByRole('link', { name: 'Create account' }).click();
  await fillSignUp(guest, 'Pablo Ruiz', null);
  await expect(guest).toHaveURL(new RegExp(`/o/${slug}$`));
  await guest.close();

  // Change the new member's role inline.
  await page.goto(`/o/${slug}/settings?tab=members`);
  const roleSelect = page.getByRole('combobox', { name: 'Role for Pablo Ruiz' });
  await expect(roleSelect).toHaveValue('member');
  await roleSelect.selectOption('admin');
  await expect(page.getByText('Pablo Ruiz is now Admin')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Role for Pablo Ruiz' })).toHaveValue('admin');

  // The audit log shows both events and can be filtered.
  await page.getByRole('tab', { name: 'Audit log' }).click();
  await expect(page.getByRole('cell', { name: 'Joined' })).toBeVisible();
  await page.getByLabel('What').selectOption('member.role_changed');
  await expect(page.getByRole('cell', { name: 'Changed role' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Joined' })).toHaveCount(0);
  await expect(page.getByText('Role: Member → Admin')).toBeVisible();
});

test('the last owner is told to appoint another owner before leaving', async ({ page }) => {
  await registerViaApi(page.request, 'Lone Owner');
  const slug = await createOrgViaApi(page.request, unique('Solo Org'));
  await page.goto(`/o/${slug}/settings?tab=members`);
  await page.getByRole('button', { name: 'Leave organization' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Leave organization' }).click();
  await expect(page.getByText('An organization needs at least one owner')).toBeVisible();
});

test('the organization can be renamed', async ({ page }) => {
  await registerViaApi(page.request, 'Rita Renamer');
  const slug = await createOrgViaApi(page.request, unique('Old Name'));
  await page.goto(`/o/${slug}/settings`);
  const newName = unique('New Name');
  await page.getByLabel('Organization name').fill(newName);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Changes saved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText(newName);
});
