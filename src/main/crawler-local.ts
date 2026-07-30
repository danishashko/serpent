import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow, session } from 'electron';
import { PageData, LinkData, ImageData, CrawlConfig } from '../types/index';
import { SimpleCookieJar } from './crawl-filters';
import { simhash64 } from './simhash';

// Approximate pixel widths per character (Arial 13px, common browser default)
const AVG_CHAR_PX = 7.2;

// Cap response bodies so a crawled URL serving a huge file (video, archive,
// gzip bomb) can't buffer gigabytes into the main process.
const MAX_RESPONSE_BYTES = 25 * 1024 * 1024;

export const DEFAULT_USER_AGENT = 'Serpent/1.0 (SEO Crawler; +https://github.com/danishashko/serpent)';

/**
 * Basic-auth credentials belong to the host they were entered for. A same-host
 * http→https upgrade keeps them; any other host (or an https→http downgrade)
 * drops them, so a redirect off-site can't hand the password to a third party.
 */
export function isSameAuthScope(scopeUrl: string, targetUrl: string): boolean {
  try {
    const scope = new URL(scopeUrl);
    const target = new URL(targetUrl);
    if (scope.host !== target.host) return false;
    if (scope.protocol === target.protocol) return true;
    return scope.protocol === 'http:' && target.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Request headers for a crawl: UA, custom headers, basic auth, cookies.
 * `authScopeUrl` is the URL the credentials were issued for (defaults to `url`);
 * when following redirects, pass the originally requested URL.
 */
export function buildRequestHeaders(
  config: CrawlConfig,
  url: string,
  cookieJar?: SimpleCookieJar,
  authScopeUrl?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': config.userAgent?.trim() || DEFAULT_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };
  for (const h of config.customHeaders ?? []) {
    const name = h.name?.trim();
    if (name && h.value != null) headers[name] = h.value;
  }
  if (config.authUser && isSameAuthScope(authScopeUrl ?? url, url)) {
    headers['Authorization'] =
      'Basic ' + Buffer.from(`${config.authUser}:${config.authPass ?? ''}`).toString('base64');
  }
  const cookie = cookieJar?.getCookieHeader(url);
  if (cookie) headers['Cookie'] = cookie;
  return headers;
}

function estimatePixelWidth(text: string): number {
  return Math.round(text.length * AVG_CHAR_PX);
}

function normalizeUrlForComparison(url: string): string {
  try {
    const parsed = new URL(url);
    let path = parsed.pathname;
    // Strip trailing slash (except root "/")
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`;
  } catch {
    return url.toLowerCase().replace(/\/+$/, '');
  }
}

function isIndexable(statusCode: number | null, canonical: string | null, pageUrl: string, robotsMeta: string | null): boolean {
  if (!statusCode || statusCode < 200 || statusCode >= 300) return false;
  if (canonical) {
    // Resolve relative canonicals (e.g. "/path/") against the page URL before comparing
    let resolvedCanonical = canonical;
    try { resolvedCanonical = new URL(canonical, pageUrl).toString(); } catch { /* keep raw */ }
    if (normalizeUrlForComparison(resolvedCanonical) !== normalizeUrlForComparison(pageUrl)) return false;
  }
  if (robotsMeta && (robotsMeta.includes('noindex') || robotsMeta.includes('none'))) return false;
  return true;
}

function extractWordCount($: cheerio.CheerioAPI): number {
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  return bodyText.split(' ').filter(w => w.length > 0).length;
}

export interface CrawlResult {
  page: PageData;
  links: LinkData[];
  images: ImageData[];
  discoveredUrls: string[];
  redirectChain: { url: string; statusCode: number }[];
  hreflang: { hreflang: string; href: string }[];
  contentHash: string | null;
  customExtractions: { name: string; selector: string; value: string | null }[];
}

// --- JS rendering via hidden Electron BrowserWindow ---
// Reuses Electron's own Chromium — no extra binary needed.

// Electron allows a single onHeadersReceived listener per session, so register
// one global hook lazily and route main-frame response headers by webContentsId.
// This is how the JS-render path learns security headers (HSTS/CSP/etc.) that
// executeJavaScript cannot see.
const renderedHeaders = new Map<number, Record<string, string>>();

// Host scope of the Basic-auth credentials attached to each rendering window.
const renderAuthScopes = new Map<number, string>();
let headerHookInstalled = false;

function installHeaderHook(): void {
  if (headerHookInstalled) return;
  headerHookInstalled = true;
  try {
    // Chromium replays extraHeaders across redirects, so strip Basic auth once a
    // rendered navigation leaves the host the credentials were entered for.
    session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const scope = typeof details.webContentsId === 'number'
        ? renderAuthScopes.get(details.webContentsId)
        : undefined;
      if (scope && !isSameAuthScope(scope, details.url)) {
        const headers = { ...details.requestHeaders };
        for (const name of Object.keys(headers)) {
          if (name.toLowerCase() === 'authorization') delete headers[name];
        }
        callback({ requestHeaders: headers });
        return;
      }
      callback({});
    });
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      if (details.resourceType === 'mainFrame' && typeof details.webContentsId === 'number') {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(details.responseHeaders ?? {})) {
          flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        renderedHeaders.set(details.webContentsId, flat);
      }
      callback({});
    });
  } catch {
    // session unavailable (tests / early startup) — headers stay uncaptured
  }
}

async function fetchWithElectronRenderer(
  url: string,
  timeout: number,
  config: CrawlConfig
): Promise<{ html: string; statusCode: number; responseTimeMs: number; headers: Record<string, string> | null }> {
  const startTime = Date.now();
  let statusCode = 0;

  // SPA pages need a generous timeout — at least 15 s
  const effectiveTimeout = Math.max(timeout, 15000);

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1024,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      images: true, // keep images enabled — some SPAs depend on them
    },
  });

  // Prevent popups
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  installHeaderHook();
  const wcId = win.webContents.id;
  if (config.authUser) renderAuthScopes.set(wcId, url);

  try {
    // Phase 1: wait for the page to finish loading
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        // Capture HTTP status code of the main document navigation
        win.webContents.on('did-navigate', (_e, _navUrl, httpResponseCode) => {
          statusCode = httpResponseCode;
        });

        // Only treat main-frame failures as load errors
        win.webContents.on(
          'did-fail-load',
          (_e: Electron.Event, errorCode: number, errorDescription: string, _validatedURL: string, isMainFrame: boolean) => {
            if (isMainFrame) {
              console.error(`[JS-RENDER] Main frame failed: ${errorCode} ${errorDescription} for ${url}`);
              reject(new Error(`did-fail-load: ${errorCode} ${errorDescription}`));
            }
            // Sub-frame failures are ignored
          }
        );

        // UA + auth + custom headers apply to the rendered navigation too.
        // Cookies persist natively via the session's cookie store, so the
        // JS-render path gets session-cookie support for free.
        const loadOptions: Electron.LoadURLOptions = {
          userAgent: config.userAgent?.trim() || DEFAULT_USER_AGENT,
        };
        const extraHeaderLines: string[] = [];
        for (const h of config.customHeaders ?? []) {
          const name = h.name?.trim();
          if (name && h.value != null) extraHeaderLines.push(`${name}: ${h.value}`);
        }
        if (config.authUser) {
          extraHeaderLines.push(
            'Authorization: Basic ' + Buffer.from(`${config.authUser}:${config.authPass ?? ''}`).toString('base64')
          );
        }
        if (extraHeaderLines.length > 0) loadOptions.extraHeaders = extraHeaderLines.join('\n');

        win.webContents.loadURL(url, loadOptions)
          .then(() => {
            // loadURL resolves when did-finish-load fires → page + JS parsed
            resolve();
          })
          .catch((err: Error) => {
            console.error(`[JS-RENDER] loadURL rejected for ${url}:`, err.message);
            reject(err);
          });
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('js-render timeout (phase 1)')), effectiveTimeout)
      ),
    ]);

    // Phase 2: give the SPA time to render — poll until anchors appear or max wait
    const spaWait = Math.min(5000, effectiveTimeout - (Date.now() - startTime));
    const pollInterval = 300;
    let waited = 0;
    while (waited < spaWait) {
      const anchorCount = (await win.webContents.executeJavaScript(
        'document.querySelectorAll("a[href]").length'
      )) as number;
      if (anchorCount > 0) break;
      await new Promise(r => setTimeout(r, pollInterval));
      waited += pollInterval;
    }

    const html = (await win.webContents.executeJavaScript(
      'document.documentElement.outerHTML'
    )) as string;

    return { html, statusCode: statusCode || 200, responseTimeMs: Date.now() - startTime, headers: renderedHeaders.get(wcId) ?? null };
  } catch (err) {
    // Even on timeout/error, try to grab whatever HTML rendered so far
    console.error(`[JS-RENDER] Error for ${url}:`, (err as Error).message);
    try {
      const partialHtml = (await win.webContents.executeJavaScript(
        'document.documentElement.outerHTML'
      )) as string;
      if (partialHtml && partialHtml.length > 200) {
        return { html: partialHtml, statusCode: statusCode || 200, responseTimeMs: Date.now() - startTime, headers: renderedHeaders.get(wcId) ?? null };
      }
    } catch { /* window already destroyed or unreachable */ }
    return { html: '', statusCode: 0, responseTimeMs: Date.now() - startTime, headers: null };
  } finally {
    renderedHeaders.delete(wcId);
    renderAuthScopes.delete(wcId);
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function crawlPageLocal(
  url: string,
  crawlId: string,
  depth: number,
  config: CrawlConfig,
  baseOrigin: string,
  cookieJar?: SimpleCookieJar
): Promise<CrawlResult> {
  const startTime = Date.now();
  let statusCode: number | null = null;
  let contentType: string | null = null;
  let html = '';
  let responseTimeMs: number | null = null;
  let pageSizeBytes: number | null = null;

  let response: AxiosResponse | null = null;
  let responseHeaders: Record<string, unknown> | null = null;
  const redirectChain: { url: string; statusCode: number }[] = [];

  if (config.jsRender) {
    // --- Electron headless renderer ---
    try {
      const rendered = await fetchWithElectronRenderer(url, config.timeout || 10000, config);
      html = rendered.html;
      statusCode = rendered.statusCode;
      responseTimeMs = rendered.responseTimeMs;
      responseHeaders = rendered.headers;
      contentType = 'text/html';
      pageSizeBytes = Buffer.byteLength(html, 'utf8');
    } catch {
      responseTimeMs = Date.now() - startTime;
      statusCode = 0;
    }
  } else {
    // --- Standard HTTP fetch via axios, with manual redirect following ---
    try {
      let currentUrl = url;
      const maxHops = config.followRedirects ? 10 : 0;

      for (let hop = 0; hop <= maxHops; hop++) {
        const resp = await axios.get(currentUrl, {
          timeout: config.timeout || 10000,
          maxRedirects: 0,
          maxContentLength: MAX_RESPONSE_BYTES,
          maxBodyLength: MAX_RESPONSE_BYTES,
          headers: buildRequestHeaders(config, currentUrl, cookieJar, url),
          responseType: 'text',
          validateStatus: () => true, // Don't throw on 4xx/5xx
        });
        response = resp;
        cookieJar?.storeFromResponse(currentUrl, resp.headers['set-cookie']);

        const code = resp.status;
        const isRedirect = code >= 300 && code < 400 && resp.headers['location'];

        if (isRedirect && hop < maxHops) {
          const location = resp.headers['location'] as string;
          const nextUrl = new URL(location, currentUrl).toString();
          redirectChain.push({ url: currentUrl, statusCode: code });
          currentUrl = nextUrl;
        } else {
          // Final response (or non-redirect)
          if (redirectChain.length > 0) {
            // Record the last hop arriving at final URL
            redirectChain.push({ url: currentUrl, statusCode: code });
          }
          break;
        }
      }

      responseTimeMs = Date.now() - startTime;
      statusCode = response!.status;
      responseHeaders = response!.headers as Record<string, unknown>;
      contentType = response!.headers['content-type'] || null;
      html = response!.data as string;
      pageSizeBytes = Buffer.byteLength(html, 'utf8');
    } catch (err: unknown) {
      responseTimeMs = Date.now() - startTime;
      const axErr = err as { response?: AxiosResponse; code?: string };
      if (axErr.response) {
        statusCode = axErr.response.status;
        contentType = axErr.response.headers['content-type'] || null;
      } else {
        statusCode = 0; // Network error / timeout
      }
    }
  }

  const pageId = uuidv4();
  const links: LinkData[] = [];
  const images: ImageData[] = [];
  const discoveredUrls: string[] = [];

  // If the URL was redirected, record the redirect status code and skip content
  // parsing — the final destination's HTML belongs to a different URL.
  // The final URL will be enqueued for its own crawl via discoveredUrls.
  if (redirectChain.length > 0) {
    statusCode = redirectChain[0].statusCode;
    html = '';
    contentType = null;
    pageSizeBytes = 0;
    // Queue the final redirect destination for its own crawl if it's internal
    const finalUrl = redirectChain[redirectChain.length - 1].url;
    try {
      const finalParsed = new URL(finalUrl);
      if (finalParsed.origin === baseOrigin) {
        discoveredUrls.push(finalUrl);
      }
    } catch { /* skip invalid URLs */ }
  }

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

  // Security headers (from the axios response, or captured via the webRequest
  // hook on the JS-render path)
  const hasHSTS = !!responseHeaders?.['strict-transport-security'];
  const hasCSP = !!responseHeaders?.['content-security-policy'];
  const xFrameOptions: string | null = (responseHeaders?.['x-frame-options'] as string) ?? null;
  const xContentTypeOptions: string | null = (responseHeaders?.['x-content-type-options'] as string) ?? null;

  const isHTML = contentType && contentType.includes('text/html');

  if (html && isHTML) {
    const $ = cheerio.load(html);

    // Title
    if (config.extractTitles) {
      title = $('title').first().text().trim() || null;
      if (title) {
        titleLength = title.length;
        titlePixelWidth = estimatePixelWidth(title);
      }
    }

    // Meta description
    if (config.extractMeta) {
      metaDescription = $('meta[name="description"]').attr('content')?.trim() || null;
      if (metaDescription) {
        metaDescLength = metaDescription.length;
        metaDescPixelWidth = estimatePixelWidth(metaDescription);
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

    // Headings
    if (config.extractHeadings) {
      h1 = $('h1').first().text().trim() || null;
      h2 = $('h2').first().text().trim() || null;
      h1Count = $('h1').length;
      h2Count = $('h2').length;
      h1Length = h1 ? h1.length : null;
      h2Length = h2 ? h2.length : null;
    }

    // Canonical
    if (config.extractCanonicals) {
      const canonicalLink = $('link[rel="canonical"]').attr('href')?.trim() || null;
      // Also check HTTP header (via Link header if available)
      const linkHeader = response?.headers?.['link'] as string | undefined;
      if (linkHeader) {
        const match = linkHeader.match(/<([^>]+)>;\s*rel="canonical"/i);
        if (match) canonicalUrl = match[1];
      }
      if (!canonicalUrl && canonicalLink) canonicalUrl = canonicalLink;
      // Resolve relative canonicals (e.g. "/path/") against the page URL before comparing
      let resolvedCanonical: string | null = canonicalUrl;
      if (canonicalUrl) {
        try { resolvedCanonical = new URL(canonicalUrl, url).toString(); } catch { /* keep raw */ }
      }
      isCanonicalized = !!resolvedCanonical && normalizeUrlForComparison(resolvedCanonical) !== normalizeUrlForComparison(url);
    }

    // Word count + text ratio
    wordCount = extractWordCount($);
    const bodyTextLen = $('body').text().replace(/\s+/g, ' ').trim().length;
    textRatio = html.length > 0 ? Math.round((bodyTextLen / html.length) * 100 * 10) / 10 : null;

    // Links
    if (config.extractLinks) {
      $('a[href]').each((_i, el) => {
        const href = $(el).attr('href')?.trim();
        if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:') || href === '#') return;

        try {
          const resolved = new URL(href, url);
          // Strip hash
          resolved.hash = '';
          const targetUrl = resolved.toString();
          const isInternal = resolved.origin === baseOrigin;

          if (config.restrictToSubdomain) {
            // Only follow same-hostname links
            if (isInternal) discoveredUrls.push(targetUrl);
          } else {
            if (isInternal) discoveredUrls.push(targetUrl);
          }

          links.push({
            id: uuidv4(),
            crawlId,
            sourceUrl: url,
            targetUrl,
            isInternal,
            anchorText: $(el).text().trim() || null,
            relAttr: $(el).attr('rel') || null,
          });
        } catch {
          // Invalid URL — skip
        }
      });
    }

    // Images
    if (config.extractImages) {
      $('img').each((_i, el) => {
        const src = $(el).attr('src')?.trim();
        if (!src) return;
        try {
          const resolvedSrc = new URL(src, url).toString();
          const imgSrc = resolvedSrc;
          const ext = imgSrc.split('.').pop()?.split('?')[0]?.toLowerCase() ?? null;
          const format = ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'avif', 'ico', 'bmp', 'tiff'].includes(ext ?? '') ? ext : null;
          images.push({
            id: uuidv4(),
            crawlId,
            pageUrl: url,
            imageUrl: resolvedSrc,
            altText: $(el).attr('alt') ?? null,
            format,
            hasWidth: !!$(el).attr('width'),
            hasHeight: !!$(el).attr('height'),
            isLazy: $(el).attr('loading') === 'lazy',
          });
        } catch {
          // Skip invalid image URLs
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

    // Content hash (SHA-256 of normalized body text for duplicate detection)
    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    if (bodyText.length > 0) {
      contentHash = createHash('sha256').update(bodyText).digest('hex');
      simhash = simhash64(bodyText);
    }

    // Structured Data extraction (JSON-LD + Microdata)
    {
      const jsonLdBlocks: unknown[] = [];
      const schemaTypeSet = new Set<string>();
      const errors: string[] = [];

      // JSON-LD
      $('script[type="application/ld+json"]').each((_i, el) => {
        const raw = $(el).html();
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          jsonLdBlocks.push(parsed);
          // Extract @type (can be string or array)
          const extractTypes = (obj: Record<string, unknown>) => {
            if (obj['@type']) {
              const t = obj['@type'];
              if (Array.isArray(t)) t.forEach((v: string) => schemaTypeSet.add(v));
              else schemaTypeSet.add(t as string);
            }
            // Check @graph array
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

      // Microdata
      $('[itemscope]').each((_i, el) => {
        const itemtype = $(el).attr('itemtype')?.trim();
        if (itemtype) {
          // itemtype is usually a full URL like "https://schema.org/Article"
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
    isIndexable: isIndexable(statusCode, canonicalUrl, url, robotsMeta),
    responseTimeMs,
    pageSizeBytes,
    crawlDepth: depth,
    costUsd: 0, // Local is free
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
    hasHSTS,
    hasCSP,
    xFrameOptions,
    xContentTypeOptions,
    imageCount: images.length,
    linkScore: 0,
    simhash,
  };

  return { page, links, images, discoveredUrls, redirectChain, hreflang: hreflangEntries, contentHash, customExtractions: customExtractionResults };
}

export function detectJsHeavySite(html: string): boolean {
  if (!html || html.length > 5000) return false;
  const scriptTagCount = (html.match(/<script/gi) || []).length;
  const bodyContent = html.replace(/<[^>]+>/g, '').trim().length;
  return scriptTagCount > 3 && bodyContent < 200;
}
