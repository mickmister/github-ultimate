import { expect, test, type Page } from '@playwright/test';

async function finishForm(page: Page) {
  while (await page.getByRole('button', { name: 'Next question', exact: true }).count()) await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('button', { name: 'Continue to submission', exact: true }).click();
}

test('remote draft survives a fresh page, two packets stay isolated, and update does not rebind answers', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect(page.getByRole('heading', { name: 'Reader follow-up', exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Preserve my remote draft');
  await page.getByRole('button', { name: 'Save draft remotely' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved remotely' })).toBeVisible();
  expect(state.artifacts).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Preserve my remote draft');
  state.revision = 2;
  await page.getByRole('button', { name: 'Check for updates and receipts' }).click();
  await expect(page.getByText('Updated packet available.')).toBeVisible();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  expect(state.artifacts.find((item: any) => item.value.kind === 'review-response').value.request.version).toBe('e'.repeat(40));
  await page.getByRole('link', { name: 'Review inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Independent reader review' }).click();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByLabel('Keep this approach', { exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('');
});
test('partial form failure retains the successful response receipt', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1, failSecond: true };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByText('Keep this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByText('Revise this approach', { exact: true }).click();
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByRole('alert')).toContainText('Second form transport unavailable');
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  expect(state.artifacts.filter((item: any) => item.value.kind === 'review-response')).toHaveLength(1);
});
test('full document stays readable when its pinned baseline is unavailable', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--unavailable-baseline&viewMode=story');
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pinned baseline unavailable');
  await page.getByRole('button', { name: 'Full document', exact: true }).click();
  await expect(page.getByText('The full target document is pinned to this packet.')).toBeVisible();
});
test('pinned changes render a read-only diff and the baseline remains inspectable', async ({ page }) => {
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
  await page.getByRole('button', { name: 'Changes', exact: true }).click();
  await expect(page.locator('.monaco-diff-editor')).toBeVisible();
  await page.getByRole('button', { name: 'Baseline', exact: true }).click();
  await expect(page.getByText('The baseline had browser-only drafts.')).toBeVisible();
});
test('repeated packet submission preserves the original receipt without a second response', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByText('I have reviewed this item', { exact: true }).click();
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('already has a saved response receipt');
  expect(state.artifacts.filter((item: any) => item.value.kind === 'review-response')).toHaveLength(1);
});
test('submitted answers take precedence over an older saved draft after reopen', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Older saved draft');
  await page.getByRole('button', { name: 'Save draft remotely' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved remotely');
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('The submitted answer');
  await finishForm(page);
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  await page.reload();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('The submitted answer');
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toBeDisabled();
});

test('phone question navigation preserves answers, scrolls and focuses the new question, with compact Ark checkboxes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveCount(0);
  const checkbox = page.getByRole('checkbox', { name: 'Keep this approach', exact: true });
  await page.getByText('Keep this approach', { exact: true }).click();
  await checkbox.focus();
  await checkbox.press('Space');
  await expect(checkbox).not.toBeChecked();
  await checkbox.press('Space');
  const control = page.locator('.review-checkbox').first().locator('[data-part=control]');
  const size = (await control.boundingBox())!;
  expect(size.width).toBe(24);
  expect(size.height).toBe(24);
  expect((await page.locator('.review-checkbox').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  const heading = page.getByRole('heading', { name: 'Additional notes', exact: true });
  await expect(heading).toBeFocused();
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(0);
  expect((await heading.boundingBox())!.y).toBeLessThan(80);
  await expect(checkbox).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep notes across question navigation');
  await page.getByRole('button', { name: 'Previous question', exact: true }).click();
  await expect(checkbox).toBeChecked();
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep notes across question navigation');
  expect(await page.locator('body').evaluate(node => node.scrollWidth <= window.innerWidth)).toBe(true);
});

test('document progress appears only after load, stays above content, and is optional for submission', async ({ page }) => {
  let release!: () => void;
  const loading = new Promise<void>(resolve => { release = resolve; });
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    // Initial list/open must resolve; hold the subsequent document reads.
    if (page.url().includes('iframe') && (await page.getByText('Loading Reader plan…', { exact: true }).count())) await loading;
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect(page.getByText('Loading Reader plan…', { exact: true })).toBeVisible();
  const marker = page.getByRole('checkbox', { name: 'I have reviewed this item', exact: true });
  await expect(marker).toHaveCount(0);
  release();
  const document = page.getByText('The full target document is pinned to this packet.');
  await expect(document).toBeVisible();
  await expect(marker).not.toBeChecked();
  expect((await page.locator('.review-progress').boundingBox())!.y).toBeLessThan((await document.boundingBox())!.y);
  await page.getByRole('button', { name: 'Submit review feedback', exact: true }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  expect(state.artifacts.find((item: any) => item.value.kind === 'review-response').value.progress).toEqual([]);
});
