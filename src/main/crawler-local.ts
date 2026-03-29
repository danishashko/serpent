import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { BrowserWindow } from 'electron';
import { PageData, LinkData, ImageData, CrawlConfig } from '../types/index';

// Approximate pixel widths per character (Arial 13px, common browser default)
const AVG_CHAR_PX = 7.2;

function estimatePixelWidth(text: string): number {
  return Math.round(text.length * AVG_CHAR_PX);
}

function isIndexable(statusCode: number | null, canonical: string | null, pageUrl: string, robotsMeta: string | null): boolean {
  if (!statusCode || statusCode >= 400) return false;
  if (canonical && canonical !== pageUrl && !canonical.startsWith('/')) return false;
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

async function fetchWithElectronRenderer(
  url: string,
  timeout: number
): Promise<{ html: string; statusCode: number; responseTimeMs: number }> {
  const startTime = Date.now();
  let statusCode = 0;
  let loadFinished = false;

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1024,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      images: false, // skip image downloads for speed
    },
  });

  // Prevent popups
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  try {
    await Promise.race([
      new Promise<void>((resolve) => {
        // Capture HTTP status code of the main document navigation
        win.webContents.on('did-navigate', (_e, _navUrl, httpResponseCode) => {
          statusCode = httpResponseCode;
        });
        // Network error / blocked
        win.webContents.on('did-fail-load', () => {
          resolve();
        });
        // Page finished loading — give JS 800 ms to execute before we grab HTML
        win.webContents.on('did-stop-loading', () => {
          if (!loadFinished) {
            loadFinished = true;
            setTimeout(resolve, 800);
          }
        });
        win.webContents.loadURL(url).catch(() => resolve());
      }),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('js-render timeout')), timeout)
      ),
    ]);

    const html = (await win.webContents.executeJavaScript(
      'document.documentElement.outerHTML'
    )) as string;

    return { html, statusCode: statusCode || 200, responseTimeMs: Date.now() - startTime };
  } catch {
    return { html: '', statusCode: 0, responseTimeMs: Date.now() - startTime };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

export async function crawlPageLocal(
  url: string,
  crawlId: string,
  depth: number,
  config: CrawlConfig,
  baseOrigin: string
): Promise<CrawlResult> {
  const startTime = Date.now();
  let statusCode: number | null = null;
  let contentType: string | null = null;
  let html = '';
  let responseTimeMs: number | null = null;
  let pageSizeBytes: number | null = null;

  let response: AxiosResponse | null = null;
  const redirectChain: { url: string; statusCode: number }[] = [];

  if (config.jsRender) {
    // --- Electron headless renderer ---
    try {
      const rendered = await fetchWithElectronRenderer(url, config.timeout || 10000);
      html = rendered.html;
      statusCode = rendered.statusCode;
      responseTimeMs = rendered.responseTimeMs;
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
        response = await axios.get(currentUrl, {
          timeout: config.timeout || 10000,
          maxRedirects: 0,
          headers: {
            'User-Agent': 'GhostFrog/1.0 (SEO Crawler; +https://github.com/ghostfrog)',
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          responseType: 'text',
          validateStatus: () => true, // Don't throw on 4xx/5xx
        });

        const code = response.status;
        const isRedirect = code >= 300 && code < 400 && response.headers['location'];

        if (isRedirect && hop < maxHops) {
          const location = response.headers['location'] as string;
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
  const hreflangEntries: { hreflang: string; href: string }[] = [];
  let contentHash: string | null = null;
  const customExtractionResults: { name: string; selector: string; value: string | null }[] = [];

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
    }

    // Headings
    if (config.extractHeadings) {
      h1 = $('h1').first().text().trim() || null;
      h2 = $('h2').first().text().trim() || null;
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
      isCanonicalized = !!canonicalUrl && canonicalUrl !== url;
    }

    // Word count
    wordCount = extractWordCount($);

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
          images.push({
            id: uuidv4(),
            crawlId,
            pageUrl: url,
            imageUrl: resolvedSrc,
            altText: $(el).attr('alt') ?? null,
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
  };

  return { page, links, images, discoveredUrls, redirectChain, hreflang: hreflangEntries, contentHash, customExtractions: customExtractionResults };
}

export function detectJsHeavySite(html: string): boolean {
  if (!html || html.length > 5000) return false;
  const scriptTagCount = (html.match(/<script/gi) || []).length;
  const bodyContent = html.replace(/<[^>]+>/g, '').trim().length;
  return scriptTagCount > 3 && bodyContent < 200;
}
