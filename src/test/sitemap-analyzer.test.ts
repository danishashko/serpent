import { describe, it, expect } from 'vitest';
import { gzipSync } from 'zlib';
import { analyzeSitemap, type AnalyzerDeps } from '../main/sitemap-analyzer';
import type { PageData } from '../types/index';

function makeDeps(map: Record<string, { body: string | Buffer; status?: number; contentType?: string }>): AnalyzerDeps {
  return {
    async fetch(url: string) {
      const entry = map[url];
      if (!entry) return { status: 404, data: Buffer.from(''), contentType: 'text/plain' };
      const data = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body, 'utf8');
      return {
        status: entry.status ?? 200,
        data,
        contentType: (entry.contentType ?? 'application/xml').toLowerCase(),
      };
    },
  };
}

function p(url: string, over: Partial<PageData> = {}): PageData {
  return {
    id: 'id-' + url,
    crawlId: 'c1',
    url,
    statusCode: 200,
    contentType: 'text/html',
    title: null, titleLength: null, titlePixelWidth: null,
    metaDescription: null, metaDescLength: null, metaDescPixelWidth: null,
    h1: null, h2: null, wordCount: null, canonicalUrl: null,
    isCanonicalized: false, isIndexable: true,
    responseTimeMs: null, pageSizeBytes: null, crawlDepth: 1,
    costUsd: 0, createdAt: '2024-01-01T00:00:00Z', contentHash: null,
    h1Length: null, h2Length: null, h1Count: 0, h2Count: 0,
    robotsDirectives: null, metaKeywords: null, textRatio: null,
    ogTitle: null, ogDescription: null, ogImage: null, ogType: null,
    twitterCard: null, twitterTitle: null, twitterDescription: null, twitterImage: null,
    schemaTypes: null, schemaJson: null, schemaErrors: null, hasStructuredData: false,
    hasHSTS: false, hasCSP: false, xFrameOptions: null, xContentTypeOptions: null,
    imageCount: 0, linkScore: 0,
    ...over,
  };
}

const URLSET = (urls: string[]) =>
  `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join('\n')}\n</urlset>`;

const SITEMAPINDEX = (urls: string[]) =>
  `<?xml version="1.0"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((u) => `<sitemap><loc>${u}</loc></sitemap>`)
    .join('\n')}\n</sitemapindex>`;

describe('sitemap-analyzer', () => {
  it('parses a single urlset and computes diff sets correctly', async () => {
    const sm = 'https://example.com/sitemap.xml';
    const deps = makeDeps({
      [sm]: { body: URLSET(['https://example.com/a', 'https://example.com/b', 'https://example.com/orphan']) },
    });
    const pages = [
      p('https://example.com/a'),
      p('https://example.com/b'),
      p('https://example.com/c'), // not in sitemap
    ];
    const r = await analyzeSitemap(sm, pages, deps);
    expect(r.urlsInSitemap).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/orphan',
    ]);
    expect(r.orphanFromSitemap).toEqual(['https://example.com/orphan']);
    expect(r.notInSitemap).toEqual(['https://example.com/c']);
    expect(r.nonIndexableInSitemap).toEqual([]);
    expect(r.duplicateInSitemap).toEqual([]);
    expect(r.errors).toEqual([]);
    expect(r.fetchedSitemaps).toEqual([sm]);
  });

  it('flags non-indexable / 4xx URLs that appear in sitemap', async () => {
    const sm = 'https://example.com/sitemap.xml';
    const deps = makeDeps({
      [sm]: { body: URLSET(['https://example.com/no', 'https://example.com/404']) },
    });
    const pages = [
      p('https://example.com/no', { isIndexable: false }),
      p('https://example.com/404', { statusCode: 404 }),
    ];
    const r = await analyzeSitemap(sm, pages, deps);
    expect(r.nonIndexableInSitemap.sort()).toEqual([
      'https://example.com/404',
      'https://example.com/no',
    ]);
    expect(r.orphanFromSitemap).toEqual([]);
  });

  it('detects duplicate <loc> entries in same sitemap', async () => {
    const sm = 'https://example.com/sitemap.xml';
    const deps = makeDeps({
      [sm]: { body: URLSET(['https://example.com/a', 'https://example.com/a']) },
    });
    const r = await analyzeSitemap(sm, [p('https://example.com/a')], deps);
    expect(r.duplicateInSitemap).toEqual(['https://example.com/a']);
  });

  it('expands sitemap-index recursively', async () => {
    const root = 'https://example.com/sitemap-index.xml';
    const child1 = 'https://example.com/sitemap-1.xml';
    const child2 = 'https://example.com/sitemap-2.xml';
    const deps = makeDeps({
      [root]: { body: SITEMAPINDEX([child1, child2]) },
      [child1]: { body: URLSET(['https://example.com/a']) },
      [child2]: { body: URLSET(['https://example.com/b']) },
    });
    const r = await analyzeSitemap(root, [p('https://example.com/a'), p('https://example.com/b')], deps);
    expect(r.urlsInSitemap.sort()).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(r.fetchedSitemaps.sort()).toEqual([child1, child2, root].sort());
    expect(r.errors).toEqual([]);
  });

  it('handles gzipped sitemaps via .gz extension', async () => {
    const sm = 'https://example.com/sitemap.xml.gz';
    const gz = gzipSync(Buffer.from(URLSET(['https://example.com/a']), 'utf8'));
    const deps = makeDeps({
      [sm]: { body: gz, contentType: 'application/octet-stream' },
    });
    const r = await analyzeSitemap(sm, [p('https://example.com/a')], deps);
    expect(r.urlsInSitemap).toEqual(['https://example.com/a']);
    expect(r.errors).toEqual([]);
  });

  it('handles gzipped sitemaps detected by magic bytes', async () => {
    const sm = 'https://example.com/sitemap.xml';
    const gz = gzipSync(Buffer.from(URLSET(['https://example.com/x']), 'utf8'));
    const deps = makeDeps({ [sm]: { body: gz, contentType: 'application/xml' } });
    const r = await analyzeSitemap(sm, [], deps);
    expect(r.urlsInSitemap).toEqual(['https://example.com/x']);
  });

  it('records HTTP error for failed fetch', async () => {
    const sm = 'https://example.com/missing.xml';
    const deps = makeDeps({ [sm]: { body: '', status: 500 } });
    const r = await analyzeSitemap(sm, [], deps);
    expect(r.errors[0]).toMatch(/HTTP 500/);
    expect(r.urlsInSitemap).toEqual([]);
  });

  it('avoids re-fetching same sitemap (cycle guard)', async () => {
    let count = 0;
    const sm = 'https://example.com/sitemap.xml';
    const deps: AnalyzerDeps = {
      async fetch(url: string) {
        count++;
        if (url === sm) {
          // Sitemap-index that points to itself.
          return { status: 200, data: Buffer.from(SITEMAPINDEX([sm]), 'utf8'), contentType: 'application/xml' };
        }
        return { status: 404, data: Buffer.from(''), contentType: 'text/plain' };
      },
    };
    await analyzeSitemap(sm, [], deps);
    expect(count).toBe(1);
  });
});
