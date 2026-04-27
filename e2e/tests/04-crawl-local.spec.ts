import { test, expect } from '../fixtures';

/**
 * End-to-end: drive the local crawler against an in-process fixture site,
 * then verify pages/links/images are persisted via the IPC data API.
 *
 * Uses the IPC bridge (window.api.crawlStart) to avoid form-typing flakiness,
 * but still exercises the full main-process pipeline:
 * orchestrator → local crawler → SQLite → IPC read.
 */
test.describe('Local crawl (end-to-end)', () => {
  test('crawls fixture site and persists pages + links', async ({ window, siteServer }) => {
    // Kick off crawl via IPC
    const startResult = await window.evaluate(async (startUrl) => {
      // @ts-expect-error: api is injected by preload
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
    const crawlId = (startResult as { crawlId: string }).crawlId;
    expect(crawlId).toBeTruthy();

    // Wait until completion event fires (or status flips to completed)
    await window.waitForFunction(async (id) => {
      // @ts-expect-error
      const crawls = await window.api.getCrawls();
      const me = crawls.find((c: { id: string; status: string }) => c.id === id);
      return me && (me.status === 'completed' || me.status === 'error');
    }, crawlId, { timeout: 60_000 });

    // Verify persisted data
    const pages = await window.evaluate(async (id) => {
      // @ts-expect-error
      return await window.api.getPages(id);
    }, crawlId);
    const links = await window.evaluate(async (id) => {
      // @ts-expect-error
      return await window.api.getLinks(id);
    }, crawlId);

    expect(Array.isArray(pages)).toBe(true);
    expect((pages as unknown[]).length).toBeGreaterThanOrEqual(5);
    expect(Array.isArray(links)).toBe(true);
    expect((links as unknown[]).length).toBeGreaterThan(0);

    // Verify a known fixture page made it in
    const urls = (pages as { url: string }[]).map(p => p.url);
    expect(urls.some(u => u.endsWith('/about'))).toBe(true);
    expect(urls.some(u => u.endsWith('/products'))).toBe(true);

    // Verify the broken page came back as 404
    const broken = (pages as { url: string; statusCode: number | null }[])
      .find(p => p.url.endsWith('/broken'));
    expect(broken?.statusCode).toBe(404);
  });
});
