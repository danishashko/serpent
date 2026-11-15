/**
 * Link health: the post-crawl pass that turns "this target is broken" into
 * per-page counters, and the issue detectors that read them.
 *
 * Runs against the real database module (in-memory) — the counters are SQL
 * plus a migration, and both have to hold. Network is never touched: the
 * prober and the sitemap fetcher are injected.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  insertCrawl,
  insertPage,
  insertLinks,
  insertImages,
  getPagesByCrawl,
  getImagesByCrawl,
  getImagesMissingAlt,
  getLinkHealthSummary,
  recomputeLinkHealth,
  setPagesInSitemap,
  updateLinkStatusCodes,
  updateImageStatusCodes,
} from '../main/database';
import { runPostCrawlChecks, getPostCrawlStage } from '../main/link-health';
import { probeUrlStatuses, isPrivateHost, STATUS_UNREACHABLE } from '../main/external-link-checker';
import type { ProbeResult } from '../main/external-link-checker';
import { discoverSitemapUrls } from '../main/sitemap-analyzer';
import type { AnalyzerDeps } from '../main/sitemap-analyzer';
import { computeIssues, getCategories, issueTargets } from '../renderer/lib/issues-detector';
import { isMissingAlt, isGoneStatus } from '../types/index';
import type { CrawlRecord, ImageData, LinkData, LinkHealthSummary, PageData } from '../types/index';

const CRAWL = 'c1';
const SITE = 'https://example.com';

function page(over: Partial<PageData> = {}): PageData {
  return {
    id: 'id-' + (over.url ?? 'x'),
    crawlId: CRAWL,
    url: over.url ?? `${SITE}/`,
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
    canonicalUrl: over.url ?? `${SITE}/`,
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
    ogImage: `${SITE}/og.png`,
    ogType: 'website',
    twitterCard: 'summary',
    twitterTitle: 'TW',
    twitterDescription: 'TW',
    twitterImage: `${SITE}/tw.png`,
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
    uncrawlableOutlinks: 0,
    a11yScore: 100,
    a11yCritical: 0,
    a11ySerious: 0,
    a11yViolations: null,
    ...over,
  };
}

let seq = 0;
function link(source: string, target: string, isInternal = true): LinkData {
  return { id: `l${seq++}`, crawlId: CRAWL, sourceUrl: source, targetUrl: target, isInternal, anchorText: 'a', relAttr: null };
}
function image(pageUrl: string, imageUrl: string, altText: string | null = 'alt'): ImageData {
  return { id: `i${seq++}`, crawlId: CRAWL, pageUrl, imageUrl, altText, format: 'png', hasWidth: true, hasHeight: true, isLazy: false };
}

function seedCrawl(config: Record<string, unknown> = { mode: 'spider' }, startUrl = `${SITE}/`): void {
  const crawl: CrawlRecord = {
    id: CRAWL, mode: 'local', startUrl, startTime: new Date().toISOString(), endTime: null,
    status: 'completed', configJson: JSON.stringify(config), totalUrls: 0, completedUrls: 0,
    totalSpendUsd: 0, locked: false,
  };
  insertCrawl(crawl);
}

function byUrl(): Map<string, PageData> {
  return new Map(getPagesByCrawl(CRAWL).map((p) => [p.url, p]));
}

function probeStub(statuses: Record<string, number>): typeof probeUrlStatuses {
  return async (urls): Promise<ProbeResult> => {
    const list = [...urls];
    const map = new Map<string, number>();
    for (const u of list) if (u in statuses) map.set(u, statuses[u]);
    return { statuses: map, total: list.length, checked: map.size, truncated: false };
  };
}

function sitemapDeps(files: Record<string, string>): AnalyzerDeps {
  return {
    async fetch(url: string) {
      const body = files[url];
      if (body == null) return { status: 404, data: Buffer.from('not found'), contentType: 'text/html' };
      return { status: 200, data: Buffer.from(body), contentType: 'application/xml' };
    },
  };
}

beforeEach(() => {
  initDatabase(':memory:');
  seq = 0;
});

describe('isMissingAlt', () => {
  it('treats an absent alt as missing and an empty alt as decorative', () => {
    expect(isMissingAlt(null)).toBe(true);
    expect(isMissingAlt(undefined)).toBe(true);
    expect(isMissingAlt('')).toBe(false); // alt="" — decorative, valid
    expect(isMissingAlt('   ')).toBe(true); // neither empty nor descriptive
    expect(isMissingAlt('A red bicycle')).toBe(false);
  });

  it('the missing-alt SQL export agrees with the helper', () => {
    seedCrawl();
    insertImages([
      image(`${SITE}/`, `${SITE}/none.png`, null),
      image(`${SITE}/`, `${SITE}/decorative.png`, ''),
      image(`${SITE}/`, `${SITE}/blank.png`, '  '),
      image(`${SITE}/`, `${SITE}/good.png`, 'A red bicycle'),
    ]);
    const urls = getImagesMissingAlt(CRAWL).map((i) => i.imageUrl).sort();
    expect(urls).toEqual([`${SITE}/blank.png`, `${SITE}/none.png`]);
  });
});

describe('isGoneStatus', () => {
  it('counts only statuses that mean the target no longer exists', () => {
    expect(isGoneStatus(404)).toBe(true);
    expect(isGoneStatus(410)).toBe(true);
    expect(isGoneStatus(0)).toBe(true);
    // A third-party server refusing a bot is not a dead link.
    for (const s of [200, 301, 401, 403, 429, 500, 503, 999]) expect(isGoneStatus(s)).toBe(false);
    expect(isGoneStatus(null)).toBe(false);
  });
});

describe('recomputeLinkHealth', () => {
  it('counts distinct broken and redirecting internal targets per source page', () => {
    seedCrawl();
    for (const p of [
      page({ url: `${SITE}/` }),
      page({ url: `${SITE}/gone`, statusCode: 404 }),
      page({ url: `${SITE}/boom`, statusCode: 500 }),
      page({ url: `${SITE}/dead`, statusCode: 0 }),
      page({ url: `${SITE}/old`, statusCode: 301 }),
      page({ url: `${SITE}/fine` }),
    ]) insertPage(p);
    insertLinks([
      link(`${SITE}/`, `${SITE}/gone`),
      link(`${SITE}/`, `${SITE}/gone`), // header + footer: one target, counted once
      link(`${SITE}/`, `${SITE}/boom`),
      link(`${SITE}/`, `${SITE}/dead`),
      link(`${SITE}/`, `${SITE}/old`),
      link(`${SITE}/`, `${SITE}/fine`),
      link(`${SITE}/`, `${SITE}/never-crawled`), // beyond the URL cap: unknown, not broken
      link(`${SITE}/fine`, `${SITE}/old`),
    ]);

    const totals = recomputeLinkHealth(CRAWL);
    const pages = byUrl();
    expect(pages.get(`${SITE}/`)?.brokenOutlinks).toBe(3);
    expect(pages.get(`${SITE}/`)?.redirectOutlinks).toBe(1);
    expect(pages.get(`${SITE}/fine`)?.brokenOutlinks).toBe(0);
    expect(pages.get(`${SITE}/fine`)?.redirectOutlinks).toBe(1);
    expect(totals.pagesWithBrokenOutlinks).toBe(1);
    expect(totals.pagesWithRedirectOutlinks).toBe(2);
  });

  it('counts an external link as broken only when the target is gone', () => {
    seedCrawl();
    insertPage(page({ url: `${SITE}/` }));
    insertLinks([
      link(`${SITE}/`, 'https://a.test/404', false),
      link(`${SITE}/`, 'https://b.test/410', false),
      link(`${SITE}/`, 'https://dead-host.test/', false),
      link(`${SITE}/`, 'https://waf.test/403', false),
      link(`${SITE}/`, 'https://busy.test/503', false),
      link(`${SITE}/`, 'https://ok.test/', false),
      link(`${SITE}/`, 'https://unchecked.test/', false),
    ]);
    updateLinkStatusCodes(CRAWL, new Map([
      ['https://a.test/404', 404],
      ['https://b.test/410', 410],
      ['https://dead-host.test/', STATUS_UNREACHABLE],
      ['https://waf.test/403', 403],
      ['https://busy.test/503', 503],
      ['https://ok.test/', 200],
    ]));
    recomputeLinkHealth(CRAWL);
    expect(byUrl().get(`${SITE}/`)?.brokenExternalOutlinks).toBe(3);
  });

  it('counts a broken image on 404/410 only, and resets on recompute', () => {
    seedCrawl();
    insertPage(page({ url: `${SITE}/` }));
    insertImages([
      image(`${SITE}/`, `${SITE}/a.png`),
      image(`${SITE}/`, `${SITE}/b.png`),
      image(`${SITE}/`, `${SITE}/c.png`),
      image(`${SITE}/`, `${SITE}/d.png`),
    ]);
    updateImageStatusCodes(CRAWL, new Map([
      [`${SITE}/a.png`, 404],
      [`${SITE}/b.png`, 403], // CDN refusing the probe
      [`${SITE}/c.png`, STATUS_UNREACHABLE],
      [`${SITE}/d.png`, 200],
    ]));
    recomputeLinkHealth(CRAWL);
    expect(byUrl().get(`${SITE}/`)?.brokenImages).toBe(1);
    expect(getImagesByCrawl(CRAWL).find((i) => i.imageUrl === `${SITE}/a.png`)?.statusCode).toBe(404);

    // The image is fixed and re-checked: the counter must fall back to 0.
    updateImageStatusCodes(CRAWL, new Map([[`${SITE}/a.png`, 200]]));
    recomputeLinkHealth(CRAWL);
    expect(byUrl().get(`${SITE}/`)?.brokenImages).toBe(0);
  });
});

describe('setPagesInSitemap', () => {
  it('flags pages on the sitemap origin and leaves other origins unaudited', () => {
    seedCrawl();
    insertPage(page({ url: `${SITE}/in` }));
    insertPage(page({ url: `${SITE}/out` }));
    insertPage(page({ url: 'https://other.test/x' }));
    setPagesInSitemap(CRAWL, new Set([`${SITE}/in`]), SITE);
    const pages = byUrl();
    expect(pages.get(`${SITE}/in`)?.inSitemap).toBeTruthy();
    expect(pages.get(`${SITE}/out`)?.inSitemap).toBe(0);
    expect(pages.get('https://other.test/x')?.inSitemap).toBeNull();
  });

  it('a crawl that never had a sitemap audit reads as unaudited', () => {
    seedCrawl();
    insertPage(page({ url: `${SITE}/` }));
    expect(byUrl().get(`${SITE}/`)?.inSitemap).toBeNull();
  });
});

describe('probeUrlStatuses', () => {
  it('skips non-http and private targets unless private hosts are allowed', async () => {
    const asked: string[] = [];
    const fetchStatus = async (u: string): Promise<number> => { asked.push(u); return 200; };
    const urls = ['https://public.test/', 'http://192.168.1.1/admin', 'http://localhost:3000/', 'http://169.254.169.254/latest', 'mailto:a@b.c', 'not a url'];

    const res = await probeUrlStatuses(urls, { fetchStatus });
    expect(asked).toEqual(['https://public.test/']);
    expect(res.total).toBe(1);

    asked.length = 0;
    await probeUrlStatuses(urls, { fetchStatus, allowPrivateHosts: true });
    expect(asked.sort()).toEqual(['http://169.254.169.254/latest', 'http://192.168.1.1/admin', 'http://localhost:3000/', 'https://public.test/'].sort());
  });

  it('isPrivateHost covers loopback, RFC-1918, link-local and metadata hosts', () => {
    for (const h of ['localhost', '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.0.1', '169.254.169.254', 'metadata.google.internal']) {
      expect(isPrivateHost(h)).toBe(true);
    }
    for (const h of ['example.com', '172.32.0.1', '8.8.8.8', '11.0.0.1']) expect(isPrivateHost(h)).toBe(false);
  });

  it('dedupes, honours maxUrls and reports truncation', async () => {
    const asked: string[] = [];
    const urls = ['https://a.test/', 'https://a.test/', 'https://b.test/', 'https://c.test/'];
    const res = await probeUrlStatuses(urls, { maxUrls: 2, fetchStatus: async (u) => { asked.push(u); return 200; } });
    expect(asked.length).toBe(2);
    expect(res.total).toBe(3);
    expect(res.checked).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it('leaves out targets that gave no answer', async () => {
    const res = await probeUrlStatuses(['https://a.test/', 'https://timeout.test/'], {
      fetchStatus: async (u) => (u.includes('timeout') ? null : 404),
    });
    expect([...res.statuses.entries()]).toEqual([['https://a.test/', 404]]);
  });

  it('discards unreachable results when most of the batch is unreachable (local network down)', async () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://site${i}.test/`);
    const offline = await probeUrlStatuses(urls, { fetchStatus: async () => STATUS_UNREACHABLE });
    expect(offline.statuses.size).toBe(0);

    // One dead host among many live ones is a real finding and is kept.
    const mostlyUp = await probeUrlStatuses(urls, {
      fetchStatus: async (u) => (u === 'https://site3.test/' ? STATUS_UNREACHABLE : 200),
    });
    expect(mostlyUp.statuses.get('https://site3.test/')).toBe(STATUS_UNREACHABLE);
    expect(mostlyUp.statuses.size).toBe(20);
  });

  it('spaces request starts by minIntervalMs', async () => {
    const starts: number[] = [];
    await probeUrlStatuses(['https://a.test/1', 'https://a.test/2', 'https://a.test/3'], {
      minIntervalMs: 40,
      fetchStatus: async () => { starts.push(Date.now()); return 200; },
    });
    expect(starts[2] - starts[0]).toBeGreaterThanOrEqual(70);
  });
});

describe('discoverSitemapUrls', () => {
  it('reads Sitemap: lines from robots.txt, resolving relative values', async () => {
    const deps = sitemapDeps({
      [`${SITE}/robots.txt`]: 'User-agent: *\nDisallow: /private\nSitemap: https://example.com/sitemap-a.xml\nsitemap: /sitemap-b.xml\n',
    });
    expect(await discoverSitemapUrls(SITE, deps)).toEqual([`${SITE}/sitemap-a.xml`, `${SITE}/sitemap-b.xml`]);
  });

  it('falls back to /sitemap.xml when robots.txt names none', async () => {
    const deps = sitemapDeps({
      [`${SITE}/robots.txt`]: 'User-agent: *\nDisallow:\n',
      [`${SITE}/sitemap.xml`]: '<?xml version="1.0"?><urlset><url><loc>https://example.com/</loc></url></urlset>',
    });
    expect(await discoverSitemapUrls(SITE, deps)).toEqual([`${SITE}/sitemap.xml`]);
  });

  it('does not mistake a soft-404 HTML page for a sitemap', async () => {
    const deps = sitemapDeps({ [`${SITE}/sitemap.xml`]: '<!doctype html><html><body>Page not found</body></html>' });
    expect(await discoverSitemapUrls(SITE, deps)).toEqual([]);
  });
});

describe('runPostCrawlChecks', () => {
  function seedSite(): void {
    for (const p of [
      page({ url: `${SITE}/` }),
      page({ url: `${SITE}/about` }),
      page({ url: `${SITE}/old`, statusCode: 301, isIndexable: false }),
      page({ url: `${SITE}/noindex`, isIndexable: false, robotsDirectives: 'noindex' }),
      page({ url: `${SITE}/unlisted` }),
    ]) insertPage(p);
    insertLinks([
      link(`${SITE}/`, `${SITE}/old`),
      link(`${SITE}/`, 'https://partner.test/gone', false),
      link(`${SITE}/about`, 'https://partner.test/ok', false),
    ]);
    insertImages([
      image(`${SITE}/about`, `${SITE}/img/missing.png`),
      image(`${SITE}/about`, `${SITE}/img/ok.png`),
    ]);
  }

  const SITEMAP_FILES = {
    [`${SITE}/robots.txt`]: `Sitemap: ${SITE}/sitemap.xml\n`,
    [`${SITE}/sitemap.xml`]:
      `<urlset><url><loc>${SITE}/</loc></url><url><loc>${SITE}/about</loc></url>` +
      `<url><loc>${SITE}/old</loc></url><url><loc>${SITE}/noindex</loc></url>` +
      `<url><loc>${SITE}/not-crawled</loc></url></urlset>`,
  };

  it('fills every counter, flags pages against the sitemap and stores a summary', async () => {
    seedCrawl();
    seedSite();
    const stages: string[] = [];
    const summary = await runPostCrawlChecks(CRAWL, {
      probe: probeStub({ 'https://partner.test/gone': 404, 'https://partner.test/ok': 200, [`${SITE}/img/missing.png`]: 404, [`${SITE}/img/ok.png`]: 200 }),
      sitemapDeps: sitemapDeps(SITEMAP_FILES),
      onStage: (s) => stages.push(s),
    });

    expect(stages).toEqual(['internal_links', 'external_links', 'images', 'sitemap']);
    expect(getPostCrawlStage(CRAWL)).toBeNull();

    const pages = byUrl();
    expect(pages.get(`${SITE}/`)?.redirectOutlinks).toBe(1);
    expect(pages.get(`${SITE}/`)?.brokenExternalOutlinks).toBe(1);
    expect(pages.get(`${SITE}/about`)?.brokenExternalOutlinks).toBe(0);
    expect(pages.get(`${SITE}/about`)?.brokenImages).toBe(1);
    expect(pages.get(`${SITE}/unlisted`)?.inSitemap).toBe(0);
    expect(pages.get(`${SITE}/about`)?.inSitemap).toBeTruthy();

    expect(summary.state).toBe('done');
    expect(summary.externalLinks).toEqual({ total: 2, checked: 2, truncated: false });
    expect(summary.images).toEqual({ total: 2, checked: 2, truncated: false });
    expect(summary.sitemap).toMatchObject({ found: true, urlsInSitemap: 5, orphanFromSitemap: 1, notInSitemap: 1, nonIndexableInSitemap: 2 });
    expect(getLinkHealthSummary<LinkHealthSummary>(CRAWL)?.state).toBe('done');

    // The detectors read exactly what the pass wrote.
    const issues = new Map(computeIssues(getPagesByCrawl(CRAWL)).map((i) => [i.id, i.affectedUrls]));
    expect(issues.get('links_to_redirects')).toEqual([`${SITE}/`]);
    expect(issues.get('broken_external_links')).toEqual([`${SITE}/`]);
    expect(issues.get('broken_images')).toEqual([`${SITE}/about`]);
    expect(issues.get('broken_internal_links')).toBeUndefined();
    expect(issues.get('non_indexable_in_sitemap')?.sort()).toEqual([`${SITE}/noindex`, `${SITE}/old`]);
    expect(issues.get('not_in_sitemap')).toEqual([`${SITE}/unlisted`]);
  });

  it('raises no sitemap issue when the site publishes no sitemap', async () => {
    seedCrawl();
    seedSite();
    const summary = await runPostCrawlChecks(CRAWL, { probe: probeStub({}), sitemapDeps: sitemapDeps({}) });
    expect(summary.sitemap?.found).toBe(false);
    const ids = computeIssues(getPagesByCrawl(CRAWL)).map((i) => i.id);
    expect(ids).not.toContain('not_in_sitemap');
    expect(ids).not.toContain('non_indexable_in_sitemap');
  });

  it('skips the sitemap audit for a list-mode crawl', async () => {
    seedCrawl({ mode: 'list' });
    seedSite();
    const summary = await runPostCrawlChecks(CRAWL, { probe: probeStub({}), sitemapDeps: sitemapDeps(SITEMAP_FILES) });
    expect(summary.sitemap).toBeNull();
    expect(byUrl().get(`${SITE}/unlisted`)?.inSitemap).toBeNull();
  });

  it('only probes private targets when the crawled site itself is private', async () => {
    const seen: Array<boolean | undefined> = [];
    const spy: typeof probeUrlStatuses = async (urls, opts) => {
      seen.push(opts?.allowPrivateHosts);
      return { statuses: new Map(), total: [...urls].length, checked: 0, truncated: false };
    };
    seedCrawl();
    await runPostCrawlChecks(CRAWL, { probe: spy, sitemapDeps: sitemapDeps({}) });
    expect(seen).toEqual([false, false]);

    initDatabase(':memory:');
    seen.length = 0;
    seedCrawl({ mode: 'spider' }, 'http://localhost:3000/');
    await runPostCrawlChecks(CRAWL, { probe: spy, sitemapDeps: sitemapDeps({}) });
    expect(seen).toEqual([true, true]);
  });

  it('paces the image stage by the crawl rate limit', async () => {
    const intervals: Array<number | undefined> = [];
    const spy: typeof probeUrlStatuses = async (urls, opts) => {
      intervals.push(opts?.minIntervalMs);
      return { statuses: new Map(), total: [...urls].length, checked: 0, truncated: false };
    };
    seedCrawl({ mode: 'spider', requestsPerSecond: 2 });
    await runPostCrawlChecks(CRAWL, { probe: spy, sitemapDeps: sitemapDeps({}) });
    // external links go to many hosts (no pacing); images go to the crawled host.
    expect(intervals).toEqual([undefined, 500]);
  });
});

describe('issueTargets', () => {
  const links: LinkData[] = [
    { ...link(`${SITE}/`, `${SITE}/gone`), statusCode: 404 },
    { ...link(`${SITE}/`, `${SITE}/gone`), statusCode: 404 }, // repeated link, listed once
    { ...link(`${SITE}/`, `${SITE}/old`), statusCode: 301 },
    { ...link(`${SITE}/`, `${SITE}/fine`), statusCode: 200 },
    { ...link(`${SITE}/`, 'https://x.test/dead', false), statusCode: 0 },
    { ...link(`${SITE}/`, 'https://x.test/waf', false), statusCode: 403 },
    { ...link(`${SITE}/`, 'https://x.test/unchecked', false) },
  ];
  const images: ImageData[] = [
    { ...image(`${SITE}/`, `${SITE}/a.png`), statusCode: 404 },
    { ...image(`${SITE}/`, `${SITE}/b.png`), statusCode: 403 },
  ];

  it('names the offending targets for each link-health issue', () => {
    expect(issueTargets('broken_internal_links', links, images).get(`${SITE}/`)).toEqual([{ url: `${SITE}/gone`, status: 404 }]);
    expect(issueTargets('links_to_redirects', links, images).get(`${SITE}/`)).toEqual([{ url: `${SITE}/old`, status: 301 }]);
    expect(issueTargets('broken_external_links', links, images).get(`${SITE}/`)).toEqual([{ url: 'https://x.test/dead', status: 0 }]);
    expect(issueTargets('broken_images', links, images).get(`${SITE}/`)).toEqual([{ url: `${SITE}/a.png`, status: 404 }]);
  });

  it('returns nothing for issues that have no target', () => {
    expect(issueTargets('missing_title', links, images).size).toBe(0);
  });
});

describe('link-health detectors', () => {
  it('stay silent on a page the pass has not touched', () => {
    const ids = computeIssues([page({ url: `${SITE}/clean` })]).map((i) => i.id);
    expect(ids).toEqual([]);
  });

  it('are wired into the Issues tab category allow-list', () => {
    // An issue whose category is missing from getCategories() is silently dropped.
    expect(getCategories()).toContain('sitemaps');
    const issues = computeIssues([page({ url: `${SITE}/a`, brokenOutlinks: 2, inSitemap: false })]);
    for (const i of issues) expect(getCategories()).toContain(i.category);
    expect(issues.map((i) => i.id).sort()).toEqual(['broken_internal_links', 'not_in_sitemap']);
  });

  it('does not ask a PDF to be in the sitemap', () => {
    const pdf = page({ url: `${SITE}/doc.pdf`, contentType: 'application/pdf', inSitemap: false });
    expect(computeIssues([pdf]).map((i) => i.id)).not.toContain('not_in_sitemap');
  });
});
