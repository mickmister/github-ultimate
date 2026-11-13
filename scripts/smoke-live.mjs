import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
const profile = await mkdtemp(resolve(tmpdir(), 'github-ultimate-live-'));
const extension = resolve('dist');
const browser = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.argv[2] ?? 'https://github.com/mickmister/github-ultimate/issues/1', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Open GitHub Ultimate workspace' }).click();
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => ({
    url: location.href,
    commentBodies: document.querySelectorAll('.comment-body, .js-comment-body, .markdown-body, [data-testid="comment-body"], [data-testid="markdown-body"]').length,
    commentContainers: document.querySelectorAll('[id^="issuecomment-"], [id^="discussion_r"], [id^="pullrequestreview-"], [data-comment-id]').length,
    records: document.querySelectorAll('.github-ultimate-record').length,
    forms: [...document.querySelectorAll('.github-ultimate-record')].filter(host => host.shadowRoot?.querySelector('.form-card')).length,
    errors: [...document.querySelectorAll('.github-ultimate-record')].map(host => host.shadowRoot?.querySelector('.error')?.textContent).filter(Boolean),
  }));
  console.log(JSON.stringify({ ...result, pageErrors: errors }, null, 2));
  await page.screenshot({ path: 'test-results/live-github.png', fullPage: true });
  if (!result.forms || result.errors.length) throw new Error('Live GitHub fixture forms did not render cleanly');
} finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
