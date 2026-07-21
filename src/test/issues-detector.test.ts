import { describe, it, expect } from 'vitest';
import { computeIssues, getCategories, categoryLabel } from '../renderer/lib/issues-detector';
import type { PageData } from '../types/index';

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

function findIssue(issues: ReturnType<typeof computeIssues>, id: string) {
  return issues.find((i) => i.id === id);
}

describe('issues-detector', () => {
  it('detects nothing on a clean page', () => {
    const issues = computeIssues([page({ url: 'https://example.com/clean' })]);
    expect(issues).toEqual([]);
  });

  it('flags 4xx and 5xx and 3xx', () => {
    const pages = [
      page({ url: 'https://example.com/a', statusCode: 404 }),
      page({ url: 'https://example.com/b', statusCode: 500 }),
      page({ url: 'https://example.com/c', statusCode: 301 }),
    ];
    const issues = computeIssues(pages);
    expect(findIssue(issues, 'client_error_4xx')?.affectedUrls).toEqual(['https://example.com/a']);
    expect(findIssue(issues, 'server_error_5xx')?.affectedUrls).toEqual(['https://example.com/b']);
    expect(findIssue(issues, 'redirect_3xx')?.affectedUrls).toEqual(['https://example.com/c']);
  });

  it('flags missing/long/short/pixel titles', () => {
    const issues = computeIssues([
      page({ url: 'https://example.com/m', title: '', titleLength: 0 }),
      page({ url: 'https://example.com/long', title: 'x'.repeat(80), titleLength: 80 }),
      page({ url: 'https://example.com/short', title: 'short', titleLength: 5 }),
      page({ url: 'https://example.com/px', titlePixelWidth: 700 }),
    ]);
    expect(findIssue(issues, 'missing_title')?.affectedUrls).toContain('https://example.com/m');
    expect(findIssue(issues, 'title_too_long')?.affectedUrls).toContain('https://example.com/long');
    expect(findIssue(issues, 'title_too_short')?.affectedUrls).toContain('https://example.com/short');
    expect(findIssue(issues, 'title_pixel_overflow')?.affectedUrls).toContain('https://example.com/px');
  });

  it('flags duplicate title / meta / h1 / content', () => {
    const pages = [
      page({ url: 'https://example.com/a', title: 'Same Title', metaDescription: 'Same Meta That Is Long Enough To Pass Lower Bound Check 12345', h1: 'Same H1', contentHash: 'dup' }),
      page({ url: 'https://example.com/b', title: 'Same Title', metaDescription: 'Same Meta That Is Long Enough To Pass Lower Bound Check 12345', h1: 'Same H1', contentHash: 'dup' }),
    ];
    const issues = computeIssues(pages);
    expect(findIssue(issues, 'duplicate_title')?.affectedUrls.length).toBe(2);
    expect(findIssue(issues, 'duplicate_meta_description')?.affectedUrls.length).toBe(2);
    expect(findIssue(issues, 'duplicate_h1')?.affectedUrls.length).toBe(2);
    expect(findIssue(issues, 'duplicate_content')?.affectedUrls.length).toBe(2);
  });

  it('flags missing/multiple/long h1, missing h2', () => {
    const issues = computeIssues([
      page({ url: 'https://example.com/no-h1', h1: '', h1Count: 0 }),
      page({ url: 'https://example.com/multi-h1', h1Count: 3 }),
      page({ url: 'https://example.com/long-h1', h1: 'x'.repeat(100), h1Length: 100 }),
      page({ url: 'https://example.com/no-h2', h2Count: 0 }),
    ]);
    expect(findIssue(issues, 'missing_h1')?.affectedUrls).toContain('https://example.com/no-h1');
    expect(findIssue(issues, 'multiple_h1')?.affectedUrls).toContain('https://example.com/multi-h1');
    expect(findIssue(issues, 'h1_too_long')?.affectedUrls).toContain('https://example.com/long-h1');
    expect(findIssue(issues, 'missing_h2')?.affectedUrls).toContain('https://example.com/no-h2');
  });

  it('flags canonicalised + missing canonical', () => {
    const issues = computeIssues([
      page({ url: 'https://example.com/can', isCanonicalized: true, isIndexable: false }),
      page({ url: 'https://example.com/nocan', canonicalUrl: null }),
    ]);
    expect(findIssue(issues, 'canonicalised')?.affectedUrls).toContain('https://example.com/can');
    expect(findIssue(issues, 'missing_canonical')?.affectedUrls).toContain('https://example.com/nocan');
  });

  it('flags noindex + nofollow directives', () => {
    const issues = computeIssues([
      page({ url: 'https://example.com/n', robotsDirectives: 'noindex, follow' }),
      page({ url: 'https://example.com/nf', robotsDirectives: 'index, nofollow' }),
    ]);
    expect(findIssue(issues, 'noindex')?.affectedUrls).toContain('https://example.com/n');
    expect(findIssue(issues, 'nofollow')?.affectedUrls).toContain('https://example.com/nf');
  });

  it('flags URL anomalies', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(120);
    const issues = computeIssues([
      page({ url: longUrl }),
      page({ url: 'https://example.com/AbC' }),
      page({ url: 'https://example.com/with_underscore' }),
    ]);
    expect(findIssue(issues, 'url_too_long')?.affectedUrls).toContain(longUrl);
    expect(findIssue(issues, 'url_uppercase')?.affectedUrls).toContain('https://example.com/AbC');
    expect(findIssue(issues, 'url_underscores')?.affectedUrls).toContain('https://example.com/with_underscore');
  });

  it('flags low word count + missing security headers', () => {
    const issues = computeIssues([
      page({ url: 'https://example.com/thin', wordCount: 50 }),
      page({ url: 'https://example.com/insecure', hasHSTS: false, hasCSP: false, xFrameOptions: null }),
    ]);
    expect(findIssue(issues, 'low_word_count')?.affectedUrls).toContain('https://example.com/thin');
    expect(findIssue(issues, 'missing_hsts')?.affectedUrls).toContain('https://example.com/insecure');
    expect(findIssue(issues, 'missing_csp')?.affectedUrls).toContain('https://example.com/insecure');
    expect(findIssue(issues, 'missing_x_frame')?.affectedUrls).toContain('https://example.com/insecure');
  });

  it('flags missing OG/Twitter, structured data, and link/image proxies', () => {
    const issues = computeIssues([
      page({ url: 'https://example.com/social', ogTitle: null, ogImage: null, twitterCard: null, hasStructuredData: false, schemaErrors: 'parse error' }),
      page({ url: 'https://example.com/orphan', linkScore: 1 }),
      page({ url: 'https://example.com/imgs', imageCount: 200 }),
    ]);
    expect(findIssue(issues, 'missing_og_title')?.affectedUrls).toContain('https://example.com/social');
    expect(findIssue(issues, 'missing_og_image')?.affectedUrls).toContain('https://example.com/social');
    expect(findIssue(issues, 'missing_twitter_card')?.affectedUrls).toContain('https://example.com/social');
    expect(findIssue(issues, 'missing_structured_data')?.affectedUrls).toContain('https://example.com/social');
    expect(findIssue(issues, 'schema_errors')?.affectedUrls).toContain('https://example.com/social');
    expect(findIssue(issues, 'low_link_score')?.affectedUrls).toContain('https://example.com/orphan');
    expect(findIssue(issues, 'high_image_count')?.affectedUrls).toContain('https://example.com/imgs');
  });

  it('getCategories + categoryLabel cover every category', () => {
    for (const c of getCategories()) {
      expect(typeof categoryLabel(c)).toBe('string');
      expect(categoryLabel(c).length).toBeGreaterThan(0);
    }
  });
});
