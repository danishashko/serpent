/**
 * Tests for crawler-local.ts — crawlPageLocal()
 *
 * We don't boot Electron. The electron mock stubs out BrowserWindow so
 * the module loads cleanly. All tests use normal HTTP (axios) mode,
 * exercising the cheerio extraction logic via an in-process HTML fixture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Must import AFTER mocks are set up
import { crawlPageLocal } from '../main/crawler-local';
import { CrawlConfig } from '../types/index';

// ── Mock axios so we never hit the network ──
vi.mock('axios');
const axiosMock = vi.mocked(axios.get);

const BASE_CONFIG: CrawlConfig = {
  startUrl: 'https://example.com',
  mode: 'spider',
  engine: 'local',
  storageMode: 'database',
  maxUrls: 100,
  maxDepth: 3,
  concurrency: 2,
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
};

function mockResponse(html: string, status = 200, contentType = 'text/html; charset=utf-8') {
  axiosMock.mockResolvedValueOnce({
    status,
    headers: { 'content-type': contentType },
    data: html,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helper HTML fixtures ──

const SIMPLE_PAGE = `
<!DOCTYPE html>
<html>
<head>
  <title>Hello World</title>
  <meta name="description" content="A test page about things">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://example.com/page">
</head>
<body>
  <h1>Main heading</h1>
  <h2>Sub heading</h2>
  <p>Some content here with enough words to count properly in unit tests.</p>
  <a href="/about">About us</a>
  <a href="https://other.com/ext" rel="nofollow">External link</a>
  <a href="https://example.com/contact">Contact</a>
  <img src="/logo.png" alt="Company logo">
  <img src="https://cdn.example.com/hero.jpg">
</body>
</html>`;

const NO_META_PAGE = `
<html><head><title></title></head>
<body><h1></h1><p>Short</p></body>
</html>`;

const NOINDEX_PAGE = `
<html><head>
  <title>Secret</title>
  <meta name="robots" content="noindex, nofollow">
</head><body><p>Hidden</p></body></html>`;

// ── Tests ──

describe('crawlPageLocal', () => {
  const crawlId = 'test-crawl';
  const baseOrigin = 'https://example.com';

  describe('title extraction', () => {
    it('extracts page title and computes length + pixel width', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      expect(page.title).toBe('Hello World');
      expect(page.titleLength).toBe(11);
      expect(page.titlePixelWidth).toBeGreaterThan(0);
    });

    it('sets title to null when title tag is empty', async () => {
      mockResponse(NO_META_PAGE);
      const { page } = await crawlPageLocal('https://example.com/empty', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.title).toBeNull();
    });
  });

  describe('meta description extraction', () => {
    it('extracts meta description', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      expect(page.metaDescription).toBe('A test page about things');
      expect(page.metaDescLength).toBe(24);
    });

    it('returns null when meta description is absent', async () => {
      mockResponse(NO_META_PAGE);
      const { page } = await crawlPageLocal('https://example.com/empty', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.metaDescription).toBeNull();
    });
  });

  describe('headings extraction', () => {
    it('extracts h1 and h2', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.h1).toBe('Main heading');
      expect(page.h2).toBe('Sub heading');
    });
  });

  describe('indexability', () => {
    it('marks page as indexable without noindex', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.isIndexable).toBe(true);
    });

    it('marks page as NOT indexable with noindex robots meta', async () => {
      mockResponse(NOINDEX_PAGE);
      const { page } = await crawlPageLocal('https://example.com/secret', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.isIndexable).toBe(false);
    });

    it('marks 4xx pages as not indexable', async () => {
      mockResponse('<html><body>Not found</body></html>', 404);
      const { page } = await crawlPageLocal('https://example.com/gone', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.statusCode).toBe(404);
      expect(page.isIndexable).toBe(false);
    });
  });

  describe('link extraction', () => {
    it('resolves relative hrefs into absolute URLs', async () => {
      mockResponse(SIMPLE_PAGE);
      const { links } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const aboutLink = links.find(l => l.targetUrl.includes('/about'));
      expect(aboutLink).toBeDefined();
      expect(aboutLink!.targetUrl).toBe('https://example.com/about');
    });

    it('correctly classifies internal vs external links', async () => {
      mockResponse(SIMPLE_PAGE);
      const { links } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const internal = links.filter(l => l.isInternal);
      const external = links.filter(l => !l.isInternal);

      // /about and /contact are internal; other.com is external
      expect(internal.length).toBeGreaterThanOrEqual(2);
      expect(external.length).toBeGreaterThanOrEqual(1);

      const extLink = external.find(l => l.targetUrl.includes('other.com'));
      expect(extLink).toBeDefined();
    });

    it('captures anchor text', async () => {
      mockResponse(SIMPLE_PAGE);
      const { links } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const aboutLink = links.find(l => l.targetUrl.includes('/about'));
      expect(aboutLink!.anchorText).toBe('About us');
    });

    it('captures rel attribute (nofollow)', async () => {
      mockResponse(SIMPLE_PAGE);
      const { links } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const extLink = links.find(l => l.targetUrl.includes('other.com'));
      expect(extLink!.relAttr).toBe('nofollow');
    });

    it('populates discoveredUrls with internal links only', async () => {
      mockResponse(SIMPLE_PAGE);
      const { discoveredUrls } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      // Only internal links go into the discovery queue
      expect(discoveredUrls.every(u => u.startsWith('https://example.com'))).toBe(true);
      expect(discoveredUrls).not.toContain(expect.stringContaining('other.com'));
    });

    it('skips mailto:, tel:, and javascript: hrefs', async () => {
      const html = `<html><body>
        <a href="mailto:a@b.com">email</a>
        <a href="tel:+1234">call</a>
        <a href="javascript:void(0)">js</a>
        <a href="https://example.com/real">real</a>
      </body></html>`;
      mockResponse(html);
      const { links } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(links).toHaveLength(1);
      expect(links[0].targetUrl).toBe('https://example.com/real');
    });

    it('strips URL fragments before storing', async () => {
      const html = `<html><body><a href="https://example.com/page#section">link</a></body></html>`;
      mockResponse(html);
      const { links } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(links[0].targetUrl).toBe('https://example.com/page');
    });

    it('returns empty links when extractLinks is disabled', async () => {
      mockResponse(SIMPLE_PAGE);
      const cfg = { ...BASE_CONFIG, extractLinks: false };
      const { links, discoveredUrls } = await crawlPageLocal('https://example.com/page', crawlId, 0, cfg, baseOrigin);
      expect(links).toHaveLength(0);
      expect(discoveredUrls).toHaveLength(0);
    });
  });

  describe('image extraction', () => {
    it('extracts image src resolved to absolute URL', async () => {
      mockResponse(SIMPLE_PAGE);
      const { images } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const logo = images.find(i => i.imageUrl.includes('logo.png'));
      expect(logo).toBeDefined();
      expect(logo!.imageUrl).toBe('https://example.com/logo.png');
      expect(logo!.pageUrl).toBe('https://example.com/page');
    });

    it('captures alt text', async () => {
      mockResponse(SIMPLE_PAGE);
      const { images } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const logo = images.find(i => i.imageUrl.includes('logo.png'));
      expect(logo!.altText).toBe('Company logo');
    });

    it('stores null altText when alt attribute is missing', async () => {
      mockResponse(SIMPLE_PAGE);
      const { images } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      const hero = images.find(i => i.imageUrl.includes('hero.jpg'));
      expect(hero!.altText).toBeNull();
    });

    it('returns empty images when extractImages is disabled', async () => {
      mockResponse(SIMPLE_PAGE);
      const cfg = { ...BASE_CONFIG, extractImages: false };
      const { images } = await crawlPageLocal('https://example.com/page', crawlId, 0, cfg, baseOrigin);
      expect(images).toHaveLength(0);
    });
  });

  describe('network error handling', () => {
    it('captures statusCode 0 and empty data on network timeout', async () => {
      axiosMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const { page } = await crawlPageLocal('https://example.com/down', crawlId, 0, BASE_CONFIG, baseOrigin);

      expect(page.statusCode).toBe(0);
      expect(page.title).toBeNull();
      expect(page.links).toBeUndefined(); // page object only, links separate
    });

    it('captures status from HTTP error responses (4xx/5xx)', async () => {
      axiosMock.mockRejectedValueOnce({
        response: { status: 503, headers: { 'content-type': 'text/html' } },
      });
      const { page } = await crawlPageLocal('https://example.com/down', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.statusCode).toBe(503);
    });
  });

  describe('non-HTML responses', () => {
    it('does not extract any SEO data from PDF responses', async () => {
      axiosMock.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        data: '%PDF-1.4 binary data...',
      } as never);

      const { page, links, images } = await crawlPageLocal(
        'https://example.com/doc.pdf', crawlId, 0, BASE_CONFIG, baseOrigin
      );

      expect(page.title).toBeNull();
      expect(links).toHaveLength(0);
      expect(images).toHaveLength(0);
    });
  });

  describe('page metadata', () => {
    it('sets crawlId, depth, and costUsd=0 on every page', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 2, BASE_CONFIG, baseOrigin);

      expect(page.crawlId).toBe(crawlId);
      expect(page.crawlDepth).toBe(2);
      expect(page.costUsd).toBe(0);
    });

    it('records response time and page size in bytes', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);

      expect(page.responseTimeMs).toBeGreaterThanOrEqual(0);
      expect(page.pageSizeBytes).toBeGreaterThan(0);
    });
  });
});
