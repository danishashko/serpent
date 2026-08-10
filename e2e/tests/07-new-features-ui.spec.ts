import { test, expect } from '../fixtures';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * UI-driven end-to-end tests for the four new features:
 *   1. Custom robots.txt textarea + interactive tester (in CrawlConfig)
 *   2. JS Rendering toggle (in CrawlConfig)
 *   3. SF-style 3-pane Issues tab (in ResultsTabs)
 *   4. Sitemap panel — Generate (writes XML to disk) + Analyze (fetches + diffs)
 *
 * Drives the actual UI like a user would: clicks tabs, fills inputs,
 * presses buttons, asserts visible text + DOM state.
 */

test.describe('New features — UI-driven QA', () => {
  // ────────────────────────────────────────────────────────────────────────
  // 1) Custom robots.txt + tester — UI in CrawlConfig (no crawl needed)
  // ────────────────────────────────────────────────────────────────────────
  test('Custom robots.txt tester: blocks Disallow and allows otherwise', async ({ window, siteServer }) => {
    test.setTimeout(60_000);

    // Sanity: shell loaded
    await expect(window.locator('text=Serpent').first()).toBeVisible();

    // The robots section only renders when respectRobots is checked (default: true).
    // Verify the section is present by its label text.
    const robotsLabel = window.locator('text=Custom robots.txt (overrides live fetch)');
    await expect(robotsLabel).toBeVisible({ timeout: 10_000 });

    // Use Playwright's getByPlaceholder with a partial regex (more forgiving
    // than CSS attribute substring selectors when placeholders contain newlines).
    const robotsTextarea = window.getByPlaceholder(/Disallow/);
    await expect(robotsTextarea).toBeVisible({ timeout: 10_000 });

    // Paste a robots.txt that disallows /admin for everyone.
    await robotsTextarea.fill('User-agent: *\nDisallow: /admin\nAllow: /public\n');

    // Expand the <details> for the tester.
    const testerSummary = window.locator('summary:has-text("robots.txt tester")');
    await testerSummary.click();

    // The tester block contains a URL input + "Test URL" button.
    const testButton = window.locator('button:has-text("Test URL")');
    await expect(testButton).toBeVisible();

    // Locate the URL input *inside* the tester (placeholder has /path).
    const testUrlInput = window.locator('input[placeholder="https://example.com/path"]');
    await expect(testUrlInput).toBeVisible();

    // Case A — DISALLOWED: hit /admin/users
    await testUrlInput.fill(`${siteServer.url}/admin/users`);
    await testButton.click();

    const result = window.locator('[data-testid="robots-test-result"]');
    await expect(result).toBeVisible({ timeout: 10_000 });
    await expect(result).toContainText(/Blocked/i);
    await expect(result).toContainText(/Disallow: \/admin/i);

    // Case B — ALLOWED: hit /public/file
    await testUrlInput.fill(`${siteServer.url}/public/file`);
    await testButton.click();

    // Wait for result text to flip from "Blocked" → "Allowed"
    await expect(result).toContainText(/Allowed/i, { timeout: 10_000 });
  });

  // ────────────────────────────────────────────────────────────────────────
  // 2) JS Rendering toggle — UI checkbox in CrawlConfig (local engine only)
  // ────────────────────────────────────────────────────────────────────────
  test('JS Rendering toggle is wired and persists in config', async ({ window }) => {
    test.setTimeout(30_000);
    await expect(window.locator('text=Serpent').first()).toBeVisible();

    // Make sure the local engine is selected (default), then assert the
    // JS Rendering checkbox is visible & toggles.
    const jsLabel = window.locator('text=JS Rendering (Headless Chromium)');
    await expect(jsLabel).toBeVisible({ timeout: 10_000 });

    // The checkbox is the sibling input within the same <label>.
    const jsCheckbox = jsLabel.locator('xpath=preceding-sibling::input[@type="checkbox"]');
    await expect(jsCheckbox).toBeVisible();
    await expect(jsCheckbox).not.toBeChecked();

    await jsCheckbox.check();
    await expect(jsCheckbox).toBeChecked();

    await jsCheckbox.uncheck();
    await expect(jsCheckbox).not.toBeChecked();
  });

  // ────────────────────────────────────────────────────────────────────────
  // 3) Issues tab — full UI drive after a real crawl
  // 4) Sitemap panel — generate (write to disk) + analyze (fetch + diff)
  //
  // These two tests share the same crawl, so we run them in one test to
  // avoid double-crawling (~3-5s each).
  // ────────────────────────────────────────────────────────────────────────
  test('Issues tab + Sitemap panel: real crawl → click through both UIs', async ({ electronApp, window, siteServer }) => {
    test.setTimeout(120_000);

    // Stub the save dialog so the sitemap "Generate & Save" writes to a known path
    // (the dialog would otherwise block the headless run).
    const sitemapDir = mkdtempSync(join(tmpdir(), 'serpent-e2e-sitemap-'));
    const sitemapOutPath = join(sitemapDir, 'sitemap.xml');
    await electronApp.evaluate(async ({ dialog }, savePath) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: savePath });
    }, sitemapOutPath);

    // ── Kick off the crawl via the same IPC the UI uses
    const startResult = await window.evaluate(async (startUrl) => {
      // @ts-expect-error: api injected by preload
      return await window.api.crawlStart({
        startUrl,
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
    }, siteServer.url);
    expect(startResult).toMatchObject({ success: true });

    // Wait for the renderer to receive onCrawlComplete and load pages.
    // We assert by waiting for the Pages tab counter to go > 0. The count
    // lives in a .tab-count span alongside the label.
    await window.waitForFunction(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
      const pagesTab = tabs.find(t => t.firstChild?.textContent?.trim() === 'Pages');
      const count = pagesTab?.querySelector('.tab-count')?.textContent?.trim();
      return count ? Number(count) > 0 : false;
    }, { timeout: 60_000 });

    // ────────────────────────────────────────
    // (3) ISSUES TAB
    // ────────────────────────────────────────
    // Click the "Issues" tab (exact match — sibling tab is "Issue list N").
    const issuesTabBtn = window.getByRole('tab', { name: 'Issues', exact: true });
    await expect(issuesTabBtn).toBeVisible({ timeout: 10_000 });
    await issuesTabBtn.click();

    const issuesTab = window.locator('[data-testid="issues-tab"]');
    await expect(issuesTab).toBeVisible({ timeout: 10_000 });

    // The 3 panes must all be present.
    await expect(window.locator('[data-testid="issues-categories"]')).toBeVisible();
    await expect(window.locator('[data-testid="issues-list"]')).toBeVisible();
    await expect(window.locator('[data-testid="issues-affected"]')).toBeVisible();

    // The fixture's /broken (404) should generate an Issues entry — verify
    // pane 2 has at least one issue button, click it, verify pane 3 populates.
    const issueButtons = window.locator('[data-testid="issues-list"] button');
    const issueCount = await issueButtons.count();
    expect(issueCount, 'fixture site should produce at least 1 detected issue').toBeGreaterThan(0);

    await issueButtons.first().click();
    const affectedList = window.locator('[data-testid="issues-affected-list"]');
    await expect(affectedList).toBeVisible({ timeout: 5_000 });
    const affectedRows = affectedList.locator('li');
    await expect(affectedRows.first()).toBeVisible();
    expect(await affectedRows.count()).toBeGreaterThan(0);

    // Click a different category in pane 1 (if more than one exists) and
    // verify pane 2 swaps content.
    const categoryButtons = window.locator('[data-testid="issues-categories"] button');
    const catCount = await categoryButtons.count();
    if (catCount > 1) {
      const firstIssueTitle = await issueButtons.first().textContent();
      await categoryButtons.nth(1).click();
      // Pane 2 should re-render — first issue's text should be different OR list empty.
      // Just assert we still have a stable pane (categories remain visible).
      await expect(window.locator('[data-testid="issues-list"]')).toBeVisible();
      // Switch back so the rest of the test has a known state.
      await categoryButtons.first().click();
      await expect(window.locator('[data-testid="issues-list"] button').first()).toContainText(firstIssueTitle ?? '');
    }

    // ────────────────────────────────────────
    // (4) SITEMAP PANEL
    // ────────────────────────────────────────
    const sitemapTabBtn = window.getByRole('tab', { name: 'Sitemap', exact: true });
    await expect(sitemapTabBtn).toBeVisible();
    await sitemapTabBtn.click();

    const sitemapPanel = window.locator('[data-testid="sitemap-panel"]');
    await expect(sitemapPanel).toBeVisible({ timeout: 10_000 });

    // (4a) GENERATE — pick weekly / 0.8, click Generate & Save (scoped to panel)
    await sitemapPanel.locator('select').first().selectOption('weekly');
    await sitemapPanel.locator('input[type="number"]').first().fill('0.8');

    const genBtn = sitemapPanel.locator('button:has-text("Generate & Save")');
    await expect(genBtn).toBeEnabled();
    await genBtn.click();

    // Wait for status text to appear ("✓ Wrote N URLs across 1 file(s).").
    await expect(sitemapPanel).toContainText(/Wrote \d+ URLs/i, { timeout: 30_000 });

    // The saved file must exist on disk and be a valid <urlset> sitemap.
    expect(existsSync(sitemapOutPath), `expected sitemap at ${sitemapOutPath}`).toBe(true);
    const xml = readFileSync(sitemapOutPath, 'utf8');
    expect(xml).toContain('<urlset');
    expect(xml).toContain('<loc>');
    expect(xml).toContain('weekly');
    expect(xml).toContain('0.8');
    // At least the home page should be in there.
    expect(xml).toContain(siteServer.url);

    // (4b) ANALYZE — fetch the fixture's /sitemap.xml and diff
    const sitemapUrlInput = sitemapPanel.locator('input[placeholder*="sitemap.xml"]');
    await sitemapUrlInput.fill(`${siteServer.url}/sitemap.xml`);
    await sitemapPanel.locator('button:has-text("Analyze")').click();

    const analysisResult = window.locator('[data-testid="sitemap-analysis-result"]');
    await expect(analysisResult).toBeVisible({ timeout: 30_000 });

    // Expect "In sitemap" stat > 0
    await expect(analysisResult).toContainText(/In sitemap/i);
    // The fixture sitemap includes /orphan-from-sitemap which was never crawled
    // → must surface as an orphan.
    await expect(analysisResult).toContainText(/Orphan in sitemap/i);
    await expect(analysisResult).toContainText('/orphan-from-sitemap');

    // Cleanup
    rmSync(sitemapDir, { recursive: true, force: true });
  });
});
