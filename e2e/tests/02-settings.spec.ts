import { test, expect } from '../fixtures';

test.describe('Settings view', () => {
  test('opens Settings, edits a value, saves, and round-trips', async ({ window }) => {
    await window.getByRole('button', { name: '⚙️ Settings' }).click();

    // Settings panel rendered — look for an input we know exists
    const ollamaInput = window.locator('input[type="text"], input[type="url"]').first();
    await expect(ollamaInput).toBeVisible();

    // Use IPC directly to avoid coupling tests to specific input order/labels
    const before = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.getSettings();
    });
    expect(before).toBeTruthy();

    const result = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.saveSettings({ maxCostPerCrawl: 12.34 });
    });
    expect(result).toMatchObject({ success: true });

    const after = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.getSettings();
    });
    expect((after as { maxCostPerCrawl: number }).maxCostPerCrawl).toBe(12.34);
  });

  test('navigating back to Crawl preserves UI state', async ({ window }) => {
    await window.getByRole('button', { name: '⚙️ Settings' }).click();
    await window.getByRole('button', { name: '🔍 Crawl' }).click();
    await expect(window.getByRole('button', { name: /Start Crawl/i })).toBeVisible();
  });
});
