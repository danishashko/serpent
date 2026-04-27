// Sitemap analyzer.
//
// Fetches a sitemap (or sitemap-index) over HTTP, expands child sitemaps
// recursively, supports .xml.gz, and returns a coverage diff against a list of
// crawled URLs (passed as PageData[]).
//
// Parsing uses regex on <loc> elements. We deliberately avoid adding a heavy
// XML dependency: real-world sitemaps are flat lists of <url><loc>…</loc></url>
// or <sitemap><loc>…</loc></sitemap> entries.

import axios from 'axios';
import { gunzipSync } from 'zlib';
import { URL } from 'url';
import type { PageData, SitemapAnalysisResult } from '../types/index';

const MAX_DEPTH = 5;            // sitemap-index recursion guard
const MAX_FETCHES = 50;         // total HTTP calls per analyze request

export interface AnalyzerDeps {
  // Injectable HTTP getter — main code uses axios; tests can stub.
  fetch: (url: string) => Promise<{ status: number; data: Buffer; contentType: string }>;
}

export const defaultDeps: AnalyzerDeps = {
  async fetch(url: string) {
    const resp = await axios.get(url, {
      timeout: 15_000,
      responseType: 'arraybuffer',
      validateStatus: (s) => s < 600,
    });
    const ct = String(resp.headers['content-type'] || '').toLowerCase();
    return { status: resp.status, data: Buffer.from(resp.data), contentType: ct };
  },
};

export async function analyzeSitemap(
  sitemapUrl: string,
  crawledPages: PageData[],
  deps: AnalyzerDeps = defaultDeps,
): Promise<SitemapAnalysisResult> {
  const errors: string[] = [];
  const fetched: string[] = [];
  const urlCounts = new Map<string, number>();
  const visitedSitemaps = new Set<string>();

  let fetchCount = 0;
  async function process(url: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) {
      errors.push(`Max sitemap-index depth (${MAX_DEPTH}) exceeded at ${url}`);
      return;
    }
    if (fetchCount >= MAX_FETCHES) {
      errors.push(`Max sitemap fetches (${MAX_FETCHES}) reached`);
      return;
    }
    if (visitedSitemaps.has(url)) return;
    visitedSitemaps.add(url);
    fetchCount++;

    let body: string;
    try {
      const resp = await deps.fetch(url);
      if (resp.status >= 400) {
        errors.push(`HTTP ${resp.status} fetching ${url}`);
        return;
      }
      let data: Buffer = resp.data;
      // Gunzip if .gz extension or gzip content-type or magic bytes.
      const isGzip =
        url.toLowerCase().endsWith('.gz') ||
        resp.contentType.includes('gzip') ||
        (data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b);
      if (isGzip) {
        try { data = gunzipSync(data); } catch (e) {
          errors.push(`Failed to gunzip ${url}: ${(e as Error).message}`);
          return;
        }
      }
      body = data.toString('utf8');
    } catch (e) {
      errors.push(`Fetch failed for ${url}: ${(e as Error).message}`);
      return;
    }

    fetched.push(url);

    // Detect sitemap-index vs urlset.
    if (/<sitemapindex[\s>]/i.test(body)) {
      const childLocs = extractLocs(body);
      for (const child of childLocs) {
        await process(child, depth + 1);
      }
      return;
    }

    const locs = extractLocs(body);
    for (const u of locs) {
      const norm = normaliseUrl(u);
      if (!norm) continue;
      urlCounts.set(norm, (urlCounts.get(norm) ?? 0) + 1);
    }
  }

  await process(sitemapUrl, 0);

  // Build sets for diff.
  const sitemapUrls = new Set(urlCounts.keys());
  const crawledByUrl = new Map<string, PageData>();
  for (const p of crawledPages) {
    const n = normaliseUrl(p.url);
    if (n) crawledByUrl.set(n, p);
  }

  const notInSitemap: string[] = [];
  const orphanFromSitemap: string[] = [];
  const nonIndexableInSitemap: string[] = [];
  const duplicateInSitemap: string[] = [];

  for (const [u, count] of urlCounts) {
    if (count > 1) duplicateInSitemap.push(u);
    const page = crawledByUrl.get(u);
    if (!page) {
      orphanFromSitemap.push(u);
    } else if (!page.isIndexable || (page.statusCode != null && page.statusCode >= 400)) {
      nonIndexableInSitemap.push(u);
    }
  }

  for (const [u, p] of crawledByUrl) {
    if (p.isIndexable && p.statusCode === 200 && !sitemapUrls.has(u)) {
      notInSitemap.push(u);
    }
  }

  return {
    sitemapUrl,
    fetchedSitemaps: fetched,
    urlsInSitemap: Array.from(sitemapUrls).sort(),
    notInSitemap: notInSitemap.sort(),
    orphanFromSitemap: orphanFromSitemap.sort(),
    nonIndexableInSitemap: nonIndexableInSitemap.sort(),
    duplicateInSitemap: duplicateInSitemap.sort(),
    errors,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

const LOC_RE = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

export function extractLocs(xml: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  LOC_RE.lastIndex = 0;
  while ((m = LOC_RE.exec(xml)) !== null) {
    out.push(decodeXmlEntities(m[1].trim()));
  }
  return out;
}

function normaliseUrl(u: string): string | null {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
