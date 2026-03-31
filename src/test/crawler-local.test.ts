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

    it('computes h1/h2 counts and character lengths', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.h1Count).toBe(1);
      expect(page.h2Count).toBe(1);
      expect(page.h1Length).toBe('Main heading'.length);
      expect(page.h2Length).toBe('Sub heading'.length);
    });

    it('counts multiple h1/h2 tags', async () => {
      const html = `<html><head><title>Multi</title></head><body>
        <h1>First</h1><h1>Second</h1>
        <h2>A</h2><h2>B</h2><h2>C</h2>
      </body></html>`;
      mockResponse(html);
      const { page } = await crawlPageLocal('https://example.com/multi', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.h1Count).toBe(2);
      expect(page.h2Count).toBe(3);
      expect(page.h1Length).toBe('First'.length);
      expect(page.h2Length).toBe('A'.length);
    });
  });

  describe('new metadata fields', () => {
    it('extracts meta keywords', async () => {
      const html = `<html><head><title>KW</title>
        <meta name="keywords" content="seo, tools, crawler">
      </head><body><p>Content</p></body></html>`;
      mockResponse(html);
      const { page } = await crawlPageLocal('https://example.com/kw', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.metaKeywords).toBe('seo, tools, crawler');
    });

    it('returns null metaKeywords when tag is absent', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.metaKeywords).toBeNull();
    });

    it('extracts robots directives from meta tag', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.robotsDirectives).toBe('index, follow');
    });

    it('computes text ratio as percentage', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.textRatio).toBeTypeOf('number');
      expect(page.textRatio).toBeGreaterThan(0);
      expect(page.textRatio).toBeLessThan(100);
    });

    it('returns null textRatio for non-HTML', async () => {
      mockResponse('binary content here', 200, 'application/pdf');
      const { page } = await crawlPageLocal('https://example.com/file.pdf', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.textRatio).toBeNull();
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

  // ── Redirect chain detection ──

  describe('redirect chain detection', () => {
    it('captures a 301 redirect chain with multiple hops', async () => {
      // Hop 1: 301 → /new-page
      axiosMock.mockResolvedValueOnce({
        status: 301,
        headers: { 'content-type': 'text/html', location: 'https://example.com/new-page' },
        data: '',
      } as never);
      // Hop 2: 302 → /final-page
      axiosMock.mockResolvedValueOnce({
        status: 302,
        headers: { 'content-type': 'text/html', location: 'https://example.com/final-page' },
        data: '',
      } as never);
      // Hop 3: 200 (final)
      axiosMock.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: '<html><head><title>Final</title></head><body>Done</body></html>',
      } as never);

      const { redirectChain, page } = await crawlPageLocal(
        'https://example.com/old-page', crawlId, 0, BASE_CONFIG, baseOrigin
      );

      expect(redirectChain.length).toBe(3);
      expect(redirectChain[0]).toEqual({ url: 'https://example.com/old-page', statusCode: 301 });
      expect(redirectChain[1]).toEqual({ url: 'https://example.com/new-page', statusCode: 302 });
      expect(redirectChain[2]).toEqual({ url: 'https://example.com/final-page', statusCode: 200 });
      // Redirect pages should show the first redirect status, not the final destination's
      expect(page.statusCode).toBe(301);
      // Content should NOT be extracted from the redirected-to page
      expect(page.title).toBeNull();
      expect(page.pageSizeBytes).toBe(0);
    });

    it('returns empty chain when no redirects occur', async () => {
      mockResponse(SIMPLE_PAGE);
      const { redirectChain } = await crawlPageLocal(
        'https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin
      );
      expect(redirectChain).toHaveLength(0);
    });

    it('does not follow redirects when followRedirects is disabled', async () => {
      const noRedirectConfig = { ...BASE_CONFIG, followRedirects: false };
      axiosMock.mockResolvedValueOnce({
        status: 301,
        headers: { 'content-type': 'text/html', location: 'https://example.com/new' },
        data: '',
      } as never);

      const { redirectChain, page } = await crawlPageLocal(
        'https://example.com/old', crawlId, 0, noRedirectConfig, baseOrigin
      );

      // With followRedirects=false, maxHops=0, so the loop runs once and breaks
      expect(redirectChain).toHaveLength(0);
      expect(page.statusCode).toBe(301);
    });

    it('resolves relative redirect locations', async () => {
      axiosMock.mockResolvedValueOnce({
        status: 301,
        headers: { 'content-type': 'text/html', location: '/target' },
        data: '',
      } as never);
      axiosMock.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'text/html' },
        data: '<html><body>OK</body></html>',
      } as never);

      const { redirectChain } = await crawlPageLocal(
        'https://example.com/start', crawlId, 0, BASE_CONFIG, baseOrigin
      );

      expect(redirectChain.length).toBe(2);
      expect(redirectChain[0].url).toBe('https://example.com/start');
      expect(redirectChain[1].url).toBe('https://example.com/target');
    });
  });

  // ── Hreflang extraction ──

  describe('hreflang extraction', () => {
    const HREFLANG_PAGE = `
    <html><head>
      <title>International Page</title>
      <link rel="alternate" hreflang="en" href="https://example.com/en/">
      <link rel="alternate" hreflang="es" href="https://example.com/es/">
      <link rel="alternate" hreflang="x-default" href="https://example.com/">
    </head><body><p>Hello</p></body></html>`;

    it('extracts hreflang entries when extractHreflang is enabled', async () => {
      mockResponse(HREFLANG_PAGE);
      const cfg = { ...BASE_CONFIG, extractHreflang: true };
      const { hreflang } = await crawlPageLocal(
        'https://example.com/', crawlId, 0, cfg, baseOrigin
      );

      expect(hreflang).toHaveLength(3);
      expect(hreflang).toContainEqual({ hreflang: 'en', href: 'https://example.com/en/' });
      expect(hreflang).toContainEqual({ hreflang: 'es', href: 'https://example.com/es/' });
      expect(hreflang).toContainEqual({ hreflang: 'x-default', href: 'https://example.com/' });
    });

    it('returns empty hreflang when extractHreflang is disabled', async () => {
      mockResponse(HREFLANG_PAGE);
      const { hreflang } = await crawlPageLocal(
        'https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin
      );
      expect(hreflang).toHaveLength(0);
    });

    it('resolves relative hreflang hrefs', async () => {
      const html = `<html><head>
        <link rel="alternate" hreflang="fr" href="/fr/">
      </head><body>Hi</body></html>`;
      mockResponse(html);
      const cfg = { ...BASE_CONFIG, extractHreflang: true };
      const { hreflang } = await crawlPageLocal(
        'https://example.com/page', crawlId, 0, cfg, baseOrigin
      );

      expect(hreflang).toHaveLength(1);
      expect(hreflang[0].href).toBe('https://example.com/fr/');
    });

    it('skips hreflang links missing hreflang or href attributes', async () => {
      const html = `<html><head>
        <link rel="alternate" hreflang="en" href="https://example.com/en/">
        <link rel="alternate" hreflang="" href="https://example.com/empty/">
        <link rel="alternate" hreflang="de">
      </head><body>Hi</body></html>`;
      mockResponse(html);
      const cfg = { ...BASE_CONFIG, extractHreflang: true };
      const { hreflang } = await crawlPageLocal(
        'https://example.com/', crawlId, 0, cfg, baseOrigin
      );

      // Only the first entry has both valid hreflang and href
      expect(hreflang).toHaveLength(1);
      expect(hreflang[0].hreflang).toBe('en');
    });
  });

  // ── Content hash / duplicate detection ──

  describe('content hash', () => {
    it('generates SHA-256 content hash from body text', async () => {
      mockResponse(SIMPLE_PAGE);
      const { contentHash } = await crawlPageLocal(
        'https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin
      );

      expect(contentHash).not.toBeNull();
      expect(contentHash).toMatch(/^[a-f0-9]{64}$/); // valid SHA-256 hex
    });

    it('produces identical hashes for identical body content', async () => {
      mockResponse(SIMPLE_PAGE);
      const result1 = await crawlPageLocal('https://example.com/a', crawlId, 0, BASE_CONFIG, baseOrigin);

      mockResponse(SIMPLE_PAGE);
      const result2 = await crawlPageLocal('https://example.com/b', crawlId, 0, BASE_CONFIG, baseOrigin);

      expect(result1.contentHash).toBe(result2.contentHash);
    });

    it('produces different hashes for different content', async () => {
      mockResponse('<html><body>Content A is unique text</body></html>');
      const result1 = await crawlPageLocal('https://example.com/a', crawlId, 0, BASE_CONFIG, baseOrigin);

      mockResponse('<html><body>Content B is different text</body></html>');
      const result2 = await crawlPageLocal('https://example.com/b', crawlId, 0, BASE_CONFIG, baseOrigin);

      expect(result1.contentHash).not.toBe(result2.contentHash);
    });

    it('returns null hash for non-HTML responses', async () => {
      axiosMock.mockResolvedValueOnce({
        status: 200,
        headers: { 'content-type': 'application/pdf' },
        data: '%PDF-1.4 data',
      } as never);

      const { contentHash } = await crawlPageLocal(
        'https://example.com/doc.pdf', crawlId, 0, BASE_CONFIG, baseOrigin
      );
      expect(contentHash).toBeNull();
    });
  });

  // ── Custom CSS extraction ──

  describe('custom CSS extraction', () => {
    const STRUCTURED_PAGE = `
    <html><head>
      <title>Product Page</title>
      <meta name="author" content="John Doe">
    </head><body>
      <h1 class="product-name">Widget Pro</h1>
      <span class="price">$29.99</span>
      <div class="description">A great widget for all your needs.</div>
      <span class="missing-class">Not matched</span>
    </body></html>`;

    it('extracts text from CSS selectors', async () => {
      const cfg: CrawlConfig = {
        ...BASE_CONFIG,
        customExtractions: [
          { name: 'Product Name', selector: 'h1.product-name' },
          { name: 'Price', selector: 'span.price' },
        ],
      };
      mockResponse(STRUCTURED_PAGE);
      const { customExtractions } = await crawlPageLocal(
        'https://example.com/product', crawlId, 0, cfg, baseOrigin
      );

      expect(customExtractions).toHaveLength(2);
      expect(customExtractions[0]).toEqual({
        name: 'Product Name',
        selector: 'h1.product-name',
        value: 'Widget Pro',
      });
      expect(customExtractions[1]).toEqual({
        name: 'Price',
        selector: 'span.price',
        value: '$29.99',
      });
    });

    it('falls back to content attribute when text is empty', async () => {
      const cfg: CrawlConfig = {
        ...BASE_CONFIG,
        customExtractions: [
          { name: 'Author', selector: 'meta[name="author"]' },
        ],
      };
      mockResponse(STRUCTURED_PAGE);
      const { customExtractions } = await crawlPageLocal(
        'https://example.com/product', crawlId, 0, cfg, baseOrigin
      );

      expect(customExtractions).toHaveLength(1);
      expect(customExtractions[0].value).toBe('John Doe');
    });

    it('returns null when selector matches no elements', async () => {
      const cfg: CrawlConfig = {
        ...BASE_CONFIG,
        customExtractions: [
          { name: 'SKU', selector: '.sku-number' },
        ],
      };
      mockResponse(STRUCTURED_PAGE);
      const { customExtractions } = await crawlPageLocal(
        'https://example.com/product', crawlId, 0, cfg, baseOrigin
      );

      expect(customExtractions).toHaveLength(1);
      expect(customExtractions[0].value).toBeNull();
    });

    it('returns empty array when no custom extraction rules configured', async () => {
      mockResponse(SIMPLE_PAGE);
      const { customExtractions } = await crawlPageLocal(
        'https://example.com/page', crawlId, 0, BASE_CONFIG, baseOrigin
      );
      expect(customExtractions).toHaveLength(0);
    });
  });

  // ── Open Graph extraction ──

  describe('Open Graph extraction', () => {
    const OG_PAGE = `<html><head>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG Description">
      <meta property="og:image" content="https://example.com/og.jpg">
      <meta property="og:type" content="article">
    </head><body>Content</body></html>`;

    it('extracts all OG meta tags', async () => {
      mockResponse(OG_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.ogTitle).toBe('OG Title');
      expect(page.ogDescription).toBe('OG Description');
      expect(page.ogImage).toBe('https://example.com/og.jpg');
      expect(page.ogType).toBe('article');
    });

    it('returns null for missing OG tags', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.ogTitle).toBeNull();
      expect(page.ogDescription).toBeNull();
      expect(page.ogImage).toBeNull();
      expect(page.ogType).toBeNull();
    });
  });

  // ── Twitter Card extraction ──

  describe('Twitter Card extraction', () => {
    const TWITTER_PAGE = `<html><head>
      <meta name="twitter:card" content="summary_large_image">
      <meta name="twitter:title" content="Twitter Title">
      <meta name="twitter:description" content="Twitter Desc">
      <meta name="twitter:image" content="https://example.com/tw.jpg">
    </head><body>Content</body></html>`;

    it('extracts all Twitter Card meta tags', async () => {
      mockResponse(TWITTER_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.twitterCard).toBe('summary_large_image');
      expect(page.twitterTitle).toBe('Twitter Title');
      expect(page.twitterDescription).toBe('Twitter Desc');
      expect(page.twitterImage).toBe('https://example.com/tw.jpg');
    });

    it('returns null for missing Twitter tags', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.twitterCard).toBeNull();
      expect(page.twitterTitle).toBeNull();
      expect(page.twitterDescription).toBeNull();
      expect(page.twitterImage).toBeNull();
    });
  });

  // ── Structured Data / JSON-LD extraction ──

  describe('structured data extraction', () => {
    const JSONLD_PAGE = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Example"
      }
      </script>
    </head><body>Content</body></html>`;

    const MULTI_SCHEMA_PAGE = `<html><head>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "WebPage",
        "name": "Home"
      }
      </script>
      <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": []
      }
      </script>
    </head><body>Content</body></html>`;

    it('detects JSON-LD structured data and extracts schema types', async () => {
      mockResponse(JSONLD_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.hasStructuredData).toBe(true);
      expect(page.schemaTypes).toBe('Organization');
      expect(page.schemaJson).not.toBeNull();
      const blocks = JSON.parse(page.schemaJson!);
      expect(blocks).toHaveLength(1);
    });

    it('extracts multiple JSON-LD blocks', async () => {
      mockResponse(MULTI_SCHEMA_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.hasStructuredData).toBe(true);
      const blocks = JSON.parse(page.schemaJson!);
      expect(blocks).toHaveLength(2);
      expect(page.schemaTypes).toContain('WebPage');
      expect(page.schemaTypes).toContain('BreadcrumbList');
    });

    it('returns false hasStructuredData when no schema exists', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.hasStructuredData).toBe(false);
      expect(page.schemaTypes).toBeNull();
      expect(page.schemaJson).toBeNull();
    });
  });

  // ── Security Headers extraction ──

  describe('security headers extraction', () => {
    it('detects security headers when present', async () => {
      axiosMock.mockResolvedValueOnce({
        status: 200,
        headers: {
          'content-type': 'text/html',
          'strict-transport-security': 'max-age=31536000; includeSubDomains',
          'content-security-policy': "default-src 'self'",
          'x-frame-options': 'DENY',
          'x-content-type-options': 'nosniff',
        },
        data: '<html><head><title>Secure</title></head><body>Content</body></html>',
      } as never);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.hasHSTS).toBe(true);
      expect(page.hasCSP).toBe(true);
      expect(page.xFrameOptions).toBe('DENY');
      expect(page.xContentTypeOptions).toBe('nosniff');
    });

    it('returns false/null when security headers missing', async () => {
      mockResponse(SIMPLE_PAGE);
      const { page } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.hasHSTS).toBe(false);
      expect(page.hasCSP).toBe(false);
      expect(page.xFrameOptions).toBeNull();
      expect(page.xContentTypeOptions).toBeNull();
    });
  });

  // ── Image optimization extraction ──

  describe('image optimization extraction', () => {
    it('extracts image attributes', async () => {
      mockResponse('<html><head><title>Imgs</title></head><body>' +
        '<img src="/hero.webp" alt="Hero" width="800" height="600" loading="lazy">' +
        '<img src="/icon.png" alt="">' +
        '</body></html>');
      const { page, images } = await crawlPageLocal('https://example.com/', crawlId, 0, BASE_CONFIG, baseOrigin);
      expect(page.imageCount).toBe(2);
      expect(images).toHaveLength(2);

      const hero = images.find(i => i.imageUrl.includes('hero.webp'));
      expect(hero?.format).toBe('webp');
      expect(hero?.hasWidth).toBe(true);
      expect(hero?.hasHeight).toBe(true);
      expect(hero?.isLazy).toBe(true);

      const icon = images.find(i => i.imageUrl.includes('icon.png'));
      expect(icon?.format).toBe('png');
      expect(icon?.hasWidth).toBe(false);
      expect(icon?.hasHeight).toBe(false);
      expect(icon?.isLazy).toBe(false);
    });
  });
});
