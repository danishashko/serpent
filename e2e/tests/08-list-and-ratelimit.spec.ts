import { test, expect } from '../fixtures';
import { startSiteServer, type SiteServer } from '../helpers/site-server';

/**
 * QA sweep: the two behaviours users explicitly care about and frequently
 * file issues about —
 *   1. List mode crawls EXACTLY the supplied URLs (no spidering), and works
 *      across multiple origins (paste / clipboard / file lists).
 *   2. The Rate Limit (req/s) control actually paces requests.
 */
test.describe('List mode + rate limit', () => {
  test('list mode crawls exactly the supplied URLs, across two origins', async ({ window, siteServer }) => {
    // Spin up a SECOND independent origin so we can prove cross-domain lists work.
    let second: SiteServer | null = null;
    try {
      second = await startSiteServer();

      const urls = [
        `${siteServer.url}/about`,
        `${siteServer.url}/contact`,
        `${second.url}/products`, // different origin (different port)
      ];

      const startResult = await window.evaluate(async (listUrls: string[]) => {
        // @ts-expect-error: api is injected by preload
        return await window.api.crawlStart({
          startUrl: listUrls.join('\n'),
          urlList: listUrls,
          mode: 'list',
          engine: 'local',
          storageMode: 'database',
          maxUrls: 50,
          maxDepth: 5,
          concurrency: 3,
          respectRobots: false,
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
      }, urls);

      expect(startResult).toMatchObject({ success: true });
      const crawlId = (startResult as { crawlId: string }).crawlId;

      await window.waitForFunction(async (id) => {
        // @ts-expect-error
        const crawls = await window.api.getCrawls();
        const me = crawls.find((c: { id: string; status: string }) => c.id === id);
        return me && (me.status === 'completed' || me.status === 'error');
      }, crawlId, { timeout: 60_000 });

      const pages = await window.evaluate(async (id) => {
        // @ts-expect-error
        return await window.api.getPages(id);
      }, crawlId) as { url: string }[];

      const crawled = pages.map(p => p.url.replace(/\/$/, ''));

      // All three supplied URLs crawled — including the one on the second origin.
      expect(crawled.some(u => u === `${siteServer.url}/about`)).toBe(true);
      expect(crawled.some(u => u === `${siteServer.url}/contact`)).toBe(true);
      expect(crawled.some(u => u === `${second!.url}/products`)).toBe(true);

      // List mode must NOT spider: pages discovered via links (e.g. /products/a,
      // /broken on the first origin) must NOT appear.
      expect(crawled.some(u => u.endsWith('/products/a'))).toBe(false);
      expect(crawled.some(u => u.endsWith('/broken'))).toBe(false);
      expect(pages.length).toBe(3);
    } finally {
      if (second) await second.close();
    }
  });

  test('rate limit paces requests (1 req/s over 4 URLs takes >= ~3s)', async ({ window, siteServer }) => {
    const urls = [
      `${siteServer.url}/`,
      `${siteServer.url}/about`,
      `${siteServer.url}/products`,
      `${siteServer.url}/contact`,
    ];

    const startResult = await window.evaluate(async (listUrls: string[]) => {
      // @ts-expect-error
      return await window.api.crawlStart({
        startUrl: listUrls.join('\n'),
        urlList: listUrls,
        mode: 'list',
        engine: 'local',
        storageMode: 'database',
        maxUrls: 50,
        maxDepth: 5,
        concurrency: 5,
        requestsPerSecond: 1,
        respectRobots: false,
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
    }, urls);

    const crawlId = (startResult as { crawlId: string }).crawlId;

    // Poll from inside the renderer with a fixed cadence. (Playwright's
    // waitForFunction polls on rAF and can resolve a tick early with async
    // IPC predicates, so we measure completion explicitly instead.)
    const result = await window.evaluate(async (id) => {
      const start = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (Date.now() - start < 15000) {
        // @ts-expect-error: api is injected by preload
        const crawls = await window.api.getCrawls();
        const me = crawls.find((c: { id: string; status: string }) => c.id === id);
        if (me && (me.status === 'completed' || me.status === 'error')) {
          return { elapsed: Date.now() - start, status: me.status };
        }
        await new Promise(r => setTimeout(r, 100));
      }
      return { elapsed: Date.now() - start, status: 'timeout' };
    }, crawlId) as { elapsed: number; status: string };

    expect(result.status).toBe('completed');
    // With 1 req/s over 4 URLs, releases happen at t=0,1,2,3s — the crawl
    // cannot finish before ~3s. Allow scheduler slack: require at least 2.7s.
    expect(result.elapsed).toBeGreaterThanOrEqual(2700);

    const pages = await window.evaluate(async (id) => {
      // @ts-expect-error
      return await window.api.getPages(id);
    }, crawlId) as unknown[];
    expect(pages.length).toBe(4);
  });
});
