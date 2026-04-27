import { describe, it, expect } from 'vitest';
import { generateSitemap } from '../main/sitemap-generator';
import type { PageData, SitemapGenerateOptions } from '../types/index';

function p(url: string, over: Partial<PageData> = {}): PageData {
  return {
    id: 'id-' + url,
    crawlId: 'c1',
    url,
    statusCode: 200,
    contentType: 'text/html',
    title: 't',
    titleLength: 1,
    titlePixelWidth: 10,
    metaDescription: null,
    metaDescLength: null,
    metaDescPixelWidth: null,
    h1: null,
    h2: null,
    wordCount: 100,
    canonicalUrl: url,
    isCanonicalized: false,
    isIndexable: true,
    responseTimeMs: 100,
    pageSizeBytes: 1000,
    crawlDepth: 1,
    costUsd: 0,
    createdAt: '2024-06-01T00:00:00Z',
    contentHash: null,
    h1Length: null,
    h2Length: null,
    h1Count: 0,
    h2Count: 0,
    robotsDirectives: null,
    metaKeywords: null,
    textRatio: null,
    ogTitle: null,
    ogDescription: null,
    ogImage: null,
    ogType: null,
    twitterCard: null,
    twitterTitle: null,
    twitterDescription: null,
    twitterImage: null,
    schemaTypes: null,
    schemaJson: null,
    schemaErrors: null,
    hasStructuredData: false,
    hasHSTS: false,
    hasCSP: false,
    xFrameOptions: null,
    xContentTypeOptions: null,
    imageCount: 0,
    linkScore: 0,
    ...over,
  };
}

const opts: SitemapGenerateOptions = {
  crawlId: 'c1',
  origin: 'https://example.com',
};

describe('sitemap-generator', () => {
  it('emits a single sitemap.xml for a small crawl', () => {
    const bundle = generateSitemap([p('https://example.com/a'), p('https://example.com/b')], opts);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0].filename).toBe('sitemap.xml');
    expect(bundle.files[0].urlCount).toBe(2);
    expect(bundle.index).toBeNull();
    expect(bundle.totalUrls).toBe(2);
    expect(bundle.files[0].xml).toMatch(/<loc>https:\/\/example\.com\/a<\/loc>/);
    expect(bundle.files[0].xml).toMatch(/<loc>https:\/\/example\.com\/b<\/loc>/);
  });

  it('filters: cross-origin, non-200, non-indexable, duplicates', () => {
    const pages = [
      p('https://example.com/a'),
      p('https://other.com/b'),                                  // cross-origin
      p('https://example.com/404', { statusCode: 404 }),         // non-200
      p('https://example.com/no', { isIndexable: false }),       // non-indexable
      p('https://example.com/a'),                                // duplicate
    ];
    const bundle = generateSitemap(pages, opts);
    expect(bundle.totalUrls).toBe(1);
    expect(bundle.files[0].xml.match(/<loc>/g)).toHaveLength(1);
  });

  it('emits empty urlset when no eligible pages', () => {
    const bundle = generateSitemap([p('https://example.com/x', { statusCode: 500 })], opts);
    expect(bundle.totalUrls).toBe(0);
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0].xml).toMatch(/<urlset[^>]*>\s*<\/urlset>/);
  });

  it('chunks above 50,000 and emits sitemap-index.xml', () => {
    const pages: PageData[] = [];
    for (let i = 0; i < 50_001; i++) pages.push(p(`https://example.com/p${i}`));
    const bundle = generateSitemap(pages, opts);
    expect(bundle.files).toHaveLength(2);
    expect(bundle.files[0].filename).toBe('sitemap-1.xml');
    expect(bundle.files[1].filename).toBe('sitemap-2.xml');
    expect(bundle.files[0].urlCount).toBe(50_000);
    expect(bundle.files[1].urlCount).toBe(1);
    expect(bundle.index?.filename).toBe('sitemap-index.xml');
    expect(bundle.index?.xml).toMatch(/<loc>https:\/\/example\.com\/sitemap-1\.xml<\/loc>/);
    expect(bundle.index?.xml).toMatch(/<loc>https:\/\/example\.com\/sitemap-2\.xml<\/loc>/);
  });

  it('emits lastmod in YYYY-MM-DD form', () => {
    const bundle = generateSitemap([p('https://example.com/a', { createdAt: '2024-06-15T12:34:56Z' })], opts);
    expect(bundle.files[0].xml).toMatch(/<lastmod>2024-06-15<\/lastmod>/);
  });

  it('xml-escapes URLs', () => {
    const bundle = generateSitemap(
      [p('https://example.com/?q=a&b=<c>"d\'')],
      opts,
    );
    expect(bundle.files[0].xml).toMatch(/&amp;/);
    expect(bundle.files[0].xml).toMatch(/&lt;/);
    expect(bundle.files[0].xml).toMatch(/&gt;/);
    expect(bundle.files[0].xml).toMatch(/&quot;/);
    expect(bundle.files[0].xml).toMatch(/&apos;/);
  });

  it('honours defaultChangefreq + defaultPriority and clamps priority to [0,1]', () => {
    const bundle = generateSitemap(
      [p('https://example.com/a')],
      { ...opts, defaultChangefreq: 'weekly', defaultPriority: 1.5 },
    );
    expect(bundle.files[0].xml).toMatch(/<changefreq>weekly<\/changefreq>/);
    expect(bundle.files[0].xml).toMatch(/<priority>1\.0<\/priority>/);
  });

  it('strips trailing slash from origin in index entries', () => {
    const pages: PageData[] = [];
    for (let i = 0; i < 50_001; i++) pages.push(p(`https://example.com/p${i}`));
    const bundle = generateSitemap(pages, { ...opts, origin: 'https://example.com/' });
    expect(bundle.index?.xml).not.toMatch(/example\.com\/\/sitemap/);
  });
});
