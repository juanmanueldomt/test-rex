import { expect, test, type Page } from '@playwright/test';
import { createScenarioViaApi, memberWithRole, ownerWithApp } from './helpers';

async function pickCombobox(page: Page, label: string, text: string, option: string | RegExp) {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('combobox', { name: label }).fill(text);
  await page.getByRole('option', { name: option }).click();
}

test('Create a scenario with an inline module, new tags and a description', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request, 'Ana Owner');
  await page.goto(`${app}/scenarios`);
  await page.getByRole('link', { name: 'New scenario' }).first().click();
  await expect(page.getByRole('heading', { name: 'New test scenario' })).toBeVisible();

  await page.getByLabel('Title').fill('Guest checkout with coupon');
  await pickCombobox(page, 'Module', 'Checkout', 'Create module “Checkout”');
  await expect(page.getByText('Module Checkout created')).toBeVisible();
  await pickCombobox(page, 'Tags', 'smoke', 'Add @smoke');
  await page.getByRole('combobox', { name: 'Tags' }).fill('@Cart');
  await page.getByRole('option', { name: 'Add @cart' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('textbox', { name: 'Description' }).click();
  await page.keyboard.type('A guest applies a coupon at checkout.');
  await page.getByRole('button', { name: 'Create scenario' }).click();

  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/scenarios/CHK-TS-1$`));
  await expect(page.getByRole('heading', { name: 'Guest checkout with coupon' })).toBeVisible();
  const properties = page.getByRole('complementary', { name: 'Scenario properties' });
  await expect(properties).toContainText('Draft');
  await expect(properties).toContainText('Medium');
  await expect(properties).toContainText('Checkout');
  await expect(properties).toContainText('@cart');
  await expect(properties).toContainText('@smoke');
  await expect(properties).toContainText('Ana Owner');
  await expect(page.getByText('A guest applies a coupon at checkout.')).toBeVisible();
  await expect(page.getByText('r1', { exact: true })).toBeVisible();
});

test('Title required and Invalid version text show field messages', async ({ page }) => {
  const { app } = await ownerWithApp(page.request);
  await page.goto(`${app}/scenarios/new`);
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page.getByText('Enter a title')).toBeVisible();
  await expect(page.getByLabel('Title')).toBeFocused();

  await page.getByLabel('Title').fill('Versions');
  await page.getByLabel('Up to').fill('v3.x');
  await page.getByLabel('Up to').blur();
  await expect(
    page.getByText('Use 1 to 4 numbers separated by dots, for example 3.2.1'),
  ).toBeVisible();
  await page.getByLabel('Supported from').fill('3.2');
  await page.getByLabel('Up to').fill('3.1');
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page.getByText('“From” must not be greater than “up to”')).toBeVisible();
  await expect(page).toHaveURL(/scenarios\/new$/);
});

test('Steps to reach with sections survive saving and reopening', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await page.goto(`${app}/scenarios/new`);
  await page.getByLabel('Title').fill('Sections');
  await page.getByRole('textbox', { name: 'Steps to reach' }).click();
  await page.keyboard.type('## Test data');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- user A');
  await page.keyboard.press('Enter');
  await page.keyboard.type('user B');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Navigation');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- open the cart');
  // Ctrl+S saves while typing in the editor.
  await page.keyboard.press('Control+s');
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/scenarios/CHK-TS-1$`));

  await page.reload();
  const steps = page.getByRole('region', { name: 'Steps to reach' });
  await expect(steps.getByRole('heading', { name: 'Test data' })).toBeVisible();
  await expect(steps.getByRole('heading', { name: 'Navigation' })).toBeVisible();
  await expect(steps.getByRole('listitem')).toHaveText(['user A', 'user B', 'open the cart']);
});

test('Unsaved changes: leaving the form asks for confirmation', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Keep me' });
  await page.goto(`${app}/scenarios/CHK-TS-1/edit`);
  await page.getByLabel('Title').fill('Changed title');
  // Navigating elsewhere (here: organization settings in the top bar) asks first.
  await page.getByRole('link', { name: 'Organization settings' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep editing' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Changed title');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(/scenarios\/CHK-TS-1$/);
  await expect(page.getByRole('heading', { name: 'Keep me' })).toBeVisible();
});

test('Conflicting edit: the second save names who changed it and keeps the input', async ({
  page,
  browser,
}) => {
  const { slug, app } = await ownerWithApp(page.request, 'Ana Owner');
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Shared scenario' });
  const luis = await memberWithRole(browser, page.request, slug, 'Luis Editor', 'editor');

  await page.goto(`${app}/scenarios/CHK-TS-1/edit`);
  await luis.goto(`${app}/scenarios/CHK-TS-1/edit`);
  await luis.getByLabel('Title').fill('Luis title');
  await luis.getByRole('button', { name: 'Save' }).click();
  await expect(luis).toHaveURL(/scenarios\/CHK-TS-1$/);

  await page.getByLabel('Title').fill('Ana title');
  await page.getByRole('button', { name: 'Save' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Someone else changed this scenario' });
  await expect(dialog).toContainText('Luis Editor saved r2');
  await expect(dialog.getByRole('link', { name: 'Compare r1 with r2' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep my changes' }).click();
  await expect(page.getByLabel('Title')).toHaveValue('Ana title');
  await luis.close();
});

test.describe('scenario page', () => {
  test('Delete and Restore keep the key and history', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Doomed' });
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    await page.getByRole('button', { name: 'Delete' }).click();
    await page
      .getByRole('alertdialog', { name: 'Delete CHK-TS-1?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText(/This scenario was deleted/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);

    await page.goto(`${app}/scenarios`);
    await expect(page.getByText('No test scenarios yet')).toBeVisible();

    await page.goto(`${app}/scenarios/CHK-TS-1`);
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByText(/This scenario was deleted/)).toHaveCount(0);
    await page.goto(`${app}/scenarios`);
    await expect(page.getByRole('gridcell', { name: 'CHK-TS-1' })).toBeVisible();
  });

  test('Viewer can read everything, with no editing actions', async ({ page, browser }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', {
      title: 'Readable',
      description: 'Visible **description**',
      tags: ['smoke'],
    });
    const viewer = await memberWithRole(browser, page.request, slug, 'Vera Viewer', 'viewer');
    await viewer.goto(`${app}/scenarios/CHK-TS-1`);
    await expect(viewer.getByRole('heading', { name: 'Readable' })).toBeVisible();
    await expect(viewer.getByText('Visible')).toBeVisible();
    await expect(viewer.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Delete' })).toHaveCount(0);
    await expect(viewer.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await expect(viewer.getByRole('textbox', { name: 'Comment' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: 'Add link' })).toHaveCount(0);
    await expect(viewer.getByText('Drop files here or')).toHaveCount(0);
    await viewer.getByRole('tab', { name: 'History' }).click();
    await expect(viewer.getByText('Created the scenario')).toBeVisible();
    // e does nothing for a viewer.
    await viewer.keyboard.press('e');
    await expect(viewer).not.toHaveURL(/edit$/);
    await viewer.close();
  });

  test('Test cases placeholder', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Placeholder' });
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    await page.getByRole('tab', { name: 'Test cases (0)' }).click();
    await expect(page.getByText('Test cases are coming soon')).toBeVisible();
    await expect(page.getByRole('tabpanel').getByRole('button')).toHaveCount(0);
  });

  test('e opens the editor; Ctrl+S saves and a no-op save creates no revision', async ({
    page,
  }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Keyboard' });
    await page.goto(`${app}/scenarios/CHK-TS-1`);
    // Shortcuts are registered once the page has rendered.
    await expect(page.getByRole('heading', { name: 'Keyboard' })).toBeVisible();
    await page.keyboard.press('e');
    await expect(page).toHaveURL(/CHK-TS-1\/edit$/);
    await page.getByLabel('Status').selectOption('ready');
    await page.keyboard.press('Control+s');
    await expect(page).toHaveURL(/CHK-TS-1$/);
    await expect(page.getByText('r2', { exact: true })).toBeVisible();
    await expect(page.getByText('Ready').first()).toBeVisible();
  });
});

test.describe('keyboard shortcut help', () => {
  test('Help dialog lists the shortcuts of the page and Esc closes it', async ({ page }) => {
    const { app } = await ownerWithApp(page.request);
    await page.goto(`${app}/scenarios`);
    await expect(page.getByText('No test scenarios yet')).toBeVisible();
    await page.keyboard.press('Shift+?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    for (const text of [
      'New scenario',
      'Search scenarios',
      'Go to test runs',
      'Open the command menu',
    ]) {
      await expect(dialog.getByText(text)).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('Disable single-key shortcuts: c does nothing, Ctrl+S still saves', async ({ page }) => {
    const { slug, app } = await ownerWithApp(page.request);
    await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Opt out' });
    await page.goto(`${app}/scenarios`);
    await expect(page.getByRole('gridcell', { name: 'Opt out' })).toBeVisible();
    await page.keyboard.press('Shift+?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await dialog.getByLabel('Single-key shortcuts').uncheck();
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page.getByRole('gridcell', { name: 'Opt out' })).toBeVisible();
    await page.keyboard.press('c');
    await expect(page).not.toHaveURL(/new$/);

    await page.goto(`${app}/scenarios/CHK-TS-1/edit`);
    await page.getByLabel('Title').fill('Saved with Ctrl+S');
    await page.keyboard.press('Control+s');
    await expect(page).toHaveURL(/CHK-TS-1$/);
    await expect(page.getByRole('heading', { name: 'Saved with Ctrl+S' })).toBeVisible();
  });

  test('Typing does not trigger shortcuts', async ({ page }) => {
    const { app } = await ownerWithApp(page.request);
    await page.goto(`${app}/scenarios`);
    await expect(page.getByText('No test scenarios yet')).toBeVisible();
    await page.keyboard.press('/');
    const search = page.getByRole('searchbox', { name: 'Search scenarios' });
    await expect(search).toBeFocused();
    await page.keyboard.type('c');
    await expect(search).toHaveValue('c');
    await expect(page).not.toHaveURL(/new$/);
  });
});
