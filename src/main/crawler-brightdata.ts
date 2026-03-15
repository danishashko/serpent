import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { CrawlConfig, PageData, LinkData, ImageData } from '../types/index';
import { CrawlResult } from './crawler-local';

const BD_ENDPOINT = 'https://api.brightdata.com/request';

export async function crawlPageBrightData(
  url: string,
  crawlId: string,
  depth: number,
  config: CrawlConfig,
  baseOrigin: string,
  apiKey: string,
  zone: string = 'web_unlocker1'
): Promise<CrawlResult & { bytesDownloaded: number }> {
  const startTime = Date.now();

  let statusCode: number | null = null;
  let contentType: string | null = null;
  let html = '';
  let responseTimeMs: number | null = null;
  let pageSizeBytes = 0;

  try {
    const response = await axios.post(
      BD_ENDPOINT,
      {
        zone,
        url,
        format: 'raw',
        render_js: true,
        country: 'us',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
        responseType: 'text',
        validateStatus: () => true,
      }
    );

    responseTimeMs = Date.now() - startTime;
    statusCode = response.status;
    contentType = response.headers['content-type'] || 'text/html';
    html = response.data as string;
    pageSizeBytes = Buffer.byteLength(html, 'utf8');
  } catch (err: unknown) {
    responseTimeMs = Date.now() - startTime;
    statusCode = 0;
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
    }

    if (config.extractHeadings) {
      h1 = $('h1').first().text().trim() || null;
      h2 = $('h2').first().text().trim() || null;
    }

    if (config.extractCanonicals) {
      canonicalUrl = $('link[rel="canonical"]').attr('href')?.trim() || null;
      isCanonicalized = !!canonicalUrl && canonicalUrl !== url;
    }

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    wordCount = bodyText.split(' ').filter(w => w.length > 0).length;

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
          });
        } catch {
          // skip
        }
      });
    }

    if (config.extractImages) {
      $('img').each((_i, el) => {
        const src = $(el).attr('src')?.trim();
        if (!src) return;
        try {
          images.push({
            id: uuidv4(),
            crawlId,
            pageUrl: url,
            imageUrl: new URL(src, url).toString(),
            altText: $(el).attr('alt') ?? null,
          });
        } catch {
          // skip
        }
      });
    }
  }

  const isIndexable = (() => {
    if (!statusCode || statusCode >= 400) return false;
    if (robotsMeta && (robotsMeta.includes('noindex') || robotsMeta.includes('none'))) return false;
    return true;
  })();

  const costUsd = calculateBrightDataCost();

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
  };

  return { page, links, images, discoveredUrls, bytesDownloaded: pageSizeBytes };
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
