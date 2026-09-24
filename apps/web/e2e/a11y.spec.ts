import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  acceptViaApi,
  createAppViaApi,
  createOrgViaApi,
  inviteViaApi,
  registerViaApi,
  unique,
  uniqueEmail,
} from './helpers';

/** WCAG 2.1 A/AA; the task requires no serious or critical violations. */
async function expectAccessible(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({
      page: label,
      rule: v.id,
      impact: v.impact,
      help: v.help,
      targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
    }));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem('testrex-theme', value);
      }, theme);
    });

    test('public pages', async ({ page, browser }) => {
      await page.goto('/sign-in');
      await expect(page.getByRole('heading', { name: 'Sign in to testRex' })).toBeVisible();
      await expectAccessible(page, 'sign-in');

      // Validation errors are part of the page too.
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText('Enter a valid email address')).toBeVisible();
      await expectAccessible(page, 'sign-in with errors');

      await page.goto('/sign-up');
      await expect(page.getByLabel('Full name')).toBeVisible();
      await expectAccessible(page, 'sign-up');

      const owner = await browser.newPage();
      await registerViaApi(owner.request, 'Axe Owner');
      const slug = await createOrgViaApi(owner.request, unique('Axe Invite Org'));
      const link = await inviteViaApi(owner.request, slug, uniqueEmail('axe'));
      await owner.close();
      await page.goto(link);
      await expect(page.getByRole('link', { name: 'Create account' })).toBeVisible();
      await expectAccessible(page, 'invitation');

      await page.goto('/o/some-org');
      await expect(page).toHaveURL(/sign-in/);
    });

    test('signed-in pages', async ({ page, browser }) => {
      await registerViaApi(page.request, 'Axe Admin');
      await page.goto('/onboarding');
      await expect(page.getByLabel('Organization name')).toBeVisible();
      await expectAccessible(page, 'onboarding');

      const slug = await createOrgViaApi(page.request, unique('Axe Org'));
      await createAppViaApi(page.request, slug, 'Checkout Web', 'CHK');
      const memberEmail = uniqueEmail('axemember');
      const link = await inviteViaApi(page.request, slug, memberEmail);
      const member = await browser.newPage();
      await registerViaApi(member.request, 'Axe Member', memberEmail);
      await acceptViaApi(member.request, link);
      await member.close();

      await page.goto(`/o/${slug}`);
      await expect(page.getByRole('heading', { name: 'Checkout Web' })).toBeVisible();
      await expectAccessible(page, 'applications');

      await page.getByRole('button', { name: 'New application' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page, 'new application dialog');
      await page.keyboard.press('Escape');

      await page.keyboard.press('Control+k');
      await expect(page.getByRole('dialog', { name: 'Command menu' })).toBeVisible();
      await expectAccessible(page, 'command menu');
      await page.keyboard.press('Escape');

      await page.goto(`/o/${slug}/a/CHK`);
      await expect(page.getByRole('heading', { name: 'Checkout Web' })).toBeVisible();
      await expectAccessible(page, 'application home');

      for (const tab of ['general', 'members', 'archive']) {
        await page.goto(`/o/${slug}/a/CHK/settings?tab=${tab}`);
        await expect(page.getByRole('heading', { name: 'Application settings' })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectAccessible(page, `application settings: ${tab}`);
      }

      for (const tab of ['general', 'members', 'invitations', 'audit']) {
        await page.goto(`/o/${slug}/settings?tab=${tab}`);
        await expect(page.getByRole('heading', { name: 'Organization settings' })).toBeVisible();
        await page.waitForLoadState('networkidle');
        await expectAccessible(page, `organization settings: ${tab}`);
      }

      await page.goto('/o/not-a-real-org');
      await expect(page.getByRole('heading', { name: 'Not found or no access' })).toBeVisible();
      await expectAccessible(page, 'not found');
    });
  });
}
