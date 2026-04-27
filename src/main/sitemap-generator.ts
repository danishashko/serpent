// XML sitemap generator. Builds sitemap.xml (and a sitemap-index.xml when the
// crawl has > MAX_URLS_PER_FILE indexable URLs) from the persisted PageData.
//
// Spec reference: https://www.sitemaps.org/protocol.html
//   - Max 50,000 URLs per file
//   - Max 50 MB uncompressed per file
//
// We only emit URLs that are:
//   - same-origin as the supplied origin
//   - HTTP 200
//   - isIndexable === true (no noindex / canonicalised away)
//   - not duplicates (dedupe by URL)

import { URL } from 'url';
import type { PageData, SitemapGenerateOptions } from '../types/index';

const MAX_URLS_PER_FILE = 50_000;

export interface GeneratedSitemap {
  filename: string;
  xml: string;
  urlCount: number;
}

export interface SitemapBundle {
  files: GeneratedSitemap[];
  index: GeneratedSitemap | null; // present when files.length > 1
  totalUrls: number;
}

export function generateSitemap(pages: PageData[], opts: SitemapGenerateOptions): SitemapBundle {
  const origin = stripTrailingSlash(opts.origin);
  const eligible = filterEligible(pages, origin);
  const files: GeneratedSitemap[] = [];

  if (eligible.length === 0) {
    files.push({
      filename: 'sitemap.xml',
      xml: emptyUrlSet(),
      urlCount: 0,
    });
    return { files, index: null, totalUrls: 0 };
  }

  const chunks = chunk(eligible, MAX_URLS_PER_FILE);
  if (chunks.length === 1) {
    files.push({
      filename: 'sitemap.xml',
      xml: renderUrlSet(chunks[0], opts),
      urlCount: chunks[0].length,
    });
    return { files, index: null, totalUrls: eligible.length };
  }

  // Multi-file: emit sitemap-1.xml … sitemap-N.xml + sitemap-index.xml
  chunks.forEach((c, i) => {
    files.push({
      filename: `sitemap-${i + 1}.xml`,
      xml: renderUrlSet(c, opts),
      urlCount: c.length,
    });
  });
  const index: GeneratedSitemap = {
    filename: 'sitemap-index.xml',
    xml: renderSitemapIndex(files.map((f) => `${origin}/${f.filename}`)),
    urlCount: files.length,
  };
  return { files, index, totalUrls: eligible.length };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function filterEligible(pages: PageData[], origin: string): PageData[] {
  const seen = new Set<string>();
  const out: PageData[] = [];
  for (const p of pages) {
    if (!p.url) continue;
    let parsed: URL;
    try { parsed = new URL(p.url); } catch { continue; }
    if (`${parsed.protocol}//${parsed.host}` !== origin) continue;
    if (p.statusCode !== 200) continue;
    if (!p.isIndexable) continue;
    const norm = parsed.toString();
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(p);
  }
  // Stable order: by URL ascending.
  out.sort((a, b) => a.url.localeCompare(b.url));
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function renderUrlSet(pages: PageData[], opts: SitemapGenerateOptions): string {
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const p of pages) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(p.url)}</loc>`);
    const lastmod = formatLastmod(p.createdAt);
    if (lastmod) lines.push(`    <lastmod>${lastmod}</lastmod>`);
    if (opts.defaultChangefreq) lines.push(`    <changefreq>${opts.defaultChangefreq}</changefreq>`);
    if (typeof opts.defaultPriority === 'number') {
      const pr = Math.max(0, Math.min(1, opts.defaultPriority));
      lines.push(`    <priority>${pr.toFixed(1)}</priority>`);
    }
    lines.push('  </url>');
  }
  lines.push('</urlset>');
  return lines.join('\n');
}

function renderSitemapIndex(sitemapUrls: string[]): string {
  const now = new Date().toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  for (const u of sitemapUrls) {
    lines.push('  <sitemap>');
    lines.push(`    <loc>${escapeXml(u)}</loc>`);
    lines.push(`    <lastmod>${now}</lastmod>`);
    lines.push('  </sitemap>');
  }
  lines.push('</sitemapindex>');
  return lines.join('\n');
}

function emptyUrlSet(): string {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>';
}

function formatLastmod(createdAt: string | null): string | null {
  if (!createdAt) return null;
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10); // W3C date (YYYY-MM-DD) is valid per spec.
}

function stripTrailingSlash(s: string): string {
  return s.endsWith('/') ? s.slice(0, -1) : s;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
