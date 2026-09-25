import { expect, test, type APIRequestContext } from '@playwright/test';
import {
  createScenarioViaApi,
  memberWithRole,
  ownerWithApp,
  updateScenarioViaApi,
} from './helpers';

/** CHK-TS-1 with r1..r4: r2 status ready, r3 description changed, r4 title changed. */
async function scenarioWithHistory(request: APIRequestContext, slug: string) {
  await createScenarioViaApi(request, slug, 'CHK', {
    title: 'Guest checkout',
    description: 'Apply coupon SAVE10\n\nThen pay.',
  });
  await updateScenarioViaApi(request, slug, 'CHK', 'CHK-TS-1', {
    baseRevision: 1,
    status: 'ready',
  });
  await updateScenarioViaApi(request, slug, 'CHK', 'CHK-TS-1', {
    baseRevision: 2,
    description: 'Apply coupon SAVE20\n\nThen pay.\n\nCheck the receipt.',
  });
  await updateScenarioViaApi(request, slug, 'CHK', 'CHK-TS-1', {
    baseRevision: 3,
    title: 'Guest checkout with coupon',
  });
}

test('History list, Open old revision and Restore r2', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request, 'Ana Owner');
  await scenarioWithHistory(page.request, slug);
  await page.goto(`${app}/scenarios/CHK-TS-1?tab=history`);
  const history = page.getByRole('list', { name: 'History' });
  await expect(history.getByRole('listitem')).toHaveCount(4);
  await expect(history.getByRole('listitem').nth(0)).toContainText('r4');
  await expect(history.getByRole('listitem').nth(0)).toContainText(
    'Title: Guest checkout → Guest checkout with coupon',
  );
  await expect(history.getByRole('listitem').nth(1)).toContainText('Description changed');
  await expect(history.getByRole('listitem').nth(2)).toContainText('Status: Draft → Ready');
  await expect(history.getByRole('listitem').nth(3)).toContainText('Created the scenario');

  await history.getByRole('link', { name: 'View r2' }).click();
  await expect(page).toHaveURL(/revisions\/2$/);
  await expect(page.getByText(/You are viewing r2 of 4/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Guest checkout', exact: true })).toBeVisible();
  await expect(page.getByText('Apply coupon SAVE10')).toBeVisible();

  await page.getByRole('button', { name: 'Restore this revision' }).click();
  await page
    .getByRole('alertdialog', { name: 'Restore r2?' })
    .getByRole('button', { name: 'Restore this revision' })
    .click();
  await expect(page.getByText('Restored r2 as r5')).toBeVisible();
  await expect(page.getByRole('list', { name: 'History' }).getByRole('listitem')).toHaveCount(5);
  await expect(
    page.getByRole('list', { name: 'History' }).getByRole('listitem').first(),
  ).toContainText('Restored r2');
  await expect(page.getByRole('heading', { name: 'Guest checkout', exact: true })).toBeVisible();
});

test('Unknown revision shows a not-found message', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'One revision' });
  await page.goto(`${app}/scenarios/CHK-TS-1/revisions/9`);
  await expect(page.getByText('This revision does not exist.')).toBeVisible();
});

test('Compare r2 and r4: changed fields and a marked text diff', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await scenarioWithHistory(page.request, slug);
  await page.goto(`${app}/scenarios/CHK-TS-1/compare?from=2&to=4`);
  const fields = page.getByRole('region', { name: 'Changed fields' });
  await expect(fields.getByRole('row', { name: /Title/ })).toContainText('Guest checkout');
  await expect(fields.getByRole('row', { name: /Title/ })).toContainText(
    'Guest checkout with coupon',
  );
  const diff = page.getByRole('region', { name: 'Description' }).last();
  await expect(diff.locator('del')).toContainText(['SAVE10']);
  await expect(diff.locator('ins')).toContainText(['SAVE20', 'Check the receipt.']);
  await expect(diff).toContainText('−');
  await expect(diff).toContainText('+');
});

test('Viewer cannot restore', async ({ page, browser }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await scenarioWithHistory(page.request, slug);
  const viewer = await memberWithRole(browser, page.request, slug, 'Vera Viewer', 'viewer');
  await viewer.goto(`${app}/scenarios/CHK-TS-1/revisions/2`);
  await expect(viewer.getByText(/You are viewing r2 of 4/)).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Restore this revision' })).toHaveCount(0);
  await viewer.close();
});

test.describe('comments', () => {
  test('Tester comments on r4; edit marks it edited', async ({ page, browser }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await scenarioWithHistory(page.request, slug);
    const tester = await memberWithRole(browser, page.request, slug, 'Tom Tester', 'tester');
    await tester.goto(`${app}/scenarios/CHK-TS-1`);
    await tester.getByRole('textbox', { name: 'Comment' }).fill('Coupon field is hidden on mobile');
    await tester.getByRole('button', { name: 'Comment', exact: true }).click();
    const thread = tester.getByRole('list', { name: 'Comments' });
    const comment = thread.getByRole('listitem').first();
    await expect(comment).toContainText('Tom Tester');
    await expect(comment).toContainText('on r4');
    await expect(comment).toContainText('Coupon field is hidden on mobile');

    await comment.getByRole('button', { name: 'Edit comment' }).click();
    await comment.getByRole('textbox', { name: 'Comment' }).fill('Coupon field is hidden on iOS');
    await comment.getByRole('button', { name: 'Save changes' }).click();
    await expect(comment).toContainText('Coupon field is hidden on iOS');
    await expect(comment).toContainText('(edited)');
    await tester.close();

    // A manager may delete it, and cannot edit it.
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    const managerView = page.getByRole('list', { name: 'Comments' }).getByRole('listitem').first();
    await expect(managerView.getByRole('button', { name: 'Edit comment' })).toHaveCount(0);
    await managerView.getByRole('button', { name: 'Delete comment' }).click();
    await page
      .getByRole('alertdialog', { name: 'Delete this comment?' })
      .getByRole('button', { name: 'Delete comment' })
      .click();
    await expect(page.getByText('No comments yet.')).toBeVisible();
  });

  test('Viewer cannot comment', async ({ page, browser }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Quiet' });
    const viewer = await memberWithRole(browser, page.request, slug, 'Vera Viewer', 'viewer');
    await viewer.goto(`${app}/scenarios/CHK-TS-1`);
    await expect(viewer.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await expect(viewer.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
    await viewer.close();
  });

  test('Unsafe content is shown as text and never runs', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Safety' });
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    const payload = '<script>window.__pwned = 1</script><img src=x onerror="window.__pwned = 2">';
    await page.getByRole('textbox', { name: 'Comment' }).fill(payload);
    await page.getByRole('button', { name: 'Comment', exact: true }).click();
    const comment = page.getByRole('list', { name: 'Comments' }).getByRole('listitem').first();
    await expect(comment).toContainText('<script>window.__pwned = 1</script>');
    await page.reload();
    await expect(page.getByRole('list', { name: 'Comments' })).toContainText('<script>');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBe(
      undefined,
    );
  });
});

test.describe('requirement links', () => {
  test('Jira link shows the tracker and key and opens safely in a new tab', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Linked' });
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    await page.getByRole('button', { name: 'Add link' }).click();
    await page.getByLabel('URL').fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Only http and https URLs are allowed')).toBeVisible();
    await page.getByLabel('URL').fill('https://acme.atlassian.net/browse/SHOP-481');
    await page.getByRole('button', { name: 'Save changes' }).click();
    const link = page.getByRole('link', { name: /Jira · SHOP-481/ });
    await expect(link).toHaveAttribute('href', 'https://acme.atlassian.net/browse/SHOP-481');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // The linked issue key finds the scenario from the grid.
    await page.goto(`${app}/scenarios?q=SHOP-481`);
    await expect(page.getByRole('gridcell', { name: 'Linked' })).toBeVisible();
  });

  test('Unknown tracker shows the label', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Wiki' });
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    await page.getByRole('button', { name: 'Add link' }).click();
    await page.getByLabel('URL').fill('https://wiki.acme.com/checkout');
    await page.getByLabel('Label (optional)').fill('Checkout rules');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('link', { name: /Checkout rules/ })).toHaveAttribute(
      'href',
      'https://wiki.acme.com/checkout',
    );
  });
});
