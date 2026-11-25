import { expect, test } from '@playwright/test';

const scenarios = [
  { name: 'phone-portrait', width: 390, height: 844, surface: 'phone' },
  { name: 'phone-landscape', width: 844, height: 390, surface: 'phone' },
  { name: 'tablet-portrait', width: 820, height: 1180, surface: 'tablet' },
  { name: 'tablet-landscape', width: 1180, height: 820, surface: 'tablet' },
  { name: 'desktop-portrait', width: 1080, height: 1920, surface: 'desktop' },
  { name: 'desktop-landscape', width: 1920, height: 1080, surface: 'desktop' },
];
for (const scenario of scenarios) test(`settings ${scenario.name}`, async ({ page }) => {
  await page.setViewportSize(scenario);
  await page.goto(`/iframe.html?id=settings-surfaces--${scenario.name}&viewMode=story`);
  const settings = page.locator('main.settings-page');
  await expect(settings).toHaveAttribute('data-surface', scenario.surface, { timeout: 30000 });
  await expect(settings.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const appearance = settings.getByRole('link', { name: 'Custom appearance' });
  await expect(appearance).toBeVisible();
  await expect(appearance).toHaveAttribute('href', /#\/settings\/appearance\?connection=approved&repository=example%2Fproject&workspace=design/);
  await settings.getByText('About', { exact: true }).click();
  await expect(settings.getByText('6f5b32a-example-build')).toBeVisible();
  if (scenario.surface === 'phone') await page.getByText('Navigate', { exact: true }).click();
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(navigation.getByRole('link')).toHaveCount(7);
  await expect(navigation.getByRole('link', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
  for (const link of await navigation.getByRole('link').all()) await expect(link).not.toHaveAttribute('href', /request|must-not-leak/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (scenario.surface === 'tablet') {
    const rail = await page.locator('.app-navigation-tablet').boundingBox();
    const detail = await settings.boundingBox();
    expect(rail!.x + rail!.width).toBeLessThanOrEqual(detail!.x);
  }
  if (scenario.surface === 'desktop') expect((await settings.boundingBox())!.width).toBeLessThanOrEqual(1120);
});
