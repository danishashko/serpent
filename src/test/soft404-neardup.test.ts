import { describe, it, expect } from 'vitest';
import type { PageData } from '../types/index';
import { computeIssues, looksLikeSoft404 } from '../renderer/lib/issues-detector';
import { simhash64 } from '../main/simhash';

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

describe('soft_404 detector', () => {
  it('flags 200 pages whose title/H1 reads like an error page', () => {
    expect(looksLikeSoft404(page({ title: 'Page Not Found', wordCount: 40 }))).toBe(true);
    expect(looksLikeSoft404(page({ title: 'Oops', h1: '404 Error', wordCount: 20 }))).toBe(true);
    expect(looksLikeSoft404(page({ title: 'This page does not exist', wordCount: 12 }))).toBe(true);
  });

  it('does not flag real 404s, normal pages, or long articles about 404s', () => {
    expect(looksLikeSoft404(page({ statusCode: 404, title: 'Not Found', wordCount: 10 }))).toBe(false);
    expect(looksLikeSoft404(page({ title: 'Great products', wordCount: 40 }))).toBe(false);
    expect(looksLikeSoft404(page({ title: 'How to fix 404 errors', wordCount: 1500 }))).toBe(false);
  });

  it('surfaces through computeIssues as a critical response_codes issue', () => {
    const issues = computeIssues([
      page({ url: 'https://x.com/soft', title: 'Page Not Found', wordCount: 30 }),
      page({ url: 'https://x.com/fine' }),
    ]);
    const soft = issues.find(i => i.id === 'soft_404');
    expect(soft).toBeDefined();
    expect(soft!.severity).toBe('critical');
    expect(soft!.affectedUrls).toEqual(['https://x.com/soft']);
  });
});

describe('near_duplicate_content detector', () => {
  const baseText =
    'Industrial equipment maintenance requires disciplined scheduling and accurate spare parts inventory management across every facility. ' +
    'Predictive analytics reduce unplanned downtime by surfacing anomalies before failures occur in rotating machinery. ' +
    'Technicians should document each intervention so the maintenance history remains searchable and auditable for compliance teams. ' +
    'A modern CMMS platform centralizes work orders schedules and asset records in one place for the whole organization. ' +
    'Sensor data from vibration temperature and pressure probes streams into dashboards that highlight assets drifting from their baselines. ' +
    'Planners can then prioritize interventions by risk and cost rather than reacting to whichever machine failed most recently. ' +
    'Over time this discipline extends asset life reduces overtime spending and builds trust between operations and maintenance departments. ' +
    'Training programs should reinforce these habits so new technicians inherit the same standards from their first week on the floor.';
  const editedText = baseText.replace('rotating machinery', 'critical pumps');
  const otherText =
    'Chocolate cake recipes depend on quality cocoa fresh eggs and precise oven temperature control for the best results. ' +
    'Whisk the dry ingredients separately before folding them gently into the butter and sugar mixture until smooth. ' +
    'Bake for thirty five minutes then allow the layers to cool completely before spreading the ganache frosting. ' +
    'Decorate with fresh berries and a light dusting of powdered sugar just before serving your guests at the party. ' +
    'For extra moisture brush each cooled layer with simple syrup flavored with vanilla or a splash of espresso. ' +
    'Store any leftovers in an airtight container at room temperature where the cake stays soft for three days. ' +
    'A stand mixer makes the batter come together quickly but a sturdy whisk and patience work just as well. ' +
    'Serve generous slices with cold milk or hot coffee and watch the whole table go quiet for a minute.';

  it('groups highly similar pages and leaves distinct ones alone', () => {
    const issues = computeIssues([
      page({ url: 'https://x.com/a', simhash: simhash64(baseText), contentHash: 'ha' }),
      page({ url: 'https://x.com/b', simhash: simhash64(editedText), contentHash: 'hb' }),
      page({ url: 'https://x.com/c', simhash: simhash64(otherText), contentHash: 'hc' }),
    ]);
    const near = issues.find(i => i.id === 'near_duplicate_content');
    expect(near).toBeDefined();
    expect(near!.affectedUrls.sort()).toEqual(['https://x.com/a', 'https://x.com/b']);
  });

  it('excludes exact duplicates (already flagged) and pages without simhash', () => {
    const sh = simhash64(baseText);
    const issues = computeIssues([
      page({ url: 'https://x.com/a', simhash: sh, contentHash: 'same' }),
      page({ url: 'https://x.com/b', simhash: sh, contentHash: 'same' }),
      page({ url: 'https://x.com/c', simhash: null }),
    ]);
    expect(issues.find(i => i.id === 'near_duplicate_content')).toBeUndefined();
    const exact = issues.find(i => i.id === 'duplicate_content');
    expect(exact!.affectedUrls.sort()).toEqual(['https://x.com/a', 'https://x.com/b']);
  });
});
