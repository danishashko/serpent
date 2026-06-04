import { test, expect } from '../fixtures';

/**
 * UI-driven QA for the Bright Data Browser API engine (JS rendering).
 *
 * Drives the real Electron renderer like a user would:
 *   1. CrawlConfig — the new "🌐 JS Browser" engine is selectable and reveals
 *      its cost note + cost-limit field.
 *   2. Settings — the "Bright Data Browser API" section exists, credentials
 *      persist through keytar round-trip, and the Test Connection button
 *      exercises the full IPC → playwright-core path (failing gracefully on
 *      invalid creds rather than crashing).
 */

test.describe('Bright Data Browser API engine — UI-driven QA', () => {
  test('CrawlConfig exposes the JS Browser engine with cost note + limit', async ({ window }) => {
    test.setTimeout(30_000);

    await expect(window.locator('text=Serpent').first()).toBeVisible();

    // The new engine button.
    const browserEngineBtn = window.getByRole('button', { name: '🌐 JS Browser' });
    await expect(browserEngineBtn).toBeVisible({ timeout: 10_000 });

    // Selecting it reveals the browser-specific cost note + cost limit field.
    await browserEngineBtn.click();
    await expect(window.locator('text=Renders JS/SPAs')).toBeVisible();
    await expect(window.locator('text=Cost Limit ($)')).toBeVisible();

    // The other engines are still present.
    await expect(window.getByRole('button', { name: '🔧 Local' })).toBeVisible();
    await expect(window.getByRole('button', { name: '☁️ Web Unlocker' })).toBeVisible();
  });

  test('Settings: Browser API credentials persist and Test Connection round-trips', async ({ window }) => {
    test.setTimeout(90_000);

    await window.getByRole('button', { name: '⚙️ Settings' }).click();

    // Section heading + credentials field render.
    await expect(window.locator('text=Bright Data Browser API (JS rendering)')).toBeVisible({ timeout: 10_000 });
    const authInput = window.getByPlaceholder(/brd-customer/);
    await expect(authInput).toBeVisible();

    // Enter dummy USER:PASS credentials.
    const dummyAuth = 'brd-customer-test-zone-scraping_browser:badpassword';
    await authInput.fill(dummyAuth);

    // Persist via the same IPC the Save button uses and confirm keytar round-trip.
    const saved = await window.evaluate(async (auth) => {
      // @ts-expect-error window.api is injected by preload
      await window.api.saveSettings({ brightDataBrowserAuth: auth });
      // @ts-expect-error window.api is injected by preload
      const s = await window.api.getSettings();
      return (s as { brightDataBrowserAuth: string | null }).brightDataBrowserAuth;
    }, dummyAuth);
    expect(saved).toBe(dummyAuth);

    // Click Test Connection — invalid creds should surface a failure toast,
    // proving the IPC → testBrightDataBrowserConnection (playwright-core) path
    // is wired and degrades gracefully instead of throwing.
    const browserSection = window.locator('section', { hasText: 'Bright Data Browser API (JS rendering)' });
    await browserSection.getByRole('button', { name: /Test Connection/ }).click();

    const errorToast = window.locator('.toast-error', { hasText: /Browser API connection failed/ });
    await expect(errorToast).toBeVisible({ timeout: 80_000 });
  });
});
