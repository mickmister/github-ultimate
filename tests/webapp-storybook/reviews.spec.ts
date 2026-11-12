import { expect, test } from '@playwright/test';

test('remote draft survives a fresh page, two packets stay isolated, and update does not rebind answers', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1 };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await expect(page.getByRole('heading', { name: 'Reader follow-up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByLabel('Keep this approach', { exact: true }).check();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Preserve my remote draft');
  await page.getByRole('button', { name: 'Save draft remotely' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved remotely' })).toBeVisible();
  expect(state.artifacts).toHaveLength(1);
  await page.reload();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Preserve my remote draft');
  state.revision = 2;
  await page.getByRole('button', { name: 'Check for updates and receipts' }).click();
  await expect(page.getByText('Updated packet available.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  expect(state.artifacts.find((item: any) => item.value.kind === 'review-response').value.request.version).toBe('e'.repeat(40));
  await page.getByRole('link', { name: 'Review inbox', exact: true }).click();
  await page.getByRole('link', { name: 'Independent reader review' }).click();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('');
  await expect(page.getByLabel('Keep this approach', { exact: true })).not.toBeChecked();
});
test('partial form failure retains the successful response receipt', async ({ page }) => {
  let state: any = { artifacts: [], revision: 1, failSecond: true };
  await page.route('**/__review-fixture', async route => {
    if (route.request().method() === 'POST') state = route.request().postDataJSON();
    await route.fulfill({ json: state });
  });
  await page.goto('/iframe.html?id=web-app-reviews--focused&viewMode=story&remoteFixture=true');
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await page.getByLabel('Keep this approach', { exact: true }).check();
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('1 forms');
  await page.getByRole('button', { name: 'Review experience', exact: true }).click();
  await page.getByLabel('Revise this approach', { exact: true }).check();
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
  await page.getByLabel('I have reviewed this item').check();
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
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Older saved draft');
  await page.getByRole('button', { name: 'Save draft remotely' }).click();
  await expect(page.getByRole('status')).toContainText('Draft saved remotely');
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('The submitted answer');
  await page.getByRole('button', { name: 'Submit this form' }).click();
  await expect(page.getByLabel('Submission receipts')).toContainText('Response saved; task notification pending');
  await page.reload();
  await page.getByRole('button', { name: 'Reader decisions', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('The submitted answer');
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toBeDisabled();
});
