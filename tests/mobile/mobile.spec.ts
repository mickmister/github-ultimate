import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const form = {
  format: 'standard', id: 'mobile_decision', title: 'Mobile decision',
  questions: [
    { id: 'scope', type: 'choices', title: 'Scope', choices: [{ id: 'small', label: 'Keep the change focused', description: 'Preserve the desktop experience.' }] },
    { id: 'instructions', type: 'textarea', title: 'Instructions' },
  ],
};
const escape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const comment = (id: number, data: unknown) => `<article id="issuecomment-${id}"><div data-testid="comment-body"><pre><code>${escape(JSON.stringify(data))}</code></pre></div></article>`;
const fixture = `<!doctype html><html data-color-mode="light"><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0;padding:12px;font:16px system-ui}textarea{width:100%;box-sizing:border-box}button{min-height:44px}</style></head><body><main>${comment(1, form)}<form id="native"><textarea name="comment[body]" aria-label="GitHub comment"></textarea><button>Comment</button></form></main><script>window.nativeSubmissions=0;document.querySelector('#native').onsubmit=e=>{e.preventDefault();window.nativeSubmissions++}</script></body></html>`;

test.beforeEach(async ({ context, page }) => {
  // WebKit automation cannot load a signed Safari WebExtension. Exercise the
  // actual Safari bundle with only its privileged storage boundary substituted.
  // Deliberately expose browser, not chrome, to cover Safari namespace selection.
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, 'browser', { value: { storage: {
      local: {
        async get(key: string) { return { [key]: JSON.parse(localStorage.getItem(key) ?? 'null') }; },
        async set(data: Record<string, unknown>) { for (const [key, value] of Object.entries(data)) localStorage.setItem(key, JSON.stringify(value)); },
      },
      onChanged: { addListener() {} },
    } } });
  });
  await context.addInitScript({ path: resolve('dist-safari/content.js') });
  await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://github.com/owner/repo/pull/7');
  await expect(page.getByRole('heading', { name: 'Mobile decision', exact: true })).toBeVisible();
});

test('touch wizard, zen, preserved native draft and posted response round trip', async ({ page }) => {
  await page.getByRole('textbox', { name: 'GitHub comment' }).fill('Existing native draft.');
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Mobile decision' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Keep the change focused' }).check();
  await dialog.getByRole('button', { name: 'Leave a comment about Keep the change focused', exact: true }).tap();
  await dialog.getByRole('textbox', { name: 'Add note about Keep the change focused', exact: true }).fill('Touch note.');
  await dialog.getByRole('button', { name: '2. Instructions', exact: true }).tap();
  await dialog.getByRole('textbox', { name: 'Instructions', exact: true }).fill('Keep iOS and desktop working.');
  await dialog.getByRole('button', { name: 'Review answers', exact: true }).first().tap();
  await dialog.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).tap();
  const preview = dialog.getByRole('textbox', { name: 'Generated comment preview' });
  const generated = await preview.inputValue();
  expect(generated).toContain('/github-ultimate discuss');
  expect(generated).toContain('Touch note.');
  await dialog.getByRole('button', { name: 'Place in GitHub comment editor' }).tap();
  await expect(dialog).not.toBeVisible();
  const native = page.getByRole('textbox', { name: 'GitHub comment' });
  await expect(native).toHaveValue(`Existing native draft.\n\n${generated}`);
  expect(await page.evaluate(() => (window as unknown as { nativeSubmissions: number }).nativeSubmissions)).toBe(0);
  await page.getByRole('button', { name: 'Comment', exact: true }).tap();
  expect(await page.evaluate(() => (window as unknown as { nativeSubmissions: number }).nativeSubmissions)).toBe(1);
  const response = JSON.parse(generated.split('```github-response\n')[1].split('\n```')[0]);
  await page.evaluate(html => document.querySelector('main')!.insertAdjacentHTML('beforeend', html), comment(2, response));
  await expect(page.getByRole('button', { name: 'View submitted answers' })).toBeVisible();
  await page.getByRole('button', { name: 'View submitted answers' }).tap();
  await expect(page.locator('.saved-answers')).toContainText('Keep iOS and desktop working.');
});

test('pagehide flushes a pending edit and restores notes and wizard position', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Other', exact: true }).check();
  await page.getByRole('textbox', { name: 'Add note about Other', exact: true }).fill('Try another option.');
  await page.getByRole('button', { name: 'Leave a comment about Keep the change focused', exact: true }).tap();
  await page.getByRole('textbox', { name: 'Add note about Keep the change focused', exact: true }).fill('Remember this note.');
  await page.getByRole('button', { name: '2. Instructions', exact: true }).tap();
  // Edit and pagehide in the same task: a 250ms debounce alone cannot pass this.
  await page.getByRole('textbox', { name: 'Instructions', exact: true }).evaluate(node => {
    const input = node as HTMLTextAreaElement;
    input.value = 'Last edit before suspension';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
  });
  expect(await page.evaluate(() => Object.entries(localStorage).some(([key, value]) => key.startsWith('draft:') && value.includes('Last edit before suspension')))).toBe(true);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('Last edit before suspension');
  await page.getByRole('button', { name: '1. Scope', exact: true }).tap();
  await expect(page.getByRole('checkbox', { name: 'Other', exact: true })).toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Add note about Other', exact: true })).toHaveValue('Try another option.');
  await expect(page.getByRole('textbox', { name: 'Add note about Keep the change focused', exact: true })).toHaveValue('Remember this note.');
  // A new source revision must not inherit the old draft.
  await page.evaluate(() => {
    const code = document.querySelector('pre code')!;
    const data = JSON.parse(code.textContent!); data.goal = 'Changed source'; code.textContent = JSON.stringify(data);
  });
  await expect(page.getByRole('textbox', { name: 'Add note about Keep the change focused', exact: true })).not.toBeVisible();
});

test('draft persistence leaves IME text, selection and focus alone and has no routine status', async ({ page }) => {
  await page.getByRole('button', { name: '2. Instructions', exact: true }).tap();
  const input = page.getByRole('textbox', { name: 'Instructions', exact: true });
  await input.focus();
  await input.evaluate(node => {
    const field = node as HTMLTextAreaElement;
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    field.value = '日本語 and m'; field.setSelectionRange(2, 2);
    field.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '語' }));
  });
  await page.waitForTimeout(350);
  await expect(input).toHaveValue('日本語 and m'); await expect(input).toBeFocused();
  expect(await input.evaluate(node => (node as HTMLTextAreaElement).selectionStart)).toBe(2);
  expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('日本語 and m')))).toBe(false);
  await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '日本語' })));
  await expect.poll(() => page.evaluate(() => Object.values(localStorage).some(value => value.includes('日本語 and m')))).toBe(true);
  await expect(input).toBeFocused();
  expect(await input.evaluate(node => (node as HTMLTextAreaElement).selectionStart)).toBe(2);
  await expect(page.getByText(/Saving draft|Draft saved|Restored saved draft/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Instructions', exact: true })).toHaveValue('日本語 and m');
});

test('mobile controls fit, avoid focus zoom and hide floating chrome while typing', async ({ page, isMobile }) => {
  expect(isMobile).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  const note = page.getByRole('button', { name: 'Leave a comment about Keep the change focused', exact: true });
  const box = await note.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.width).toBeGreaterThanOrEqual(44);
  await note.tap();
  const input = page.getByRole('textbox', { name: 'Add note about Keep the change focused', exact: true });
  expect(await input.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await input.fill('No overlay on the keyboard.');
  await expect(page.getByRole('button', { name: 'Open GitHub Ultimate workspace' })).toBeHidden();
  await note.tap();
  await expect(page.getByRole('button', { name: 'Open GitHub Ultimate workspace' })).toBeVisible();
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).tap();
  for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(size);
    const dialog = page.getByRole('dialog');
    await expect.poll(async () => {
      const rect = (await dialog.boundingBox())!;
      return rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= size.width + 1 && rect.y + rect.height <= size.height + 1;
    }).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Close zen' })).toBeInViewport();
  }
});

test('keyboard leaves zen shell stable while its focused field and close control stay usable', async ({ page }) => {
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).tap();
  await page.getByRole('button', { name: '2. Instructions', exact: true }).tap();
  const input = page.getByRole('textbox', { name: 'Instructions', exact: true });
  await input.fill('Keep this text and selection.');
  const dialog = page.getByRole('dialog');
  const before = (await dialog.boundingBox())!;
  // Explicit simulated visual-viewport geometry, not an actual iOS keyboard.
  await page.evaluate(() => {
    Object.defineProperties(window.visualViewport!, {
      height: { configurable: true, value: 320 }, offsetTop: { configurable: true, value: 120 },
    });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expect.poll(async () => {
    const rect = (await dialog.locator('.zen-body').boundingBox())!;
    return rect.y >= 120 && rect.y + rect.height <= 441;
  }).toBe(true);
  const after = (await dialog.boundingBox())!;
  expect(after).toEqual(before);
  await expect.poll(async () => {
    const box = (await input.boundingBox())!;
    return box.y >= 120 && box.y < 440;
  }).toBe(true);
  await expect(input).toHaveValue('Keep this text and selection.');
  await expect(page.getByRole('button', { name: 'Close zen' })).toBeInViewport();
});

test('denied clipboard has a selectable manual fallback inside zen', async ({ page }) => {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('Denied')) } });
    document.execCommand = () => false;
  });
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).tap();
  await page.getByRole('button', { name: 'Review answers', exact: true }).first().tap();
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).tap();
  await page.getByRole('button', { name: 'Copy comment', exact: true }).tap();
  await expect(page.getByText('Clipboard unavailable. Select and copy the preview text manually.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Generated comment preview' })).toHaveValue(/github-ultimate discuss/);
  await expect(page.getByRole('dialog')).toBeVisible();
});
