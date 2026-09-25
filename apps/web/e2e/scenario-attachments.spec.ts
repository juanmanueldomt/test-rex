import { expect, test, type Page } from '@playwright/test';
import { createScenarioViaApi, memberWithRole, ownerWithApp } from './helpers';

// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const pdf = (bytes: number) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(bytes - 9, 0x20)]);

/** Pastes an image file into a rich-text editor, like a screenshot from the clipboard. */
async function pasteImage(page: Page, editorName: string, fileName: string) {
  const editor = page.getByRole('textbox', { name: editorName });
  await editor.click();
  await editor.evaluate(
    (element, { base64, name }) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type: 'image/png' }));
      element.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    },
    { base64: PNG.toString('base64'), name: fileName },
  );
  // The uploaded image appears in the editor, served by the attachment endpoint.
  await expect(editor.locator('img[src*="/attachments/"]')).toHaveCount(1);
}

async function imageLoaded(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate(async (img: HTMLImageElement) => {
      if (!img.complete) await new Promise((resolve) => img.addEventListener('load', resolve));
      return img.naturalWidth > 0;
    });
}

test('Upload: the file is listed with name, size, uploader and time', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request, 'Ana Owner');
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'With files' });
  await page.goto(`${app}/scenarios/CHK-TS-1`);
  await page.getByLabel('Attach files').setInputFiles({
    name: 'checkout-flow.pdf',
    mimeType: 'application/pdf',
    buffer: pdf(2 * 1024 * 1024),
  });
  const list = page.getByRole('list', { name: 'Attachments' });
  const item = list.getByRole('listitem').filter({ hasText: 'checkout-flow.pdf' });
  await expect(item).toBeVisible();
  await expect(item).toContainText('2 MB');
  await expect(item).toContainText('Ana Owner');
});

test('File too large: rejected with a message stating the limit', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Too big' });
  await page.goto(`${app}/scenarios/CHK-TS-1`);
  await page.getByLabel('Attach files').setInputFiles({
    name: 'huge.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(26 * 1024 * 1024, 1),
  });
  await expect(page.getByText('huge.bin is larger than the 25 MB limit.')).toBeVisible();
  await expect(page.getByText('No attachments.')).toBeVisible();
});

test('Viewer downloads an attachment', async ({ page, browser }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Download me' });
  await page.goto(`${app}/scenarios/CHK-TS-1`);
  await page.getByLabel('Attach files').setInputFiles({
    name: 'report.html',
    mimeType: 'text/html',
    buffer: Buffer.from('<!doctype html><h1>Report</h1>'),
  });
  await expect(page.getByRole('link', { name: 'Download report.html' })).toBeVisible();

  const viewer = await memberWithRole(browser, page.request, slug, 'Vera Viewer', 'viewer');
  await viewer.goto(`${app}/scenarios/CHK-TS-1`);
  await expect(viewer.getByText('Drop files here or')).toHaveCount(0);
  const [download] = await Promise.all([
    viewer.waitForEvent('download'),
    viewer.getByRole('link', { name: 'Download report.html' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('report.html');
  await viewer.close();
});

test('Paste screenshot while editing: shown in place and listed as an attachment', async ({
  page,
}) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Screenshots' });
  await page.goto(`${app}/scenarios/CHK-TS-1/edit`);
  await pasteImage(page, 'Steps to reach', 'screenshot.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/CHK-TS-1$/);
  const steps = page.getByRole('region', { name: 'Steps to reach' });
  await expect(steps.locator('img')).toHaveCount(1);
  expect(await imageLoaded(page, 'section[aria-labelledby="steps-heading"] img')).toBe(true);
  await expect(
    page.getByRole('list', { name: 'Attachments' }).getByText('screenshot.png'),
  ).toBeVisible();
});

test('Paste before first save: the new scenario shows and lists the image', async ({ page }) => {
  const { slug, app } = await ownerWithApp(page.request);
  await page.goto(`${app}/scenarios/new`);
  await page.getByLabel('Title').fill('Pasted before saving');
  await pasteImage(page, 'Description', 'pasted.png');
  await page.getByRole('button', { name: 'Create scenario' }).click();
  await expect(page).toHaveURL(new RegExp(`/o/${slug}/a/CHK/scenarios/CHK-TS-1$`));
  await expect(page.getByRole('region', { name: 'Description' }).locator('img')).toHaveCount(1);
  expect(await imageLoaded(page, 'section[aria-labelledby="description-heading"] img')).toBe(true);
  await expect(
    page.getByRole('list', { name: 'Attachments' }).getByText('pasted.png'),
  ).toBeVisible();
});

test('Remove embedded image: gone from the list, still shown by the old revision', async ({
  page,
}) => {
  const { slug, app } = await ownerWithApp(page.request);
  await createScenarioViaApi(page.request, slug, 'CHK', { title: 'Removable' });
  // r2 embeds the image.
  await page.goto(`${app}/scenarios/CHK-TS-1/edit`);
  await pasteImage(page, 'Description', 'embedded.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/CHK-TS-1$/);
  // r3 drops it from the text.
  await page.goto(`${app}/scenarios/CHK-TS-1/edit`);
  const editor = page.getByRole('textbox', { name: 'Description' });
  // The description holds only the image: select everything and delete it.
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(editor.locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(/CHK-TS-1$/);
  // Remove the attachment.
  await page.getByRole('button', { name: 'Remove embedded.png' }).click();
  await page
    .getByRole('alertdialog', { name: 'Remove embedded.png?' })
    .getByRole('button', { name: 'Remove' })
    .click();
  await expect(page.getByText('No attachments.')).toBeVisible();

  await page.goto(`${app}/scenarios/CHK-TS-1/revisions/2`);
  await expect(page.getByRole('region', { name: 'Description' }).locator('img')).toHaveCount(1);
  expect(await imageLoaded(page, 'section[aria-labelledby="description-heading"] img')).toBe(true);
});
