import { test, expect } from '@playwright/test';

test('real renderer stories, local comment flow, CSS edits and theme controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Investigate the failing checks', exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Only failing unit tests' }).check();
  await page.getByRole('textbox', { name: 'Additional notes', exact: true }).fill('Keep these answers while styling.');
  await page.getByRole('textbox', { name: 'CSS overrides' }).fill('.form-card { border-radius: 32px; }');
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('Keep these answers while styling.');
  expect(await page.locator('#renderer').evaluate(host => getComputedStyle(host.shadowRoot!.querySelector('.form-card')!).borderRadius)).toBe('32px');
  await page.getByLabel('Theme', { exact: true }).selectOption('dark');
  await expect(page.locator('#renderer')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('Accent', { exact: true }).fill('#00aa88');
  expect(await page.locator('#renderer').evaluate(host => getComputedStyle(host).getPropertyValue('--accent').trim())).toBe('#00aa88');
  await page.getByLabel('Canvas width', { exact: true }).selectOption('390');
  await expect.poll(async () => (await page.locator('#renderer').boundingBox())!.width).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: 'Approved for next steps', exact: true }).click();
  await page.getByRole('button', { name: 'Place in GitHub comment editor' }).click();
  await expect(page.getByRole('textbox', { name: 'Local GitHub comment editor' })).toHaveValue(/\/github-ultimate approve/);
  expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/playground-dark.png', fullPage: true });
});

test('source edits validate, YAML forms render, and snapshots/saved responses are available', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Follow-up question/ }).click();
  await expect(page.getByRole('heading', { name: 'A quick follow-up question' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approved for next steps', exact: true })).toHaveCount(0);
  const source = page.getByRole('textbox', { name: 'Frontmatter source' });
  await source.fill('format: standard\nid: editable\ntitle: My custom form\nquestions:\n  - id: note\n    type: textarea\n    title: My custom question');
  await page.getByRole('button', { name: 'Render source', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My custom form' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'My custom form' })).toBeVisible();
  await page.getByRole('button', { name: /Workflow & beads/ }).click();
  await expect(page.getByText('1 / 3 beads complete')).toBeVisible();
  await page.getByRole('button', { name: /Saved response/ }).click();
  await expect(page.getByRole('heading', { name: 'Approved for next steps' })).toBeVisible();
  await page.getByRole('button', { name: /Superseded form/ }).click();
  await expect(page.getByText(/This form was superseded/)).toBeVisible();
  await page.getByRole('button', { name: /Validation error/ }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Invalid record', { exact: true })).toBeVisible();
});

test('source and style overrides export for a fork or upstream contribution', async ({ page }) => {
  await page.goto('/');
  const sourceDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export source', exact: true }).click();
  expect((await sourceDownload).suggestedFilename()).toBe('github-ultimate-record.txt');
  const cssDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export CSS', exact: true }).click();
  expect((await cssDownload).suggestedFilename()).toBe('github-ultimate-custom.css');
});

test('wizard supports browsing, notes, zen and explicit unanswered questions', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Question wizard/ }).click();
  await expect(page.getByText('Question 1 of 3', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Leave a comment about A small focused change', exact: true }).click();
  await page.getByRole('textbox', { name: 'Add note about A small focused change', exact: true }).fill('Consider a small scope.');
  await page.getByRole('button', { name: '2. What context matters?', exact: true }).click();
  await page.getByRole('textbox', { name: 'What context matters?', exact: true }).fill('Typing m stays in this field.');
  await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
  const zen = page.getByRole('dialog', { name: 'Plan the next change' });
  await expect(zen).toBeVisible();
  await expect(zen.getByRole('textbox', { name: 'What context matters?', exact: true })).toHaveValue('Typing m stays in this field.');
  await page.keyboard.press('Escape');
  await expect(zen).toBeHidden();
  await page.getByRole('button', { name: 'Review answers', exact: true }).click();
  await expect(page.getByText(/1 requested question is unanswered/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue discussion — don’t implement yet', exact: true }).click();
  const preview = page.getByRole('textbox', { name: 'Generated comment preview' });
  await expect(preview).toHaveValue(/"omitted_questions": \[\s*"approach"\s*\]/);
  await expect(preview).toHaveValue(/Consider a small scope/);
  await page.getByRole('button', { name: 'Place in GitHub comment editor' }).click();
  await expect(page.getByRole('textbox', { name: 'Local GitHub comment editor' })).toHaveValue(/Submitted answers · GitHub Ultimate/);
});

test('wizard keeps readable active question tabs before and after scrolling, inline and in zen', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Question wizard/ }).click();
  const header = page.locator('#renderer .wizard-header');
  const index = header.getByRole('navigation', { name: 'Form questions' });
  const active = index.locator('button[aria-current=step]');
  await expect(header).toHaveCSS('border-top-left-radius', '0px');
  await expect(header).toHaveCSS('border-top-right-radius', '0px');
  for (const zen of [false, true]) {
    if (zen) await page.getByRole('button', { name: 'View in Zen Mode', exact: true }).click();
    await page.locator('#renderer .wizard-anchor').evaluate(node => node.scrollIntoView({ block: 'start' }));
    await expect(index).toBeVisible();
    await expect(active).toHaveText('1. What kind of change should we make?');
    const tabSize = await active.boundingBox();
    const tabs = await index.getByRole('button').evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      return { top: box.top, right: box.right, left: box.left, height: box.height };
    }));
    const headerBox = (await header.boundingBox())!;
    expect(tabs[0].top - headerBox.y).toBe(1); // Only the header border above the tabs.
    for (let i = 1; i < tabs.length; i++) {
      expect(tabs[i].top).toBe(tabs[0].top);
      expect(tabs[i].height).toBe(tabs[0].height);
      expect(Math.abs(tabs[i].left - tabs[i - 1].right)).toBeLessThanOrEqual(1);
    }
    const activeFont = await active.evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    const inactiveFont = await index.locator('button[aria-current=false]').first().evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    expect(activeFont).toBeGreaterThan(inactiveFont);
    expect(await active.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
    await header.evaluate(node => {
      // Keep enough content below the viewport to exercise actual sticky scrolling.
      (node.parentElement!.querySelector('fieldset:not([hidden])') as HTMLElement).style.minHeight = '1800px';
      const scroller = node.closest('.zen-body');
      if (scroller) scroller.scrollBy(0, 300); else window.scrollBy(0, 300);
    });
    await expect(index).toBeVisible();
    await expect(active).toBeInViewport();
    expect((await active.boundingBox())!.height).toBe(tabSize!.height);
    expect((await active.boundingBox())!.width).toBe(tabSize!.width);
    await expect(header.getByText('Question 1 of 3', { exact: true })).toBeVisible();
    await header.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(index).toBeVisible();
    await expect(active).toHaveText('2. What context matters?');
    await expect(page.getByRole('textbox', { name: 'What context matters?', exact: true })).toBeInViewport();
    const offset = await header.evaluate(node => {
      const scroller = node.closest('.zen-body');
      return node.getBoundingClientRect().top - (scroller ? scroller.getBoundingClientRect().top : 0);
    });
    expect(Math.abs(offset)).toBeLessThanOrEqual(2);
    await index.getByRole('button', { name: /^1\./ }).click();
    await expect(header.getByText('Question 1 of 3', { exact: true })).toBeVisible();
  }
});

test('long active question tabs stay fully readable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: /Question wizard/ }).click();
  const active = page.locator('#renderer .question-index button[aria-current=step]');
  await active.evaluate(node => { node.textContent = '1. A long question title that should wrap across multiple lines without being clipped or truncated, even on a narrow phone screen?'; });
  await expect(active).toHaveCSS('white-space', 'normal');
  expect(await active.evaluate(node => node.scrollWidth <= node.clientWidth && node.scrollHeight <= node.clientHeight)).toBe(true);
  const index = page.locator('#renderer .question-index');
  expect(await index.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
});

test('tab widths share available space and keep inactive labels readable across container sizes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Question wizard/ }).click();
  const index = page.locator('#renderer .question-index');
  for (const width of [320, 480, 768, 1100]) {
    await index.evaluate((node, width) => { (node as HTMLElement).style.width = `${width}px`; }, width);
    const layout = await index.evaluate(node => ({
      width: node.clientWidth, scrollWidth: node.scrollWidth, right: node.getBoundingClientRect().right,
      tabs: [...node.querySelectorAll('button')].map(tab => ({
        top: tab.getBoundingClientRect().top, right: tab.getBoundingClientRect().right, width: tab.getBoundingClientRect().width,
        clipped: tab.scrollWidth > tab.clientWidth || tab.scrollHeight > tab.clientHeight,
        whiteSpace: getComputedStyle(tab).whiteSpace, active: tab.getAttribute('aria-current') === 'step',
      })),
    }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
    for (const tab of layout.tabs) {
      expect(tab.clipped).toBe(false);
      expect(tab.whiteSpace).toBe('normal');
    }
    // Each row spends its width on labels, rather than leaving an unused tail.
    for (const top of new Set(layout.tabs.map(tab => tab.top))) {
      expect(Math.abs(Math.max(...layout.tabs.filter(tab => tab.top === top).map(tab => tab.right)) - layout.right)).toBeLessThanOrEqual(1);
    }
    if (width >= 768) {
      const active = layout.tabs.find(tab => tab.active)!;
      expect(active.width).toBeGreaterThan(layout.tabs.find(tab => !tab.active)!.width);
    }
  }
});

test('submitted story starts collapsed and permits a distinct new response', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Submitted form/ }).click();
  await expect(page.getByRole('checkbox', { name: 'Only failing unit tests' })).toBeHidden();
  await page.getByRole('button', { name: 'View submitted answers', exact: true }).click();
  await expect(page.locator('.saved-answers').getByText('Please explain the failure before implementing.', { exact: true })).toBeVisible();
  await expect(page.locator('.saved-answers').getByRole('textbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Submit another response', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'Only failing unit tests' })).not.toBeChecked();
  await expect(page.getByRole('textbox', { name: 'Additional notes', exact: true })).toHaveValue('');
});
