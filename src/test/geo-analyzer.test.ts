import { describe, it, expect } from 'vitest';
import { analyzeGEOScore, analyzeGEOBatch } from '../main/geo-analyzer';
import { PageData, LinkData, ImageData } from '../types/index';

function makePage(overrides: Partial<PageData> = {}): PageData {
  return {
    id: 'page-1',
    crawlId: 'crawl-1',
    url: 'https://example.com/test',
    statusCode: 200,
    title: 'Test Page Title Here',
    titleLength: 20,
    metaDescription: 'A sufficient meta description that is long enough to score points for entity clarity assessment.',
    metaDescriptionLength: 95,
    h1: 'Main Heading',
    h2Count: 4,
    wordCount: 1000,
    internalLinks: 5,
    externalLinks: 3,
    imageCount: 3,
    hasStructuredData: true,
    schemaTypes: 'Article,Organization,BreadcrumbList',
    canonicalUrl: 'https://example.com/test',
    isIndexable: true,
    ogTitle: 'Test Page',
    ogDescription: 'OG description here',
    textRatio: 0.20,
    pageSizeBytes: 50000,
    responseTimeMs: 300,
    contentType: 'text/html',
    depth: 1,
    hasViewport: true,
    language: 'en',
    robotsDirectives: '',
    redirectChain: null,
    isSelfCanonical: true,
    crawledAt: new Date().toISOString(),
    // nullable fields
    metaRobots: null,
    hreflangTags: null,
    hasHreflang: false,
    httpScheme: 'https',
    ...overrides,
  } as PageData;
}

function makeLinks(sourceUrl: string, count: number, internal: boolean): LinkData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `link-${i}`,
    crawlId: 'crawl-1',
    sourceUrl,
    targetUrl: internal ? `https://example.com/page-${i}` : `https://external-${i}.com`,
    anchorText: `Link ${i}`,
    isInternal: internal,
    statusCode: 200,
    isFollowed: true,
    linkType: 'a' as const,
  })) as LinkData[];
}

function makeImages(count: number): ImageData[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `img-${i}`,
    crawlId: 'crawl-1',
    pageUrl: 'https://example.com/test',
    src: `https://example.com/img-${i}.webp`,
    altText: `Image ${i}`,
    hasWidth: true,
    hasHeight: true,
    isLazy: true,
    fileSize: 30000,
    format: 'webp',
  })) as ImageData[];
}

describe('GEO Analyzer', () => {
  describe('analyzeGEOScore', () => {
    it('returns high score for well-optimized page', () => {
      const page = makePage();
      const links = [...makeLinks(page.url, 4, false), ...makeLinks(page.url, 5, true)];
      const images = makeImages(3);

      const score = analyzeGEOScore({ page, links, images });

      expect(score.pageId).toBe('page-1');
      expect(score.crawlId).toBe('crawl-1');
      expect(score.overallScore).toBeGreaterThanOrEqual(70);
      expect(score.entityClarity).toBeGreaterThanOrEqual(70);
      expect(score.answerReadiness).toBeGreaterThanOrEqual(70);
      expect(score.citationSignals).toBeGreaterThanOrEqual(70);
      expect(score.structuredDataCompleteness).toBeGreaterThanOrEqual(70);
      expect(score.issues).toBeDefined();
      expect(score.analyzedAt).toBeDefined();
    });

    it('returns low score for poorly optimized page', () => {
      const page = makePage({
        h1: '',
        hasStructuredData: false,
        schemaTypes: '',
        ogTitle: '',
        ogDescription: '',
        metaDescription: '',
        canonicalUrl: '',
        isIndexable: false,
        wordCount: 50,
        h2Count: 0,
        imageCount: 0,
        textRatio: 0.02,
      });

      const score = analyzeGEOScore({ page, links: [], images: [] });

      expect(score.overallScore).toBeLessThanOrEqual(30);
      expect(score.entityClarity).toBeLessThanOrEqual(30);
      expect(score.issues.length).toBeGreaterThan(0);
    });

    it('scores entity clarity based on H1, schema, OG, meta, title', () => {
      const page = makePage({ h1: '', hasStructuredData: false, schemaTypes: '' });
      const score = analyzeGEOScore({ page, links: [], images: [] });

      expect(score.entityClarity).toBeLessThan(score.answerReadiness + 20);
      // Missing H1 and schema should generate issues
      const entityIssues = score.issues.filter(i => i.category === 'entity');
      expect(entityIssues.length).toBeGreaterThan(0);
    });

    it('scores answer readiness based on content depth', () => {
      // Thin content page
      const page = makePage({ wordCount: 50, h2Count: 0, imageCount: 0, textRatio: 0.01 });
      const score = analyzeGEOScore({ page, links: [], images: [] });

      expect(score.answerReadiness).toBeLessThanOrEqual(50);
      const answerIssues = score.issues.filter(i => i.category === 'answer');
      expect(answerIssues.length).toBeGreaterThan(0);
    });

    it('scores citation signals with canonical and external links', () => {
      const page = makePage({ canonicalUrl: '', isIndexable: false });
      const score = analyzeGEOScore({ page, links: [], images: [] });

      const citationIssues = score.issues.filter(i => i.category === 'citation');
      expect(citationIssues.length).toBeGreaterThan(0);
    });

    it('scores structured data completeness', () => {
      const page = makePage({ hasStructuredData: false, schemaTypes: '' });
      const score = analyzeGEOScore({ page, links: [], images: [] });

      expect(score.structuredDataCompleteness).toBe(0);
      const schemaIssues = score.issues.filter(i => i.category === 'schema');
      expect(schemaIssues.length).toBeGreaterThan(0);
    });

    it('overall score is clamped 0-100', () => {
      const page = makePage();
      const links = makeLinks(page.url, 5, false);
      const score = analyzeGEOScore({ page, links, images: makeImages(5) });
      expect(score.overallScore).toBeGreaterThanOrEqual(0);
      expect(score.overallScore).toBeLessThanOrEqual(100);
    });
  });

  describe('analyzeGEOBatch', () => {
    it('analyzes multiple pages', () => {
      const pages = [
        makePage({ id: 'p1', url: 'https://example.com/a' }),
        makePage({ id: 'p2', url: 'https://example.com/b' }),
      ];
      const links = makeLinks('https://example.com/a', 3, false);
      const images = makeImages(2);

      const scores = analyzeGEOBatch(pages, links, images);

      expect(scores).toHaveLength(2);
      expect(scores[0].pageId).toBe('p1');
      expect(scores[1].pageId).toBe('p2');
    });

    it('returns empty array for empty input', () => {
      const scores = analyzeGEOBatch([], [], []);
      expect(scores).toHaveLength(0);
    });

    it('filters links and images per page', () => {
      const pages = [makePage({ id: 'p1', url: 'https://example.com/a' })];
      const links = [
        ...makeLinks('https://example.com/a', 2, false),
        ...makeLinks('https://example.com/other', 3, false),
      ];
      const images = [
        ...makeImages(1).map(i => ({ ...i, pageUrl: 'https://example.com/a' })),
        ...makeImages(1).map(i => ({ ...i, id: 'other-img', pageUrl: 'https://example.com/other' })),
      ] as ImageData[];

      const scores = analyzeGEOBatch(pages, links, images);
      expect(scores).toHaveLength(1);
    });
  });
});
