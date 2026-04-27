import { test, expect } from '../fixtures';

/**
 * LIVE Bright Data integration test.
 *
 * Gated on the BRIGHTDATA_API_KEY env var so it only runs when explicitly
 * requested (otherwise skipped — keeps CI cheap & deterministic).
 *
 * Run with:
 *   $env:BRIGHTDATA_API_KEY="..."; $env:BRIGHTDATA_ZONE="web_unlocker1"; \
 *     $env:SKIP_BUILD="1"; npx playwright test e2e/tests/06-brightdata-live.spec.ts
 */
const BD_KEY = process.env.BRIGHTDATA_API_KEY;
const BD_ZONE = process.env.BRIGHTDATA_ZONE || 'web_unlocker1';
const TARGET_URL = process.env.BRIGHTDATA_TARGET_URL || 'https://example.com/';

test.describe('Bright Data live crawl', () => {
  test.skip(!BD_KEY, 'BRIGHTDATA_API_KEY not set — skipping live integration test');

  test('saves BD credentials, tests connection, then crawls a real URL', async ({ window }) => {
    // Live HTTP — relax the global 120s ceiling
    test.setTimeout(180_000);
    // 1. Persist credentials via the same IPC the Settings UI uses
    const saved = await window.evaluate(async ({ key, zone }) => {
      // @ts-expect-error: api injected by preload
      return await window.api.saveSettings({
        brightDataApiKey: key,
        brightDataZone: zone,
      });
    }, { key: BD_KEY!, zone: BD_ZONE });
    expect(saved).toMatchObject({ success: true });

    // 2. Round-trip — settings should report the configured zone
    const settings = await window.evaluate(async () => {
      // @ts-expect-error
      return await window.api.getSettings();
    });
    expect((settings as { brightDataZone: string }).brightDataZone).toBe(BD_ZONE);

    // 3. testBrightData IPC — hits api.brightdata.com/request with a tiny probe
    const connectionOk = await window.evaluate(async ({ key, zone }) => {
      // @ts-expect-error
      return await window.api.testBrightData(key, zone);
    }, { key: BD_KEY!, zone: BD_ZONE });
    expect(connectionOk, 'Bright Data connection probe must succeed').toBeTruthy();

    // 4. Real crawl — 1 URL only to minimize cost (unlocker is per-request billed)
    const startResult = await window.evaluate(async (startUrl) => {
      // @ts-expect-error
      return await window.api.crawlStart({
        startUrl,
        mode: 'spider',
        engine: 'brightdata',
        storageMode: 'database',
        maxUrls: 1,
        maxDepth: 0,
        concurrency: 1,
        respectRobots: false,
        followRedirects: true,
        restrictToSubdomain: true,
        timeout: 30000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: true,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 1.0,
      });
    }, TARGET_URL);

    expect(startResult, JSON.stringify(startResult)).toMatchObject({ success: true });
    const crawlId = (startResult as { crawlId: string }).crawlId;
    console.log('[BD live] crawlId =', crawlId);

    // 5. Manual poll loop with logging — Bright Data unlocker can take ~5–30s
    const deadline = Date.now() + 150_000;
    let lastStatus = '';
    while (Date.now() < deadline) {
      const row = await window.evaluate(async (id) => {
        // @ts-expect-error
        const crawls = await window.api.getCrawls();
        return crawls.find((c: { id: string }) => c.id === id) ?? null;
      }, crawlId) as { status: string; completedUrls: number; totalUrls: number; endTime: string | null } | null;
      const cur = row ? `${row.status}/${row.completedUrls}of${row.totalUrls}/end=${row.endTime}` : 'null';
      if (cur !== lastStatus) {
        console.log('[BD live] poll:', cur);
        lastStatus = cur;
      }
      if (row && (row.status === 'completed' || row.status === 'error')) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    // 6. Verify the page landed in SQLite with status 200 and a title
    const pages = await window.evaluate(async (id) => {
      // @ts-expect-error
      return await window.api.getPages(id);
    }, crawlId) as { url: string; statusCode: number | null; title: string | null }[];

    console.log('[BD live] pages count:', pages.length, 'sample:', JSON.stringify(pages.slice(0, 2)));
    expect(Array.isArray(pages)).toBe(true);
    expect(pages.length).toBeGreaterThanOrEqual(1);
    const p = pages[0];
    console.log('[BD live] fetched:', p.url, 'status=', p.statusCode, 'title=', p.title);
    expect(p.statusCode).toBe(200);
    expect((p.title ?? '').length).toBeGreaterThan(0);
  });
});
