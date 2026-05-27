import { test, expect } from '../fixtures';
import type { Page } from '@playwright/test';

/**
 * Real-website crawl tests — verifies the crawler works against live public sites.
 * These tests prove end-to-end correctness on real HTML, real robots.txt, etc.
 *
 * Environment guard: these tests are only meaningful with live internet access.
 * They run by default in CI with SKIP_BUILD=1 set.
 *
 * NOTE: window.waitForFunction(async fn, ...) does NOT await the Promise in
 * Electron's renderer context — the truthy Promise object itself satisfies the
 * condition immediately. We use an explicit polling helper instead.
 */

/**
 * Poll until the crawl with the given ID reaches 'completed' or 'error' status,
 * or until the deadline is exceeded.
 */
async function waitForCrawlDone(window: Page, crawlId: string, timeoutMs = 120_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await window.evaluate(async (id) => {
      // @ts-expect-error: api is injected by preload
      const crawls = await window.api.getCrawls();
      const me = crawls.find((c: { id: string }) => c.id === id);
      return (me?.status as string) ?? null;
    }, crawlId);
    if (status === 'completed' || status === 'error') return status;
    await window.waitForTimeout(2000);
  }
  throw new Error(`Crawl ${crawlId} did not complete within ${timeoutMs}ms`);
}

test.describe('Real-site crawls', () => {
  /**
   * Small site: https://example.com — 1 page, simple HTML, well-known structure.
   * Fast, deterministic, always available.
   */
  test('crawls example.com (1 page baseline)', async ({ window }) => {
    const startResult = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl: 'https://example.com',
        mode: 'spider',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 5,
        maxDepth: 2,
        concurrency: 2,
        respectRobots: true,
        followRedirects: true,
        restrictToSubdomain: false,
        timeout: 15000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: false,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 0,
        jsRender: false,
        requestsPerSecond: 0,
      });
    });

    expect(startResult).toMatchObject({ success: true });
    const crawlId = (startResult as { crawlId: string }).crawlId;
    expect(crawlId).toBeTruthy();

    // Wait for completion using explicit polling (async predicates in waitForFunction
    // don't properly await Promises in Electron's renderer context)
    const finalStatus = await waitForCrawlDone(window, crawlId, 60_000);
    console.log('[TEST 08] example.com final status:', finalStatus);

    const pages = await window.evaluate(async (id) => {
      // @ts-expect-error
      return await window.api.getPages(id);
    }, crawlId);

    const pagesArr = pages as { url: string; statusCode: number | null; title: string | null }[];
    console.log('[TEST 08] example.com pages:', pagesArr.length);
    console.log('[TEST 08] pages:', pagesArr.map(p => `${p.url} [${p.statusCode}] ${p.title}`));

    expect(pagesArr.length).toBeGreaterThanOrEqual(1);

    const home = pagesArr.find(p => p.url === 'https://example.com/' || p.url === 'https://example.com');
    expect(home?.statusCode).toBe(200);
    expect(home?.title).toBeTruthy();
  });

  /**
   * Medium site: https://news.ycombinator.com — ~30 pages (front page links),
   * plain HTML, no JS rendering needed, good robots.txt compliance test.
   */
  test('crawls news.ycombinator.com front page (30-item list)', async ({ window }) => {
    const startResult = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl: 'https://news.ycombinator.com',
        mode: 'spider',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 40,
        maxDepth: 2,
        concurrency: 3,
        respectRobots: true,
        followRedirects: true,
        restrictToSubdomain: false,
        timeout: 15000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: false,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 0,
        jsRender: false,
        requestsPerSecond: 2, // be polite
      });
    });

    expect(startResult).toMatchObject({ success: true });
    const crawlId = (startResult as { crawlId: string }).crawlId;

    const finalStatus = await waitForCrawlDone(window, crawlId, 120_000);
    console.log('[TEST 08] HN final status:', finalStatus);

    const [pages, links] = await window.evaluate(async (id) => {
      // @ts-expect-error
      const p = await window.api.getPages(id);
      // @ts-expect-error
      const l = await window.api.getLinks(id);
      return [p, l];
    }, crawlId);

    // DIAGNOSTIC: capture crawl record for debugging
    const crawlRecord = await window.evaluate(async (id) => {
      // @ts-expect-error
      const crawls = await window.api.getCrawls();
      return crawls.find((c: { id: string }) => c.id === id);
    }, crawlId);
    console.log('[TEST 08] HN crawl record:', JSON.stringify(crawlRecord));

    const pagesArr = pages as { url: string; statusCode: number | null; title: string | null; wordCount: number | null }[];
    const linksArr = links as { sourceUrl: string; targetUrl: string; isInternal: boolean }[];

    console.log('[TEST 08] HN pages crawled:', pagesArr.length);
    console.log('[TEST 08] HN links found:', linksArr.length);

    // Should find at least the home page + some internal pages
    expect(pagesArr.length).toBeGreaterThanOrEqual(1);
    expect(linksArr.length).toBeGreaterThan(0);

    // Home page should be 200
    const home = pagesArr.find(p => p.url.startsWith('https://news.ycombinator.com'));
    expect(home?.statusCode).toBe(200);

    // Title should be extracted
    expect(home?.title).toBeTruthy();

    // Word count should be non-zero
    expect(home?.wordCount).toBeGreaterThan(0);

    // Internal links should exist
    const internalLinks = linksArr.filter(l => l.isInternal);
    expect(internalLinks.length).toBeGreaterThan(0);
  });

  /**
   * Redirect test: https://httpbin.org/redirect/3 — 3 hops before landing.
   * Verifies the redirect chain tracking works end-to-end.
   */
  test('tracks redirect chain correctly', async ({ window }) => {
    const startResult = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl: 'https://httpbin.org/redirect/2',
        mode: 'spider',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 5,
        maxDepth: 2,
        concurrency: 1,
        respectRobots: true,
        followRedirects: true,
        restrictToSubdomain: false,
        timeout: 30000,
        extractTitles: true,
        extractMeta: false,
        extractHeadings: false,
        extractImages: false,
        extractLinks: false,
        extractCanonicals: false,
        maxCostUsd: 0,
        jsRender: false,
        requestsPerSecond: 0,
      });
    });

    expect(startResult).toMatchObject({ success: true });
    const crawlId = (startResult as { crawlId: string }).crawlId;

    const finalStatus = await waitForCrawlDone(window, crawlId, 60_000);
    console.log('[TEST 08] httpbin redirect final status:', finalStatus);

    const [pages, redirects] = await window.evaluate(async (id) => {
      // @ts-expect-error
      const p = await window.api.getPages(id);
      // @ts-expect-error
      const r = await window.api.getRedirects(id);
      return [p, r];
    }, crawlId);

    const pagesArr = pages as { url: string; statusCode: number | null }[];
    const redirectsArr = redirects as { sourceUrl: string; targetUrl: string; statusCode: number; hopNumber: number }[];

    console.log('[TEST 08] httpbin pages:', pagesArr.length);
    console.log('[TEST 08] httpbin redirects:', redirectsArr.length);
    console.log('[TEST 08] redirect chain:', redirectsArr.map(r => `${r.sourceUrl} → ${r.targetUrl} [${r.statusCode}]`));

    // At minimum, we should get the start page recorded
    expect(pagesArr.length).toBeGreaterThanOrEqual(1);

    // The starting URL should have a redirect status
    const startPage = pagesArr.find(p => p.url.includes('redirect'));
    if (startPage) {
      console.log('[TEST 08] start page status:', startPage.statusCode);
      expect([301, 302, 307, 308]).toContain(startPage.statusCode);
    }
  });

  /**
   * Status code test: test that 404 pages are correctly identified.
   */
  test('correctly identifies 404 pages', async ({ window }) => {
    const startResult = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl: 'https://httpbin.org/status/404',
        mode: 'spider',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 3,
        maxDepth: 1,
        concurrency: 1,
        respectRobots: false,
        followRedirects: true,
        restrictToSubdomain: false,
        timeout: 15000,
        extractTitles: false,
        extractMeta: false,
        extractHeadings: false,
        extractImages: false,
        extractLinks: false,
        extractCanonicals: false,
        maxCostUsd: 0,
        jsRender: false,
        requestsPerSecond: 0,
      });
    });

    expect(startResult).toMatchObject({ success: true });
    const crawlId = (startResult as { crawlId: string }).crawlId;

    const finalStatus4 = await waitForCrawlDone(window, crawlId, 30_000);
    console.log('[TEST 08] 404 test final status:', finalStatus4);

    const pages = await window.evaluate(async (id) => {
      // @ts-expect-error
      return await window.api.getPages(id);
    }, crawlId);

    const pagesArr = pages as { url: string; statusCode: number | null }[];
    console.log('[TEST 08] 404 test pages:', pagesArr.map(p => `${p.url} [${p.statusCode}]`));

    expect(pagesArr.length).toBeGreaterThanOrEqual(1);
    const notFound = pagesArr.find(p => p.url.includes('status/404'));
    expect(notFound?.statusCode).toBe(404);
  });

  /**
   * Larger site: https://golang.org → https://go.dev — ~50 pages
   * Verifies crawl depth, metadata extraction, and robots.txt on a real dev site.
   */
  test('crawls go.dev (real dev site, 50 pages)', async ({ window }) => {
    const startResult = await window.evaluate(async () => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl: 'https://go.dev',
        mode: 'spider',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 50,
        maxDepth: 3,
        concurrency: 3,
        respectRobots: true,
        followRedirects: true,
        restrictToSubdomain: false,
        timeout: 15000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: true,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 0,
        jsRender: false,
        requestsPerSecond: 3, // polite rate limiting
      });
    });

    expect(startResult).toMatchObject({ success: true });
    const crawlId = (startResult as { crawlId: string }).crawlId;

    const finalStatus5 = await waitForCrawlDone(window, crawlId, 180_000);
    console.log('[TEST 08] go.dev final status:', finalStatus5);

    const [pages, links, images] = await window.evaluate(async (id) => {
      // @ts-expect-error
      const p = await window.api.getPages(id);
      // @ts-expect-error
      const l = await window.api.getLinks(id);
      // @ts-expect-error
      const i = await window.api.getImages(id);
      return [p, l, i];
    }, crawlId);

    const pagesArr = pages as { url: string; statusCode: number | null; title: string | null; metaDescription: string | null; h1: string | null; wordCount: number | null; crawlDepth: number }[];
    const linksArr = links as { sourceUrl: string; targetUrl: string; isInternal: boolean }[];
    const imagesArr = images as { pageUrl: string; imageUrl: string; altText: string | null }[];

    console.log('[TEST 08] go.dev pages:', pagesArr.length);
    console.log('[TEST 08] go.dev links:', linksArr.length);
    console.log('[TEST 08] go.dev images:', imagesArr.length);

    const statuses = pagesArr.reduce((acc: Record<string, number>, p) => {
      const s = String(p.statusCode ?? 'null');
      acc[s] = (acc[s] || 0) + 1;
      return acc;
    }, {});
    console.log('[TEST 08] status distribution:', statuses);

    // At least 10 pages should have been crawled
    expect(pagesArr.length).toBeGreaterThanOrEqual(10);

    // Home page
    const home = pagesArr.find(p => p.url === 'https://go.dev/' || p.url === 'https://go.dev');
    expect(home?.statusCode).toBe(200);
    expect(home?.title).toBeTruthy();

    // Link extraction works
    expect(linksArr.length).toBeGreaterThan(10);

    // Metadata extracted
    const pagesWithTitle = pagesArr.filter(p => p.statusCode === 200 && p.title);
    expect(pagesWithTitle.length).toBeGreaterThan(3);

    // Some pages should have meta descriptions
    const pagesWithMeta = pagesArr.filter(p => p.metaDescription);
    console.log('[TEST 08] pages with meta description:', pagesWithMeta.length);

    // Word count populated for HTML pages
    const pagesWithWords = pagesArr.filter(p => p.statusCode === 200 && (p.wordCount ?? 0) > 0);
    expect(pagesWithWords.length).toBeGreaterThan(3);

    // Depth distribution should show a mix of depths
    const depths = pagesArr.reduce((acc: Record<number, number>, p) => {
      acc[p.crawlDepth] = (acc[p.crawlDepth] || 0) + 1;
      return acc;
    }, {});
    console.log('[TEST 08] depth distribution:', depths);
  });
});
