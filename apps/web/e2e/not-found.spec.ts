import { expect, test } from '@playwright/test';
import { createAppViaApi, createOrgViaApi, registerViaApi, unique } from './helpers';

test("another organization's URL shows a friendly not-found page", async ({ page, browser }) => {
  const other = await browser.newPage();
  await registerViaApi(other.request, 'Private Owner');
  const privateSlug = await createOrgViaApi(other.request, unique('Private Org'));
  await createAppViaApi(other.request, privateSlug, 'Secret App', 'SEC');
  await other.close();

  await registerViaApi(page.request, 'Curious Visitor');
  for (const url of [`/o/${privateSlug}`, `/o/${privateSlug}/a/SEC`, '/o/does-not-exist-at-all']) {
    await page.goto(url);
    await expect(page.getByRole('heading', { name: 'Not found or no access' })).toBeVisible();
    await expect(page.getByText('Secret App')).toHaveCount(0);
  }
  await page.getByRole('link', { name: 'Go to my organizations' }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('an unknown application inside my organization shows not-found within the shell', async ({
  page,
}) => {
  await registerViaApi(page.request, 'Shell User');
  const slug = await createOrgViaApi(page.request, unique('Shell Org'));
  await page.goto(`/o/${slug}/a/NOPE`);
  await expect(page.getByRole('heading', { name: 'Not found or no access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch organization' })).toBeVisible();
});
