import { describe, it, expect } from 'vitest';
import { buildHealth } from '../renderer/components/SiteMap';
import type { PageData } from '../types/index';

/**
 * Guards the treemap health scoring. The map previously carried its own
 * hardcoded rules that counted missing structured data, canonical and HSTS as
 * problems. Those describe nearly every page on nearly every real site, so
 * every page came out unhealthy and the map rendered as one flat colour.
 */

function page(over: Partial<PageData> = {}): PageData {
  return {
    id: 'id-' + (over.url ?? 'x'),
    crawlId: 'c1',
    url: over.url ?? 'https://example.com/',
    statusCode: 200,
    contentType: 'text/html',
    title: 'A reasonably long page title for SEO',
    titleLength: 36,
    titlePixelWidth: 320,
    metaDescription: 'A meta description that is long enough to satisfy the lower bound check.',
    metaDescLength: 73,
    metaDescPixelWidth: 500,
    h1: 'Primary heading',
    h2: 'Sub heading',
    wordCount: 800,
    canonicalUrl: over.url ?? 'https://example.com/',
    isCanonicalized: false,
    isIndexable: true,
    responseTimeMs: 100,
    pageSizeBytes: 4000,
    crawlDepth: 1,
    costUsd: 0,
    createdAt: new Date('2024-06-01T00:00:00Z').toISOString(),
    contentHash: 'h-' + (over.url ?? 'x'),
    h1Length: 15,
    h2Length: 11,
    h1Count: 1,
    h2Count: 2,
    robotsDirectives: 'index,follow',
    metaKeywords: null,
    textRatio: 0.6,
    ogTitle: 'OG',
    ogDescription: 'OG desc',
    ogImage: 'https://example.com/og.png',
    ogType: 'website',
    twitterCard: 'summary',
    twitterTitle: 'TW',
    twitterDescription: 'TW',
    twitterImage: 'https://example.com/tw.png',
    schemaTypes: 'Article',
    schemaJson: '{}',
    schemaErrors: null,
    hasStructuredData: true,
    hasHSTS: true,
    hasCSP: true,
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    imageCount: 5,
    linkScore: 50,
    simhash: null,
    ...over,
  };
}

const healthOf = (p: PageData) => buildHealth([p]).get(p.url)!;
const isHealthy = (h: { critical: number; warning: number }) =>
  h.critical === 0 && h.warning === 0;

describe('treemap health', () => {
  it('reports a clean page as healthy', () => {
    const h = healthOf(page({ url: 'https://example.com/clean' }));
    expect(h).toEqual({ critical: 0, warning: 0, total: 0 });
  });

  it('keeps a page healthy when its only findings are opportunities', () => {
    // The exact combination that used to force every real page amber:
    // no JSON-LD, no CSP, no X-Frame-Options, no og:title.
    const h = healthOf(
      page({
        url: 'https://example.com/opportunities',
        hasStructuredData: false,
        schemaTypes: null,
        schemaJson: null,
        hasCSP: false,
        xFrameOptions: null,
        ogTitle: null,
      }),
    );
    expect(h.critical).toBe(0);
    expect(h.warning).toBe(0);
    expect(isHealthy(h)).toBe(true);
    // Still surfaced in the tooltip count, just not held against the page.
    expect(h.total).toBeGreaterThan(0);
  });

  it('counts critical severities and marks the page unhealthy', () => {
    const h = healthOf(page({ url: 'https://example.com/gone', statusCode: 404 }));
    expect(h.critical).toBeGreaterThan(0);
    expect(isHealthy(h)).toBe(false);
  });

  it('counts warning severities and marks the page unhealthy', () => {
    const h = healthOf(
      page({ url: 'https://example.com/nometa', metaDescription: null, metaDescLength: 0 }),
    );
    expect(h.critical).toBe(0);
    expect(h.warning).toBeGreaterThan(0);
    expect(isHealthy(h)).toBe(false);
  });

  it('scores each url independently across a crawl', () => {
    const health = buildHealth([
      page({ url: 'https://example.com/ok' }),
      page({ url: 'https://example.com/broken', statusCode: 500 }),
    ]);
    expect(isHealthy(health.get('https://example.com/ok')!)).toBe(true);
    expect(isHealthy(health.get('https://example.com/broken')!)).toBe(false);
  });

  it('gives every crawled url an entry, so the map never drops a page', () => {
    const urls = ['https://example.com/a', 'https://example.com/b'];
    const health = buildHealth(urls.map((url) => page({ url })));
    expect([...health.keys()].sort()).toEqual(urls);
  });
});
