// Issue detector catalog. Pure functions over PageData[] — no I/O, no DB.
// Both the renderer (IssuesTab) and the main process (IPC.ISSUES_GET) call
// `computeIssues()` on the same data; the catalog is the single source of truth
// for SEO issue definitions, severity, category and detection logic.
//
// Categories follow common SEO crawler taxonomy where reasonable:
//   page_titles, meta_description, headings, canonicals, directives,
//   response_codes, urls, images, links, security, social, structured_data,
//   content.
//
// Each detector returns `true` if the page IS affected by the issue.
// `computeIssues()` builds an IssueInstance per issue id with the list of
// affected URLs.

import type {
  IssueCategory,
  IssueDefinition,
  IssueInstance,
  IssueSeverity,
  PageData,
} from '../../types/index';

// Configurable thresholds (mirror SF defaults).
export const TITLE_MAX_LEN = 60;
export const TITLE_MIN_LEN = 30;
export const TITLE_MAX_PIXELS = 561;
export const META_MAX_LEN = 155;
export const META_MIN_LEN = 70;
export const META_MAX_PIXELS = 985;
export const H1_MAX_LEN = 70;
export const URL_MAX_LEN = 115;
export const LOW_WORD_COUNT = 200;

interface Detector extends IssueDefinition {
  detect: (p: PageData, ctx: DetectContext) => boolean;
}

export interface DetectContext {
  duplicateTitleUrls: Set<string>;
  duplicateMetaUrls: Set<string>;
  duplicateH1Urls: Set<string>;
  duplicateContentUrls: Set<string>;
}

// ─── Catalog ──────────────────────────────────────────────────────────────────

export const DETECTORS: Detector[] = [
  // ── Response codes
  d('client_error_4xx', 'response_codes', 'critical', 'Client Error (4xx)',
    'Page returned a 4xx HTTP status — broken or unauthorised.',
    (p) => p.statusCode != null && p.statusCode >= 400 && p.statusCode < 500),
  d('server_error_5xx', 'response_codes', 'critical', 'Server Error (5xx)',
    'Page returned a 5xx HTTP status — server-side failure.',
    (p) => p.statusCode != null && p.statusCode >= 500),
  d('redirect_3xx', 'response_codes', 'info', 'Redirect (3xx)',
    'Page returned a 3xx redirect.',
    (p) => p.statusCode != null && p.statusCode >= 300 && p.statusCode < 400),

  // ── Page titles
  d('missing_title', 'page_titles', 'critical', 'Missing Title',
    'Page has no <title> tag — major ranking signal.',
    (p) => p.statusCode === 200 && (!p.title || p.title.trim() === '')),
  d('duplicate_title', 'page_titles', 'warning', 'Duplicate Title',
    'Title is reused on another indexable URL.',
    (p, ctx) => p.statusCode === 200 && ctx.duplicateTitleUrls.has(p.url)),
  d('title_too_long', 'page_titles', 'warning', 'Title Over 60 Characters',
    `Titles longer than ${TITLE_MAX_LEN} chars are typically truncated in SERPs.`,
    (p) => p.statusCode === 200 && (p.titleLength ?? 0) > TITLE_MAX_LEN),
  d('title_too_short', 'page_titles', 'opportunity', 'Title Below 30 Characters',
    'Short titles waste available SERP real estate.',
    (p) => p.statusCode === 200 && p.title != null && p.title.trim() !== '' && (p.titleLength ?? 0) < TITLE_MIN_LEN),
  d('title_pixel_overflow', 'page_titles', 'warning', 'Title Pixel Width Over 561px',
    'Title likely truncated by Google due to pixel width.',
    (p) => p.statusCode === 200 && (p.titlePixelWidth ?? 0) > TITLE_MAX_PIXELS),
  d('multiple_titles', 'page_titles', 'warning', 'Multiple Title Tags',
    'Page has more than one <title> — only the first is honoured by Google.',
    (p) => p.statusCode === 200 && p.title != null && p.title.includes('|||MULTIPLE|||')),

  // ── Meta description
  d('missing_meta_description', 'meta_description', 'warning', 'Missing Meta Description',
    'Page has no <meta name="description"> — Google will autogenerate one.',
    (p) => p.statusCode === 200 && (!p.metaDescription || p.metaDescription.trim() === '')),
  d('duplicate_meta_description', 'meta_description', 'warning', 'Duplicate Meta Description',
    'Meta description is reused on another indexable URL.',
    (p, ctx) => p.statusCode === 200 && ctx.duplicateMetaUrls.has(p.url)),
  d('meta_description_too_long', 'meta_description', 'opportunity', 'Meta Description Over 155 Characters',
    `Descriptions longer than ${META_MAX_LEN} chars are usually truncated.`,
    (p) => p.statusCode === 200 && (p.metaDescLength ?? 0) > META_MAX_LEN),
  d('meta_description_too_short', 'meta_description', 'opportunity', 'Meta Description Below 70 Characters',
    'Short meta descriptions miss SERP real estate.',
    (p) => p.statusCode === 200 && p.metaDescription != null && p.metaDescription.trim() !== '' && (p.metaDescLength ?? 0) < META_MIN_LEN),
  d('meta_description_pixel_overflow', 'meta_description', 'opportunity', 'Meta Description Pixel Width Over 985px',
    'Description likely truncated by Google due to pixel width.',
    (p) => p.statusCode === 200 && (p.metaDescPixelWidth ?? 0) > META_MAX_PIXELS),

  // ── Headings
  d('missing_h1', 'headings', 'warning', 'Missing H1',
    'Indexable page has no H1 heading.',
    (p) => p.statusCode === 200 && p.isIndexable && (!p.h1 || p.h1.trim() === '')),
  d('multiple_h1', 'headings', 'opportunity', 'Multiple H1 Tags',
    'Page has more than one <h1> — pick a single primary heading.',
    (p) => p.statusCode === 200 && (p.h1Count ?? 0) > 1),
  d('duplicate_h1', 'headings', 'opportunity', 'Duplicate H1',
    'H1 reused on another indexable URL.',
    (p, ctx) => p.statusCode === 200 && ctx.duplicateH1Urls.has(p.url)),
  d('h1_too_long', 'headings', 'info', 'H1 Over 70 Characters',
    'Long H1s are harder to scan.',
    (p) => p.statusCode === 200 && (p.h1Length ?? 0) > H1_MAX_LEN),
  d('missing_h2', 'headings', 'info', 'Missing H2',
    'Page has no H2 — content structure may be flat.',
    (p) => p.statusCode === 200 && (p.h2Count ?? 0) === 0),

  // ── Canonicals
  d('canonicalised', 'canonicals', 'info', 'Canonicalised',
    'Page declares a canonical pointing to a different URL.',
    (p) => p.statusCode === 200 && p.isCanonicalized),
  d('missing_canonical', 'canonicals', 'opportunity', 'Missing Canonical',
    'Indexable page has no rel="canonical" — risk of duplicate content.',
    (p) => p.statusCode === 200 && p.isIndexable && !p.canonicalUrl),

  // ── Directives
  d('noindex', 'directives', 'info', 'Noindex',
    'Page declares meta robots noindex (intentional or accidental).',
    (p) => /noindex/i.test(p.robotsDirectives ?? '')),
  d('nofollow', 'directives', 'info', 'Nofollow',
    'Page declares meta robots nofollow.',
    (p) => /nofollow/i.test(p.robotsDirectives ?? '')),

  // ── URLs
  d('url_too_long', 'urls', 'opportunity', 'URL Over 115 Characters',
    `URLs longer than ${URL_MAX_LEN} chars are harder to share and may be truncated.`,
    (p) => p.url.length > URL_MAX_LEN),
  d('url_uppercase', 'urls', 'opportunity', 'URL With Uppercase Characters',
    'URLs with mixed case can cause duplicate-content issues on case-sensitive servers.',
    (p) => /[A-Z]/.test(safePath(p.url))),
  d('url_underscores', 'urls', 'info', 'URL With Underscores',
    'Hyphens are preferred over underscores as word separators.',
    (p) => /_/.test(safePath(p.url))),

  // ── Content
  d('low_word_count', 'content', 'opportunity', 'Low Word Count (<200)',
    `Pages with fewer than ${LOW_WORD_COUNT} words may be considered thin content.`,
    (p) => p.statusCode === 200 && p.isIndexable && (p.wordCount ?? 0) > 0 && (p.wordCount ?? 0) < LOW_WORD_COUNT),
  d('duplicate_content', 'content', 'warning', 'Near-Duplicate Content',
    'Content body matches another indexable URL by hash.',
    (p, ctx) => p.statusCode === 200 && ctx.duplicateContentUrls.has(p.url)),

  // ── Security
  d('missing_hsts', 'security', 'warning', 'Missing HSTS Header',
    'Page is served without Strict-Transport-Security.',
    (p) => p.statusCode === 200 && p.url.startsWith('https://') && !p.hasHSTS),
  d('missing_csp', 'security', 'opportunity', 'Missing CSP Header',
    'Page is served without Content-Security-Policy.',
    (p) => p.statusCode === 200 && !p.hasCSP),
  d('missing_x_frame', 'security', 'opportunity', 'Missing X-Frame-Options',
    'Page lacks clickjacking protection.',
    (p) => p.statusCode === 200 && !p.xFrameOptions),

  // ── Social (Open Graph / Twitter Card)
  d('missing_og_title', 'social', 'opportunity', 'Missing Open Graph Title',
    'No og:title — share previews may be poor on Facebook/LinkedIn.',
    (p) => p.statusCode === 200 && p.isIndexable && !p.ogTitle),
  d('missing_og_image', 'social', 'opportunity', 'Missing Open Graph Image',
    'No og:image — share previews lack a visual.',
    (p) => p.statusCode === 200 && p.isIndexable && !p.ogImage),
  d('missing_twitter_card', 'social', 'info', 'Missing Twitter Card',
    'No twitter:card meta — Twitter falls back to OG.',
    (p) => p.statusCode === 200 && p.isIndexable && !p.twitterCard),

  // ── Structured Data
  d('missing_structured_data', 'structured_data', 'opportunity', 'Missing Structured Data',
    'Page has no JSON-LD / microdata schema.',
    (p) => p.statusCode === 200 && p.isIndexable && !p.hasStructuredData),
  d('schema_errors', 'structured_data', 'warning', 'Structured Data Errors',
    'JSON-LD parsing or validation errors detected on this page.',
    (p) => !!p.schemaErrors && p.schemaErrors.trim() !== ''),

  // ── Links / Images (page-level proxies; per-row detail lives in the Images/Links tabs)
  d('low_link_score', 'links', 'info', 'Low Internal Link Score',
    'Page receives few internal inlinks (linkScore < 10).',
    (p) => p.statusCode === 200 && p.isIndexable && (p.linkScore ?? 0) < 10),
  d('high_image_count', 'images', 'info', 'High Image Count (>50)',
    'Page contains an unusually high number of images — review weight & alt text.',
    (p) => p.statusCode === 200 && (p.imageCount ?? 0) > 50),
];

// ─── Public computeIssues() ───────────────────────────────────────────────────

export function computeIssues(pages: PageData[]): IssueInstance[] {
  const ctx = buildContext(pages);
  const out: IssueInstance[] = [];
  for (const det of DETECTORS) {
    const affected: string[] = [];
    for (const p of pages) {
      try {
        if (det.detect(p, ctx)) affected.push(p.url);
      } catch {
        // Defensive: never let a single detector crash the whole computation.
      }
    }
    if (affected.length === 0) continue;
    out.push({
      id: det.id,
      category: det.category,
      severity: det.severity,
      title: det.title,
      description: det.description,
      affectedUrls: affected,
    });
  }
  return out;
}

export function getCategories(): IssueCategory[] {
  return [
    'response_codes',
    'page_titles',
    'meta_description',
    'headings',
    'canonicals',
    'directives',
    'urls',
    'content',
    'security',
    'social',
    'structured_data',
    'links',
    'images',
  ];
}

export function categoryLabel(c: IssueCategory): string {
  switch (c) {
    case 'page_titles': return 'Page Titles';
    case 'meta_description': return 'Meta Description';
    case 'headings': return 'Headings';
    case 'canonicals': return 'Canonicals';
    case 'directives': return 'Directives';
    case 'response_codes': return 'Response Codes';
    case 'urls': return 'URLs';
    case 'images': return 'Images';
    case 'links': return 'Links';
    case 'security': return 'Security';
    case 'social': return 'Social';
    case 'structured_data': return 'Structured Data';
    case 'content': return 'Content';
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function d(
  id: string,
  category: IssueCategory,
  severity: IssueSeverity,
  title: string,
  description: string,
  detect: Detector['detect'],
): Detector {
  return { id, category, severity, title, description, detect };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function buildContext(pages: PageData[]): DetectContext {
  const titleMap = new Map<string, string[]>();
  const metaMap = new Map<string, string[]>();
  const h1Map = new Map<string, string[]>();
  const hashMap = new Map<string, string[]>();
  for (const p of pages) {
    if (p.statusCode !== 200 || !p.isIndexable) continue;
    if (p.title) push(titleMap, p.title.trim().toLowerCase(), p.url);
    if (p.metaDescription) push(metaMap, p.metaDescription.trim().toLowerCase(), p.url);
    if (p.h1) push(h1Map, p.h1.trim().toLowerCase(), p.url);
    if (p.contentHash) push(hashMap, p.contentHash, p.url);
  }
  return {
    duplicateTitleUrls: collectDuplicates(titleMap),
    duplicateMetaUrls: collectDuplicates(metaMap),
    duplicateH1Urls: collectDuplicates(h1Map),
    duplicateContentUrls: collectDuplicates(hashMap),
  };
}

function push(m: Map<string, string[]>, k: string, v: string): void {
  const arr = m.get(k);
  if (arr) arr.push(v); else m.set(k, [v]);
}

function collectDuplicates(m: Map<string, string[]>): Set<string> {
  const out = new Set<string>();
  for (const arr of m.values()) {
    if (arr.length > 1) for (const u of arr) out.add(u);
  }
  return out;
}
