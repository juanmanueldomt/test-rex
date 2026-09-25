import { expect, test } from '@playwright/test';
import { createModuleViaApi, createScenarioViaApi, memberWithRole, ownerWithApp } from './helpers';

test('Grid columns: key, title, status, module, priority, tags, test cases, author, updated', async ({
  page,
}) => {
  const { slug, app } = await ownerWithApp(page.request, 'Ana Owner');
  const module = await createModuleViaApi(page.request, slug, 'CHK', 'Checkout');
  await createScenarioViaApi(page.request, slug, 'CHK', {
    title: 'Guest checkout with coupon',
    moduleId: module.id,
    priority: 'high',
    status: 'ready',
    tags: ['smoke', 'cart'],
  });
  await page.goto(`${app}/scenarios`);
  const grid = page.getByRole('grid', { name: 'Test scenarios' });
  await expect(grid.getByRole('columnheader')).toHaveText([
    'Key',
    'Title',
    'Status',
    'Module',
    'Priority',
    'Tags',
    'Test cases',
    'Author',
    'Updated',
  ]);
  const cells = grid.getByRole('row').nth(1).getByRole('gridcell');
  await expect(cells).toHaveText([
    'CHK-TS-1',
    'Guest checkout with coupon',
    'Ready',
    'Checkout',
    'High',
    '@cart@smoke',
    '0',
    'Ana Owner',
    /now|minute|second/,
  ]);
  // Exact time and last editor on keyboard focus.
  await cells.nth(8).locator('time').focus();
  await expect(page.getByRole('tooltip')).toContainText('Ana Owner');
});

test('Open a scenario by click, or by selecting it and pressing Enter', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'First' });
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Second' });
  await page.goto(`${app}/scenarios`);
  await page.getByRole('gridcell', { name: 'First' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/scenarios/CHK-TS-1$`));
  await expect(page.getByRole('heading', { name: 'First' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('grid')).toBeVisible();
  await page.keyboard.press('j'); // CHK-TS-2 (newest first)
  await page.keyboard.press('j'); // CHK-TS-1
  await page.keyboard.press('k'); // back to CHK-TS-2
  await expect(page.getByRole('row', { selected: true })).toContainText('CHK-TS-2');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/scenarios/CHK-TS-2$`));
});

test('Tag overflow: +N opens a tooltip on keyboard focus; a tag chip filters', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', {
    title: 'Many tags',
    tags: ['smoke', 'cart', 'mobile', 'payments', 'regression'],
  });
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Other', tags: ['smoke'] });
  await page.goto(`${app}/scenarios`);
  const row = page.getByRole('row', { name: /Many tags/ });
  await expect(row.getByRole('button', { name: '@cart' })).toBeVisible();
  await expect(row.getByRole('button', { name: '@mobile' })).toBeVisible();
  const more = row.getByRole('button', { name: '3 more tags' });
  await expect(more).toHaveText('+3');
  await more.focus();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText('@payments, @regression, @smoke');
  await expect(more).toHaveAttribute('aria-describedby', /.+/);

  await row.getByRole('button', { name: '@cart' }).click();
  await expect(page).toHaveURL(/tag=cart/);
  await expect(page.getByRole('row')).toHaveCount(2);
});

test('No matches: a search that finds nothing offers to clear filters', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Guest checkout' });
  await page.goto(`${app}/scenarios`);
  await page.getByRole('searchbox', { name: 'Search scenarios' }).fill('zzz-nothing');
  await expect(page.getByText('No matching scenarios')).toBeVisible();
  await expect(page).toHaveURL(/q=zzz-nothing/);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(page.getByRole('gridcell', { name: 'Guest checkout' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search scenarios' })).toHaveValue('');
});

test('New scenario button hidden for testers; c does nothing for them', async ({
  page,
  browser,
}) => {
  const { slug, app } = await ownerWithApp(page.request);
  const tester = await memberWithRole(browser, page.request, slug, 'Tom Tester', 'tester');
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Readable' });
  await tester.goto(`${app}/scenarios`);
  await expect(tester.getByRole('gridcell', { name: 'Readable' })).toBeVisible();
  await expect(tester.getByRole('link', { name: 'New scenario' })).toHaveCount(0);
  await tester.keyboard.press('c');
  await expect(tester).toHaveURL(new RegExp(`/scenarios$`));
  await tester.close();

  // An editor (here the owner) gets the button and the shortcut.
  await page.goto(`${app}/scenarios`);
  await expect(page.getByRole('link', { name: 'New scenario' })).toBeVisible();
  await page.keyboard.press('c');
  await expect(page).toHaveURL(new RegExp(`/scenarios/new$`));
});

test.describe('view state in the URL', () => {
  test('Shared view: a colleague opening the URL sees the same filter, sort and page', async ({
    page,
    browser,
  }) => {
    const { slug, app } = await ownerWithApp(page.request);
    const priorities = ['critical', 'high', 'medium', 'low'];
    for (let i = 1; i <= 30; i++) {
      await createScenarioViaApi(page.request, slug, 'CHK', {
        title: `Scenario ${i}`,
        tags: i % 2 ? ['smoke'] : ['smoke', 'nightly'],
        priority: priorities[i % 4],
      });
    }
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Untagged' });
    const url = `${app}/scenarios?page=2&sort=priority&tag=smoke`;
    const colleague = await browser.newPage();
    await colleague.context().addCookies(await page.context().cookies());
    await colleague.goto(url);
    await expect(colleague.getByText('Tags: @smoke')).toBeVisible();
    await expect(colleague.getByRole('columnheader', { name: 'Priority' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(colleague.getByRole('button', { name: 'Page 2' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(colleague.getByText('26–30 of 30')).toBeVisible();
    await expect(colleague.getByRole('gridcell', { name: 'Untagged' })).toHaveCount(0);
    await colleague.close();
  });

  test('Back button returns to the previous unfiltered view', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Draft one' });
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Ready one', status: 'ready' });
    await page.goto(`${app}/scenarios`);
    await expect(page.getByRole('row')).toHaveCount(3);
    await page
      .getByRole('group', { name: 'Filters' })
      .getByRole('button', { name: 'Status' })
      .click();
    await page.getByRole('menuitemcheckbox', { name: 'Ready' }).click();
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/status=ready/);
    await expect(page.getByRole('row')).toHaveCount(2);
    await page.goBack();
    await expect(page).not.toHaveURL(/status=/);
    await expect(page.getByRole('row')).toHaveCount(3);
  });

  test('Filter resets page: changing a filter on page 3 shows page 1', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    for (let i = 1; i <= 60; i++) {
      await createScenarioViaApi(page.request, slug, 'CHK', {
        title: `S${i}`,
        status: i % 3 ? 'draft' : 'ready',
      });
    }
    await page.goto(`${app}/scenarios?page=3`);
    await expect(page.getByText('51–60 of 60')).toBeVisible();
    await page
      .getByRole('group', { name: 'Filters' })
      .getByRole('button', { name: 'Status' })
      .click();
    await page.getByRole('menuitemcheckbox', { name: 'Draft' }).click();
    await page.keyboard.press('Escape');
    await expect(page).not.toHaveURL(/page=/);
    await expect(page.getByText('1–25 of 40')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Page 1' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('Sort by updated: the second activation lists the oldest update first', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Older' });
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Newer' });
    await page.goto(`${app}/scenarios`);
    const header = page.getByRole('columnheader', { name: 'Updated' });
    await expect(header).toHaveAttribute('aria-sort', 'none');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await header.getByRole('button').click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(page).toHaveURL(/sort=updated/);
    await expect(page.getByRole('row').nth(1)).toContainText('Older');
  });

  test('a page beyond the end shows the last page', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Only one' });
    await page.goto(`${app}/scenarios?page=9`);
    await expect(page.getByRole('gridcell', { name: 'Only one' })).toBeVisible();
    await expect(page).not.toHaveURL(/page=9/);
  });
});
