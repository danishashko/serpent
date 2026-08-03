import axios from 'axios';
import * as cheerio from 'cheerio';
import { chromium, Browser } from 'playwright-core';
import { URL } from 'url';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { CrawlConfig, PageData, LinkData, ImageData } from '../types/index';
import { CrawlResult } from './crawler-local';
import { simhash64 } from './simhash';
import { extractUncrawlableLinks } from './uncrawlable-links';

function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

const BD_ENDPOINT = 'https://api.brightdata.com/request';

// Cache zone password to avoid hitting BD API on every request
const zonePasswordCache = new Map<string, { password: string; expiresAt: number }>();
const ZONE_PASSWORD_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getZonePassword(apiKey: string, zone: string): Promise<string | null> {
  const cached = zonePasswordCache.get(zone);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.password;
  }
  try {
    const res = await axios.get(`https://api.brightdata.com/zone?zone=${zone}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (res.status === 200 && res.data?.password?.[0]) {
      const password = res.data.password[0];
      zonePasswordCache.set(zone, { password, expiresAt: Date.now() + ZONE_PASSWORD_TTL_MS });
      return password;
    }
  } catch {
    // ignore
  }
  return null;
}

export async function crawlPageBrightData(
  url: string,
  crawlId: string,
  depth: number,
  config: CrawlConfig,
  baseOrigin: string,
  apiKey: string,
  zone: string = 'web_unlocker1',
  bdCustomerId?: string | null
): Promise<CrawlResult & { bytesDownloaded: number }> {
  const startTime = Date.now();

  let statusCode: number | null = null;
  let contentType: string | null = null;
  let html = '';
  let responseTimeMs: number | null = null;
  let pageSizeBytes = 0;
  const redirectChain: { url: string; statusCode: number }[] = [];

  // ── Proxy mode: when customer ID is provided, route through BD proxy
  //    with maxRedirects:0 so we capture the real 301/302 chain.
  // ──────────────────────────────────────────────────────────────────────
  if (bdCustomerId) {
    try {
      const proxyPass = await getZonePassword(apiKey, zone);
      if (!proxyPass) {
        throw new Error('Failed to fetch zone password for proxy mode');
      }
      const proxyUser = `brd-customer-${bdCustomerId}-zone-${zone}`;
      let currentUrl = url;
      const maxHops = config.followRedirects ? 10 : 0;

      for (let hop = 0; hop <= maxHops; hop++) {
        const resp = await axios.get(currentUrl, {
          proxy: {
            protocol: 'http',
            host: 'brd.superproxy.io',
            port: 22225,
            auth: { username: proxyUser, password: proxyPass },
          },
          timeout: config.timeout || 30000,
          maxRedirects: 0,
          headers: {
            'User-Agent': 'Serpent/1.0 (SEO Crawler; +https://github.com/danishashko/serpent)',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          responseType: 'text',
          validateStatus: () => true,
        });

        const code = resp.status;
        const location = resp.headers['location'] as string | undefined;
        const bdRedirectTo = resp.headers['x-unblocker-redirected-to'] as string | undefined;
        const isRedirect = code >= 300 && code < 400 && location;

        if (isRedirect && hop < maxHops) {
          const nextUrl = new URL(location, currentUrl).toString();
          redirectChain.push({ url: currentUrl, statusCode: code });
          currentUrl = nextUrl;
        } else {
          if (redirectChain.length > 0) {
            redirectChain.push({ url: currentUrl, statusCode: code });
          }
          statusCode = code;
          contentType = resp.headers['content-type'] || 'text/html';
          html = resp.data as string;
          pageSizeBytes = Buffer.byteLength(html, 'utf8');

          // BD follows redirects internally — if x-unblocker-redirected-to is present,
          // the original URL was a redirect even though we see 200.
          if (bdRedirectTo && redirectChain.length === 0) {
            redirectChain.push({ url, statusCode: 301 });
            redirectChain.push({ url: bdRedirectTo, statusCode: 200 });
          }
          break;
        }
      }

      responseTimeMs = Date.now() - startTime;
    } catch (err: unknown) {
      responseTimeMs = Date.now() - startTime;
      statusCode = 0;
    }
  } else {
    // ── REST API mode (detects redirects via x-unblocker-redirected-to header) ─
    try {
      const response = await axios.post(
        BD_ENDPOINT,
        {
          zone,
          url,
          format: 'json',
          country: 'us',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 30000,
          responseType: 'json',
          validateStatus: () => true,
        }
      );

      responseTimeMs = Date.now() - startTime;

      if (response.status === 200 && response.data && typeof response.data === 'object') {
        const data = response.data as { status_code?: number; headers?: Record<string, string>; body?: string };
        statusCode = data.status_code ?? response.status;
        contentType = data.headers?.['content-type'] || 'text/html';
        html = data.body ?? '';
        pageSizeBytes = Buffer.byteLength(html, 'utf8');

        // BD follows redirects internally. If x-unblocker-redirected-to is present,
        // record the redirect chain even though status_code is 200.
        const bdRedirectTo = data.headers?.['x-unblocker-redirected-to'];
        if (bdRedirectTo) {
          redirectChain.push({ url, statusCode: 301 });
          redirectChain.push({ url: bdRedirectTo, statusCode: 200 });
        }
      } else {
        statusCode = response.status;
        html = '';
        pageSizeBytes = 0;
      }
    } catch (err: unknown) {
      responseTimeMs = Date.now() - startTime;
      statusCode = 0;
    }
  }

  const result = buildResultFromHtml(html, url, crawlId, depth, config, baseOrigin, {
    statusCode: redirectChain.length > 0 ? redirectChain[0].statusCode : statusCode,
    contentType,
    responseTimeMs,
    pageSizeBytes,
    costUsd: calculateBrightDataCost(),
  });

  // Inject redirect chain
  if (redirectChain.length > 0) {
    result.redirectChain = redirectChain;
  }

  return result;
}

interface ParseMeta {
  statusCode: number | null;
  contentType: string | null;
  responseTimeMs: number | null;
  pageSizeBytes: number;
  costUsd: number;
}

/**
 * Shared HTML → SEO result parser. Used by both the Web Unlocker (raw HTML)
 * and the Browser API (JS-rendered HTML) crawlers so extraction stays identical
 * regardless of how the markup was fetched.
 */
function buildResultFromHtml(
  html: string,
  url: string,
  crawlId: string,
  depth: number,
  config: CrawlConfig,
  baseOrigin: string,
  meta: ParseMeta
): CrawlResult & { bytesDownloaded: number } {
  const { statusCode, contentType, responseTimeMs, pageSizeBytes } = meta;
  const pageId = uuidv4();
  const links: LinkData[] = [];
  const images: ImageData[] = [];
  const discoveredUrls: string[] = [];
  let uncrawlableOutlinks = 0;

  let title: string | null = null;
  let titleLength: number | null = null;
  let titlePixelWidth: number | null = null;
  let metaDescription: string | null = null;
  let metaDescLength: number | null = null;
  let metaDescPixelWidth: number | null = null;
  let h1: string | null = null;
  let h2: string | null = null;
  let wordCount: number | null = null;
  let canonicalUrl: string | null = null;
  let isCanonicalized = false;
  let robotsMeta: string | null = null;
  let metaKeywords: string | null = null;
  let h1Count = 0;
  let h2Count = 0;
  let h1Length: number | null = null;
  let h2Length: number | null = null;
  let textRatio: number | null = null;
  const hreflangEntries: { hreflang: string; href: string }[] = [];
  let contentHash: string | null = null;
  let simhash: string | null = null;
  const customExtractionResults: { name: string; selector: string; value: string | null }[] = [];
  // OG / Twitter Card
  let ogTitle: string | null = null;
  let ogDescription: string | null = null;
  let ogImage: string | null = null;
  let ogType: string | null = null;
  let twitterCard: string | null = null;
  let twitterTitle: string | null = null;
  let twitterDescription: string | null = null;
  let twitterImage: string | null = null;
  // Structured Data
  let schemaTypes: string | null = null;
  let schemaJson: string | null = null;
  let schemaErrors: string | null = null;
  let hasStructuredData = false;

  if (html) {
    const $ = cheerio.load(html);
    const AVG_CHAR_PX = 7.2;

    if (config.extractTitles) {
      title = $('title').first().text().trim() || null;
      if (title) {
        titleLength = title.length;
        titlePixelWidth = Math.round(title.length * AVG_CHAR_PX);
      }
    }

    if (config.extractMeta) {
      metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;
      if (metaDescription) {
        metaDescLength = metaDescription.length;
        metaDescPixelWidth = Math.round(metaDescription.length * AVG_CHAR_PX);
      }
      robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() || null;
      metaKeywords = $('meta[name="keywords"]').attr('content')?.trim() || null;
    }

    // Open Graph meta tags
    ogTitle = $('meta[property="og:title"]').attr('content')?.trim() || null;
    ogDescription = $('meta[property="og:description"]').attr('content')?.trim() || null;
    ogImage = $('meta[property="og:image"]').attr('content')?.trim() || null;
    ogType = $('meta[property="og:type"]').attr('content')?.trim() || null;

    // Twitter Card meta tags
    twitterCard = $('meta[name="twitter:card"]').attr('content')?.trim() || null;
    twitterTitle = $('meta[name="twitter:title"]').attr('content')?.trim() || null;
    twitterDescription = $('meta[name="twitter:description"]').attr('content')?.trim() || null;
    twitterImage = $('meta[name="twitter:image"]').attr('content')?.trim() || null;

    if (config.extractHeadings) {
      h1 = $('h1').first().text().trim() || null;
      h2 = $('h2').first().text().trim() || null;
      h1Count = $('h1').length;
      h2Count = $('h2').length;
      h1Length = h1 ? h1.length : null;
      h2Length = h2 ? h2.length : null;
    }

    if (config.extractCanonicals) {
      canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null;
      isCanonicalized = !!canonicalUrl && normalizeUrlForComparison(canonicalUrl!) !== normalizeUrlForComparison(url);
    }

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    wordCount = bodyText.split(' ').filter(w => w.length > 0).length;
    textRatio = html.length > 0 ? Math.round((bodyText.length / html.length) * 100 * 10) / 10 : null;

    if (config.extractLinks) {
      $('a[href]').each((_i, el) => {
        const href = $(el).attr('href')?.trim();
        if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href === '#') return;
        try {
          const resolved = new URL(href, url);
          resolved.hash = '';
          const targetUrl = resolved.toString();
          const isInternal = resolved.origin === baseOrigin;
          if (isInternal) discoveredUrls.push(targetUrl);
          links.push({
            id: uuidv4(),
            crawlId,
            sourceUrl: url,
            targetUrl,
            isInternal,
            anchorText: $(el).text().trim() || null,
            relAttr: $(el).attr('rel') || null,
            crawlability: 'crawlable',
            uncrawlableReason: null,
          });
        } catch {
          // skip
        }
      });

      // Reported only — never added to discoveredUrls.
      const uncrawlable = extractUncrawlableLinks($, crawlId, url, baseOrigin);
      links.push(...uncrawlable);
      uncrawlableOutlinks = uncrawlable.filter(l => l.isInternal).length;
    }

    if (config.extractImages) {
      $('img').each((_i, el) => {
        const src = $(el).attr('src')?.trim();
        if (!src) return;
        try {
          const imgSrc = new URL(src, url).toString();
          const ext = imgSrc.split('.').pop()?.split('?')[0]?.toLowerCase() ?? '';
          images.push({
            id: uuidv4(),
            crawlId,
            pageUrl: url,
            imageUrl: imgSrc,
            altText: $(el).attr('alt') ?? null,
            format: ['jpg','jpeg','png','gif','webp','avif','svg','bmp','ico'].includes(ext) ? ext : null,
            hasWidth: !!$(el).attr('width'),
            hasHeight: !!$(el).attr('height'),
            isLazy: $(el).attr('loading') === 'lazy',
          });
        } catch {
          // skip
        }
      });
    }

    // Hreflang
    if (config.extractHreflang) {
      $('link[rel="alternate"][hreflang]').each((_i, el) => {
        const lang = $(el).attr('hreflang')?.trim();
        const href = $(el).attr('href')?.trim();
        if (lang && href) {
          try {
            const resolvedHref = new URL(href, url).toString();
            hreflangEntries.push({ hreflang: lang, href: resolvedHref });
          } catch {
            hreflangEntries.push({ hreflang: lang, href: href });
          }
        }
      });
    }

    // Content hash (SHA-256 of normalized body text)
    if (bodyText.length > 0) {
      contentHash = createHash('sha256').update(bodyText).digest('hex');
      simhash = simhash64(bodyText);
    }

    // Structured Data extraction (JSON-LD + Microdata)
    {
      const jsonLdBlocks: unknown[] = [];
      const schemaTypeSet = new Set<string>();
      const errors: string[] = [];

      $('script[type="application/ld+json"]').each((_i, el) => {
        const raw = $(el).html();
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          jsonLdBlocks.push(parsed);
          const extractTypes = (obj: Record<string, unknown>) => {
            if (obj['@type']) {
              const t = obj['@type'];
              if (Array.isArray(t)) t.forEach((v: string) => schemaTypeSet.add(v));
              else schemaTypeSet.add(t as string);
            }
            if (Array.isArray(obj['@graph'])) {
              for (const item of obj['@graph']) {
                if (item && typeof item === 'object') extractTypes(item as Record<string, unknown>);
              }
            }
          };
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === 'object') extractTypes(item as Record<string, unknown>);
            }
          } else if (parsed && typeof parsed === 'object') {
            extractTypes(parsed as Record<string, unknown>);
          }
        } catch (e) {
          errors.push(`JSON-LD parse error: ${(e as Error).message}`);
        }
      });

      $('[itemscope]').each((_i, el) => {
        const itemtype = $(el).attr('itemtype')?.trim();
        if (itemtype) {
          const typeName = itemtype.split('/').pop();
          if (typeName) schemaTypeSet.add(typeName);
        }
      });

      if (schemaTypeSet.size > 0 || jsonLdBlocks.length > 0) {
        hasStructuredData = true;
        schemaTypes = schemaTypeSet.size > 0 ? Array.from(schemaTypeSet).join(',') : null;
        schemaJson = jsonLdBlocks.length > 0 ? JSON.stringify(jsonLdBlocks) : null;
      }
      if (errors.length > 0) {
        schemaErrors = errors.join('; ');
      }
    }

    // Custom CSS extraction
    if (config.customExtractions && config.customExtractions.length > 0) {
      for (const rule of config.customExtractions) {
        try {
          const matched = $(rule.selector);
          const value = matched.length > 0 ? matched.first().text().trim() || matched.first().attr('content') || null : null;
          customExtractionResults.push({ name: rule.name, selector: rule.selector, value });
        } catch {
          customExtractionResults.push({ name: rule.name, selector: rule.selector, value: null });
        }
      }
    }
  }

  const isIndexable = (() => {
    if (!statusCode || statusCode < 200 || statusCode >= 300) return false;
    if (canonicalUrl && !canonicalUrl.startsWith('/')) {
      if (normalizeUrlForComparison(canonicalUrl) !== normalizeUrlForComparison(url)) return false;
    }
    if (robotsMeta && (robotsMeta.includes('noindex') || robotsMeta.includes('none'))) return false;
    return true;
  })();

  const costUsd = meta.costUsd;

  const page: PageData = {
    id: pageId,
    crawlId,
    url,
    statusCode,
    contentType,
    title,
    titleLength,
    titlePixelWidth,
    metaDescription,
    metaDescLength,
    metaDescPixelWidth,
    h1,
    h2,
    wordCount,
    canonicalUrl,
    isCanonicalized,
    isIndexable,
    responseTimeMs,
    pageSizeBytes,
    crawlDepth: depth,
    costUsd,
    createdAt: new Date().toISOString(),
    contentHash,
    h1Length,
    h2Length,
    h1Count,
    h2Count,
    robotsDirectives: robotsMeta,
    metaKeywords,
    textRatio,
    ogTitle,
    ogDescription,
    ogImage,
    ogType,
    twitterCard,
    twitterTitle,
    twitterDescription,
    twitterImage,
    schemaTypes,
    schemaJson,
    schemaErrors,
    hasStructuredData,
    hasHSTS: false,
    hasCSP: false,
    xFrameOptions: null,
    xContentTypeOptions: null,
    imageCount: images.length,
    linkScore: 0,
    simhash,
    uncrawlableOutlinks,
  };

  return { page, links, images, discoveredUrls, redirectChain: [], hreflang: hreflangEntries, contentHash, customExtractions: customExtractionResults, bytesDownloaded: pageSizeBytes };
}

/** Bright Data Web Unlocker CPM pricing: $1 per 1,000 requests */
export function calculateBrightDataCost(): number {
  return 0.001; // $0.001 per request (CPM model)
}

export async function testBrightDataConnection(apiKey: string, zone: string): Promise<boolean> {
  try {
    const response = await axios.post(
      BD_ENDPOINT,
      { zone, url: 'https://lumtest.com/myip.json', format: 'json' },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
    return response.status === 200;
  } catch {
    return false;
  }
}

const BD_BROWSER_HOST = 'brd.superproxy.io:9222';

/**
 * Bright Data Browser API (Scraping Browser) cost estimate.
 * Browser API bills per GB of traffic (~$8/GB). We approximate per page from
 * the rendered HTML size, with a small floor so blocked/empty pages still
 * register a non-zero spend.
 */
export function calculateBrightDataBrowserCost(bytesDownloaded: number): number {
  const GB = 1024 * 1024 * 1024;
  const PRICE_PER_GB = 8.0;
  const est = (bytesDownloaded / GB) * PRICE_PER_GB;
  return Math.max(est, 0.002);
}

/**
 * Crawl a single page through Bright Data's Browser API (Scraping Browser).
 * Connects to a remote headful Chromium over CDP, fully renders JS/SPA content,
 * then reuses the shared parser. `auth` is the zone "USER:PASS" string.
 */
export async function crawlPageBrightDataBrowser(
  url: string,
  crawlId: string,
  depth: number,
  config: CrawlConfig,
  baseOrigin: string,
  auth: string
): Promise<CrawlResult & { bytesDownloaded: number }> {
  const startTime = Date.now();
  const endpoint = `wss://${auth}@${BD_BROWSER_HOST}`;

  let statusCode: number | null = null;
  let contentType: string | null = null;
  let html = '';
  let responseTimeMs: number | null = null;
  let browser: Browser | null = null;

  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 60000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    statusCode = response?.status() ?? null;
    if (response) {
      const headers = await response.allHeaders();
      contentType = headers['content-type'] ?? 'text/html';
    }
    html = await page.content();
    responseTimeMs = Date.now() - startTime;
  } catch {
    responseTimeMs = Date.now() - startTime;
    statusCode = statusCode ?? 0;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }

  const pageSizeBytes = Buffer.byteLength(html, 'utf8');
  return buildResultFromHtml(html, url, crawlId, depth, config, baseOrigin, {
    statusCode,
    contentType,
    responseTimeMs,
    pageSizeBytes,
    costUsd: calculateBrightDataBrowserCost(pageSizeBytes),
  });
}

/** Validate Browser API credentials by opening a remote session and loading a page. */
export async function testBrightDataBrowserConnection(auth: string): Promise<boolean> {
  if (!auth || !auth.includes(':')) return false;
  const endpoint = `wss://${auth}@${BD_BROWSER_HOST}`;
  let browser: Browser | null = null;
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 30000 });
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.goto('https://example.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    return true;
  } catch {
    return false;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        /* ignore */
      }
    }
  }
}
