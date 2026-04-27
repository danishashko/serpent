import { test, expect } from '../fixtures';

test.describe('App launch', () => {
  test('window opens and renders the GhostFrog shell', async ({ window }) => {
    await expect(window).toHaveTitle(/GhostFrog|Vite/i);

    // Branding visible in title bar
    await expect(window.getByText('🐸 GhostFrog')).toBeVisible();

    // Default view = Crawl, primary CTA visible
    await expect(window.getByRole('button', { name: /Start Crawl/i })).toBeVisible();

    // Nav has Crawl + Settings (icon-prefixed labels distinguish from CTA)
    await expect(window.getByRole('button', { name: '🔍 Crawl' })).toBeVisible();
    await expect(window.getByRole('button', { name: '⚙️ Settings' })).toBeVisible();
  });

  test('preload exposes the api surface', async ({ window }) => {
    const apiKeys = await window.evaluate(() => Object.keys((window as unknown as { api: object }).api));
    // Spot-check a handful of critical channels
    for (const key of ['crawlStart', 'crawlStop', 'getCrawls', 'getSettings', 'saveSettings', 'getUsageStats']) {
      expect(apiKeys).toContain(key);
    }
  });

  test('no console errors during startup', async ({ electronApp, window }) => {
    const errors: string[] = [];
    window.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
    window.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
    });
    // Give renderer a beat to settle
    await window.waitForTimeout(1500);

    // Filter out known-noisy entries (devtools warnings, autofill, etc.)
    const meaningful = errors.filter(e =>
      !/Autofill|DevTools|Electron Security Warning|ResizeObserver/i.test(e)
    );
    expect(meaningful, meaningful.join('\n')).toEqual([]);

    // Ensure at least one renderer window is alive (DevTools may be open in dev mode)
    const appWindows = electronApp.windows().filter(w => !w.url().startsWith('devtools://'));
    expect(appWindows.length).toBeGreaterThanOrEqual(1);
  });
});
