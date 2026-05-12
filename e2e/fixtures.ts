import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startSiteServer, type SiteServer } from './helpers/site-server';

interface SerpentFixtures {
  electronApp: ElectronApplication;
  window: Page;
  userDataDir: string;
  siteServer: SiteServer;
}

/**
 * Per-test Electron launch with:
 *   - Isolated --user-data-dir → fresh SQLite DB each test
 *   - NODE_ENV=development → main loads http://localhost:5173 (vite preview)
 *   - Disabled GPU/sandbox flags for CI stability
 */
export const test = base.extend<SerpentFixtures>({
  userDataDir: async ({}, use) => {
    const dir = mkdtempSync(join(tmpdir(), 'serpent-e2e-'));
    await use(dir);
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* keep going */ }
  },

  siteServer: async ({}, use) => {
    const server = await startSiteServer();
    await use(server);
    await server.close();
  },

  electronApp: async ({ userDataDir }, use) => {
    const app = await electron.launch({
      args: [
        '.',
        `--user-data-dir=${userDataDir}`,
        '--no-sandbox',
        '--disable-gpu',
      ],
      cwd: join(__dirname, '..'),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      timeout: 30_000,
    });
    await use(app);
    await app.close().catch(() => { /* already closed */ });
  },

  window: async ({ electronApp }, use) => {
    // In dev mode the main process opens DevTools, which becomes a separate
    // BrowserWindow. We must skip it and find the real app window (file:// or http://).
    const isAppWindow = (p: Page) => {
      const u = p.url();
      return !u.startsWith('devtools://') && !u.startsWith('chrome-devtools://');
    };

    const deadline = Date.now() + 30_000;
    let win: Page | undefined;
    while (Date.now() < deadline) {
      const wins = electronApp.windows();
      win = wins.find(isAppWindow);
      if (win) break;
      await electronApp.waitForEvent('window', { timeout: 2_000 }).catch(() => undefined);
    }
    if (!win) throw new Error('Renderer window never appeared (only DevTools found)');

    await win.waitForLoadState('domcontentloaded');
    await win.waitForSelector('text=Serpent', { timeout: 20_000 });
    await use(win);
  },
});

export const expect = test.expect;
