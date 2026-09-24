import { expect, test } from '@playwright/test';
import { createAppViaApi, createOrgViaApi, registerViaApi, unique } from './helpers';

test.describe('app shell', () => {
  let alpha: string;
  let beta: string;
  let alphaName: string;
  let betaName: string;

  test.beforeEach(async ({ page }) => {
    await registerViaApi(page.request, 'Sam Switcher');
    alphaName = unique('Alpha');
    betaName = unique('Beta');
    alpha = await createOrgViaApi(page.request, alphaName);
    beta = await createOrgViaApi(page.request, betaName);
    await createAppViaApi(page.request, alpha, 'Alpha Web', 'ALP');
    await createAppViaApi(page.request, beta, 'Beta Billing', 'BET');
  });

  test('switching organizations updates the URL and the data shown', async ({ page }) => {
    await page.goto(`/o/${alpha}`);
    await expect(page.getByRole('heading', { name: 'Alpha Web' })).toBeVisible();

    await page.getByRole('button', { name: 'Switch organization' }).click();
    await page.getByRole('menuitem', { name: betaName }).click();

    await expect(page).toHaveURL(new RegExp(`/o/${beta}$`));
    await expect(page.getByRole('heading', { name: 'Beta Billing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Alpha Web' })).toHaveCount(0);
  });

  test('the app switcher opens applications of the current organization', async ({ page }) => {
    await page.goto(`/o/${alpha}`);
    await page.getByRole('button', { name: 'Switch application' }).click();
    await expect(page.getByRole('menuitem', { name: /Beta Billing/ })).toHaveCount(0);
    await page.getByRole('menuitem', { name: /Alpha Web/ }).click();
    await expect(page).toHaveURL(new RegExp(`/o/${alpha}/a/ALP$`));
  });

  test('the command menu (Ctrl+K) jumps to an application', async ({ page }) => {
    await page.goto(`/o/${alpha}`);
    await expect(page.getByRole('heading', { name: 'Applications' })).toBeVisible();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command menu' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox').fill('alpha web');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/o/${alpha}/a/ALP$`));
    await expect(dialog).toBeHidden();
  });

  test('dark mode is toggled and remembered', async ({ page }) => {
    await page.goto(`/o/${alpha}`);
    await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/dark/);
    await page.getByRole('button', { name: 'Switch to light theme' }).click();
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('the interface can be switched to Spanish', async ({ page }) => {
    await page.goto(`/o/${alpha}`);
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('menuitem', { name: 'Español' }).click();
    await expect(page.getByRole('heading', { name: 'Aplicaciones' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Aplicaciones' })).toBeVisible();
  });
});
