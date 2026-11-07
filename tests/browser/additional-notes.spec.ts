import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

for (const authored of [false, true]) {
  test(`Additional notes has fixed guidance for ${authored ? 'authored' : 'automatic'} fields inline and in zen`, async () => {
    const profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-notes-'));
    const extension = resolve('dist');
    const context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
    try {
      const old = 'Global notes stay outside the wizard question count.';
      const guidance = 'Feel free to brain dump any information here. The agents will be able to take it into account.';
      const form = { format: 'standard', id: 'notes_guidance', title: 'Notes guidance', questions: [
        { id: 'context', type: 'textarea', title: 'Context' },
        ...(authored ? [{ id: 'additional_notes', type: 'textarea', title: 'Additional notes', description: old }] : []),
      ] };
      const raw = JSON.stringify(form).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      await context.route('https://github.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><article id="issuecomment-1"><div class="comment-body"><pre><code>${raw}</code></pre></div></article></body></html>` }));
      const page = await context.newPage(); await page.goto('https://github.com/example/project/pull/42');
      const notes = page.getByRole('group', { name: 'Additional notes', exact: true });
      await expect(notes.getByText(guidance, { exact: true })).toBeVisible();
      await expect(notes.getByText(old, { exact: true })).toHaveCount(0);
      await notes.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep this context.');
      await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
      const zen = page.getByRole('dialog');
      await expect(zen.getByText(guidance, { exact: true })).toBeVisible();
      await expect(zen.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep this context.');
    } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
  });
}
