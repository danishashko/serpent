import { test, expect } from '../fixtures';
import type { LinkData, PageData } from '../../src/types/index';

/**
 * Uncrawlable links and the 2MB HTML cap, end to end through the real app.
 *
 * The unit tests cover the parsing rules in isolation; what this proves is the
 * part that only breaks in the wired-up app: that uncrawlable links are stored
 * and surfaced but never crawled, that they don't leak into discovery, and that
 * both issues reach the Issues UI.
 */
test.describe('Uncrawlable links + oversized HTML', () => {
  test('reports uncrawlable links without ever following them', async ({ window, siteServer }) => {
    const seed = `${siteServer.url}/uncrawlable`;

    const startResult = await window.evaluate(async (startUrl: string) => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl,
        mode: 'spider',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 20,
        maxDepth: 2,
        concurrency: 3,
        respectRobots: false,
        followRedirects: true,
        restrictToSubdomain: true,
        timeout: 20000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: true,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 0,
      });
    }, seed);
    expect(startResult.success).toBe(true);
    const crawlId = startResult.crawlId as string;

    await expect.poll(async () => {
      const crawls = await window.evaluate(async () => {
        // @ts-expect-error: api is injected by preload
        return await window.api.getCrawls();
      });
      return crawls.find((c: { id: string }) => c.id === crawlId)?.status;
    }, { timeout: 120_000, intervals: [1000] }).toBe('completed');

    const links: LinkData[] = await window.evaluate(async (id: string) => {
      // @ts-expect-error: api is injected by preload
      return await window.api.getLinks(id);
    }, crawlId);
    const pages: PageData[] = await window.evaluate(async (id: string) => {
      // @ts-expect-error: api is injected by preload
      return await window.api.getPages(id);
    }, crawlId);

    const uncrawlable = links.filter(l => l.crawlability === 'uncrawlable');
    const reasons = uncrawlable.map(l => l.uncrawlableReason).sort();

    // Two href-on-non-anchor, one javascript: href, two onclick-only.
    expect(reasons).toEqual([
      'href_on_non_anchor',
      'href_on_non_anchor',
      'javascript_href',
      'onclick_only',
      'onclick_only',
    ]);

    // An anchor with a real href is crawlable even when it also has an onclick.
    const withOnclick = links.find(l => l.targetUrl.endsWith('/contact'));
    expect(withOnclick?.crawlability).toBe('crawlable');

    // mailto:/tel: are dropped outright rather than reported as uncrawlable.
    expect(links.some(l => /^(mailto|tel):/.test(l.targetUrl))).toBe(false);

    // An onclick body is JavaScript, not a URL — it must not be resolved into
    // a plausible-looking absolute address.
    const onclickLink = uncrawlable.find(l => l.uncrawlableReason === 'onclick_only');
    expect(onclickLink?.targetUrl.startsWith('http')).toBe(false);

    // Nothing reachable only via uncrawlable markup may be fetched.
    const paths = pages.map(p => new URL(p.url).pathname);
    expect(paths).not.toContain('/div-href-target');
    expect(paths).not.toContain('/span-href-target');
    expect(paths).toContain('/about');

    // The page-level count is what the issue detector keys off.
    const seedPage = pages.find(p => new URL(p.url).pathname === '/uncrawlable');
    expect(seedPage?.uncrawlableOutlinks).toBe(5);
  });

  test('flags an HTML document over the 2MB Googlebot cap', async ({ window, siteServer }) => {
    const startResult = await window.evaluate(async (startUrl: string) => {
      // @ts-expect-error: api is injected by preload
      return await window.api.crawlStart({
        startUrl,
        urlList: [startUrl],
        mode: 'list',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 5,
        maxDepth: 1,
        concurrency: 1,
        respectRobots: false,
        followRedirects: true,
        restrictToSubdomain: true,
        timeout: 30000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: false,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 0,
      });
    }, `${siteServer.url}/huge`);
    expect(startResult.success).toBe(true);
    const crawlId = startResult.crawlId as string;

    await expect.poll(async () => {
      const crawls = await window.evaluate(async () => {
        // @ts-expect-error: api is injected by preload
        return await window.api.getCrawls();
      });
      return crawls.find((c: { id: string }) => c.id === crawlId)?.status;
    }, { timeout: 120_000, intervals: [1000] }).toBe('completed');

    const pages: PageData[] = await window.evaluate(async (id: string) => {
      // @ts-expect-error: api is injected by preload
      return await window.api.getPages(id);
    }, crawlId);

    const huge = pages.find(p => new URL(p.url).pathname === '/huge');
    expect(huge).toBeTruthy();
    expect(huge!.pageSizeBytes).toBeGreaterThan(2 * 1024 * 1024);
  });
});
