import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Smoke test for the PACKED application (asar bundle, native modules baked in).
 *
 * Verifies that what `electron-builder` produces in release/win-unpacked/
 * actually launches and renders the UI — catches issues that the source-tree
 * tests in playwright.config.ts cannot:
 *   - Bad asar packing (missing files, wrong main entry)
 *   - Native module ABI mismatch (better-sqlite3, keytar)
 *   - Missing files in the `build.files` glob
 *   - Renderer asset paths broken under file://
 *
 * Run after `npm run dist`. No installer involved — points _electron at the
 * already-built exe in release/win-unpacked/.
 */

const PACKED_EXE = resolve(__dirname, '..', '..', 'release', 'win-unpacked', 'GhostFrog.exe');

test.skip(
  !existsSync(PACKED_EXE),
  `Packed exe not found at ${PACKED_EXE}. Run "npm run dist" first.`,
);

test('packed app launches and renders the GhostFrog shell', async () => {
  const userDataDir = mkdtempSync(join(tmpdir(), 'ghostfrog-packed-'));

  const app = await electron.launch({
    executablePath: PACKED_EXE,
    args: [`--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      // Force production code path — packed app should NOT load from vite dev server.
      NODE_ENV: 'production',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 60_000,
  });

  try {
    // Find the real renderer window (skip any DevTools windows).
    const isAppWindow = (p: Page) => {
      const u = p.url();
      return !u.startsWith('devtools://') && !u.startsWith('chrome-devtools://');
    };

    const deadline = Date.now() + 30_000;
    let win: Page | undefined;
    while (Date.now() < deadline) {
      win = app.windows().find(isAppWindow);
      if (win) break;
      await app.waitForEvent('window', { timeout: 2_000 }).catch(() => undefined);
    }
    if (!win) throw new Error('Renderer window never appeared');

    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('text=GhostFrog').first()).toBeVisible({ timeout: 30_000 });

    // Confirm the preload bridge is intact in the packed bundle.
    const apiKeys = await win.evaluate(() => Object.keys((window as unknown as { api?: object }).api ?? {}));
    expect(apiKeys.length).toBeGreaterThan(5);
    expect(apiKeys).toContain('crawlStart');
    expect(apiKeys).toContain('getSettings');

    // Quick UI sanity — main toolbar buttons are present.
    await expect(win.getByRole('button', { name: /Crawl/ }).first()).toBeVisible();
    await expect(win.getByRole('button', { name: /Settings/ }).first()).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
