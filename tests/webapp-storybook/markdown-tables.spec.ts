import { expect, test, type Locator, type Page } from '@playwright/test';

async function expectReadableTables(page: Page, tables: Locator) {
  await expect(tables).toHaveCount(2);
  for (const table of await tables.all()) {
    // A word in the label must remain on one line, even when other columns
    // contain much more prose. Measuring text catches the three-character wrap.
    const fragments = await table.locator('tr > :first-child').evaluateAll(cells => cells.map(cell => {
      const text = cell.firstChild!;
      const word = text.textContent!.trim().split(/\s/)[0];
      const range = document.createRange();
      range.setStart(text, 0); range.setEnd(text, word.length);
      return { word, lines: range.getClientRects().length };
    }));
    for (const fragment of fragments) expect(fragment.lines, fragment.word).toBe(1);
    const scroll = await table.evaluate(element => {
      element.scrollLeft = element.scrollWidth;
      return { width: element.clientWidth, content: element.scrollWidth, position: element.scrollLeft };
    });
    if (scroll.content > scroll.width) expect(scroll.position).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

for (const [device, width, height] of [
  ['phone portrait', 390, 844], ['phone landscape', 844, 390],
  ['tablet portrait', 820, 1180], ['tablet landscape', 1180, 820],
  ['desktop portrait', 900, 1440], ['desktop landscape', 1440, 900],
] as const) {
  test(`Markdown table labels remain readable in documents and reviews on ${device}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/iframe.html?id=web-app-document-browser--markdown-tables&viewMode=story');
    await expect(page.getByRole('heading', { name: 'Workspace lifecycle', exact: true })).toBeVisible({ timeout: 30000 });
    await expectReadableTables(page, page.locator('.markdown-preview table'));

    await page.goto('/iframe.html?id=web-app-reviews--markdown-tables&viewMode=story');
    await expect(page.getByRole('region', { name: 'Focused review session', exact: true })).toBeVisible({ timeout: 30000 });
    await expectReadableTables(page, page.locator('.markdown-preview table'));
    await page.getByRole('button', { name: 'Zen mode', exact: true }).click();
    const zen = page.getByRole('dialog', { name: 'Reader plan — Zen mode', exact: true });
    await expect(zen).toBeVisible();
    await expectReadableTables(page, zen.locator('.markdown-preview table'));
    await zen.getByRole('button', { name: 'Changes', exact: true }).click();
    await expectReadableTables(page, zen.locator('.markdown-preview table'));
  });
}
