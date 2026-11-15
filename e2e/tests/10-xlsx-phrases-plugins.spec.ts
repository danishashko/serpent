import { test, expect } from '../fixtures';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Page } from '@playwright/test';

/**
 * XLSX export, the Phrases tab and plugin tabs, driven through the real app.
 */

async function crawlFixture(window: Page, startUrl: string): Promise<string> {
  const startResult = await window.evaluate(async (url) => {
    // @ts-expect-error: api is injected by preload
    return await window.api.crawlStart({
      startUrl: url,
      mode: 'spider',
      engine: 'local',
      storageMode: 'database',
      maxUrls: 20,
      maxDepth: 3,
      concurrency: 3,
      respectRobots: true,
      followRedirects: true,
      restrictToSubdomain: false,
      timeout: 5000,
      extractTitles: true,
      extractMeta: true,
      extractHeadings: true,
      extractImages: true,
      extractLinks: true,
      extractCanonicals: true,
      maxCostUsd: 0,
    });
  }, startUrl);
  expect(startResult).toMatchObject({ success: true });
  const crawlId = (startResult as { crawlId: string }).crawlId;
  await window.waitForFunction(async (id) => {
    // @ts-expect-error
    const crawls = await window.api.getCrawls();
    const me = crawls.find((c: { id: string; status: string }) => c.id === id);
    return me && (me.status === 'completed' || me.status === 'error');
  }, crawlId, { timeout: 60_000 });
  return crawlId;
}

test.describe('XLSX export', () => {
  test('exportXlsx writes a workbook to disk', async ({ electronApp, window }) => {
    const outPath = join(tmpdir(), `serpent-e2e-export-${Date.now()}.xlsx`);
    await electronApp.evaluate(async ({ dialog }, savePath) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: savePath });
    }, outPath);

    const result = await window.evaluate(async (filename) => {
      // @ts-expect-error
      return await window.api.exportXlsx({
        rows: [
          { url: 'https://a.test', status: 200 },
          { url: 'https://b.test', status: 404 },
        ],
        filename,
        sheetName: 'Pages',
      });
    }, outPath);

    expect(result).toMatchObject({ success: true });
    expect(existsSync(outPath)).toBe(true);
    const file = readFileSync(outPath);
    // A workbook is a ZIP: local-file signature first, part names in the directory.
    expect(file.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
    expect(file.includes(Buffer.from('xl/workbook.xml'))).toBe(true);
    expect(file.includes(Buffer.from('xl/worksheets/sheet1.xml'))).toBe(true);
    rmSync(outPath, { force: true });
  });
});

test.describe('Phrases and plugin tabs', () => {
  test('Phrases tab counts words from the crawl', async ({ window, siteServer }) => {
    test.setTimeout(120_000);
    await crawlFixture(window, siteServer.url);

    await window.getByRole('tab', { name: /^Phrases/ }).click();
    const panel = window.locator('[data-testid="phrases-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    await panel.locator('[data-testid="phrases-n-1"]').click();
    await expect(panel.locator('[data-testid="phrase-row"]').first()).toBeVisible({ timeout: 15_000 });
    // Fixture titles: "Product A" and "Product B".
    await expect(panel.locator('[data-testid="phrase-row"]', { hasText: 'product' }).first()).toBeVisible();

    // Anchor text is a separate source: "Home" links back from several pages.
    await panel.locator('[data-testid="phrases-source"]').selectOption('anchor');
    await expect(panel.locator('[data-testid="phrase-row"]', { hasText: 'home' }).first()).toBeVisible();
  });

  test('an installed plugin gets its own sandboxed tab with the crawl data', async ({ window, siteServer }) => {
    test.setTimeout(120_000);
    await crawlFixture(window, siteServer.url);

    await window.getByRole('tab', { name: /^Plugins/ }).click();
    const panel = window.locator('[data-testid="plugins-panel"]');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(window.locator('[data-testid="plugin-tab"]')).toHaveCount(0);

    await panel.locator('[data-testid="plugins-install-examples"]').click();
    await expect(panel.locator('[data-testid="plugin-row"]')).toHaveCount(2, { timeout: 15_000 });
    await expect(window.locator('[data-testid="plugin-tab"]')).toHaveCount(2);

    await window.getByRole('tab', { name: 'Directory breakdown', exact: true }).click();
    const iframe = window.locator('[data-testid="plugin-frame"]');
    await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
    const frame = window.frameLocator('[data-testid="plugin-frame"]');
    await expect(frame.locator('.sp-stats')).toContainText('Folders', { timeout: 15_000 });
    // /products/a and /products/b put a /products/ folder in the table.
    await expect(frame.locator('.sp-table')).toContainText('/products/');

    // The plugin page has no bridge to the app and cannot reach the network.
    const probe = await window.frames().find(f => f.url().startsWith('serpent-plugin://'))!.evaluate(async (url) => {
      let fetched = 'blocked';
      try { await fetch(url); fetched = 'allowed'; } catch { /* expected */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return { api: typeof (window as any).api, origin: window.origin, fetched };
    }, siteServer.url);
    expect(probe).toEqual({ api: 'undefined', origin: 'null', fetched: 'blocked' });
  });
});
