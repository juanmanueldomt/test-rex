import { expect, test } from '@playwright/test';
import { createScenarioViaApi, memberWithRole, ownerWithApp } from './helpers';

test('Default tab: the application home opens on test scenarios', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await page.goto(app);
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/scenarios$`));
  const tabs = page.getByRole('navigation', { name: 'Application sections' });
  await expect(tabs.getByRole('link', { name: /Test scenarios/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(tabs.getByRole('link', { name: 'Test runs' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('Switch tabs without reloading; Open test runs shows the placeholder', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await page.goto(`${app}/scenarios`);
  // A full reload would reset this marker.
  await page.evaluate(() => ((window as unknown as { marker: number }).marker = 42));
  await page.getByRole('link', { name: 'Test runs' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/runs$`));
  await expect(page.getByRole('link', { name: 'Test runs' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByText('Test runs are under construction')).toBeVisible();
  await expect(page.getByRole('button', { name: /new|create/i })).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { marker?: number }).marker)).toBe(42);

  // Keyboard: g then s goes back to the scenarios tab.
  await page.keyboard.press('g');
  await page.keyboard.press('s');
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/scenarios$`));
});

test('Scenario count on tab and reloading a filtered view keeps the tab', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  for (const title of ['One', 'Two', 'Three']) {
    await createScenarioViaApi(page.request, slug, 'CHK', { title, tags: ['smoke'] });
  }
  await page.goto(`${app}/scenarios?tag=smoke`);
  const tab = page.getByRole('link', { name: /Test scenarios/ });
  await expect(tab).toContainText('3');
  await page.reload();
  await expect(tab).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Tags: @smoke')).toBeVisible();
});

test('Viewer sees the workspace read-only', async ({ page, browser }) => {
  const { slug, app } = await ownerWithApp(page.request);
  const viewer = await memberWithRole(browser, page.request, slug, 'Vera Viewer', 'viewer');
  await viewer.goto(app);
  await expect(viewer.getByText('No test scenarios yet')).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'New scenario' })).toHaveCount(0);
  await viewer.close();
});
