// Shared types across main and renderer processes

export type CrawlEngine = 'local' | 'brightdata' | 'brightdata-browser';
export type CrawlMode = 'spider' | 'list';
export type CrawlStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
export type StorageMode = 'memory' | 'database';
export type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini' | 'openrouter';
export type IssueSeverity = 'critical' | 'warning' | 'info' | 'opportunity';

export interface CrawlConfig {
  startUrl: string;
  mode: CrawlMode;
  engine: CrawlEngine;
  storageMode: StorageMode;
  maxUrls: number;
  maxDepth: number;
  concurrency: number;
  respectRobots: boolean;
  followRedirects: boolean;
  restrictToSubdomain: boolean;
  timeout: number; // ms
  // Extraction toggles
  extractTitles: boolean;
  extractMeta: boolean;
  extractHeadings: boolean;
  extractImages: boolean;
  extractLinks: boolean;
  extractCanonicals: boolean;
  // Cost limit (BD mode)
  maxCostUsd: number;
  // BD Zone override
  bdZone?: string;
  // List mode URLs
  urlList?: string[];
  // Use JS rendering (hidden Electron BrowserWindow) for local crawls
  jsRender?: boolean;
  // Hreflang extraction
  extractHreflang?: boolean;
  // Custom CSS selector extraction rules
  customExtractions?: CustomExtractionRule[];
  // Custom robots.txt body (overrides fetched /robots.txt when respectRobots = true)
  customRobotsTxt?: string;
  // User-agent token to match in robots.txt (default: 'Serpent')
  robotsUserAgent?: string;
  // Rate limiting: max requests per second (0 = unlimited)
  requestsPerSecond?: number;
  // ── Advanced crawl behavior ──
  // HTTP User-Agent header sent with every request (default: Serpent UA)
  userAgent?: string;
  // Only crawl discovered URLs matching at least one regex (seed/list URLs always crawled)
  includePatterns?: string[];
  // Never crawl discovered URLs matching any regex
  excludePatterns?: string[];
  // HTTP Basic authentication
  authUser?: string;
  authPass?: string;
  // Extra request headers sent with every request (local engine)
  customHeaders?: { name: string; value: string }[];
  // Persist cookies across requests for the duration of the crawl (local engine)
  enableCookies?: boolean;
  // Query params to strip from discovered URLs before enqueueing.
  // Supports trailing-* wildcards (e.g. "utm_*") and "*" for all params.
  stripUrlParams?: string[];
  // Restrict spider crawling to URLs under the seed URL's folder
  restrictToStartPath?: boolean;
}

export type PageStatus = 'ok' | 'redirect' | 'error' | 'pending';

export interface PageData {
  id: string;
  crawlId: string;
  url: string;
  statusCode: number | null;
  contentType: string | null;
  title: string | null;
  titleLength: number | null;
  titlePixelWidth: number | null;
  metaDescription: string | null;
  metaDescLength: number | null;
  metaDescPixelWidth: number | null;
  h1: string | null;
  h2: string | null;
  wordCount: number | null;
  canonicalUrl: string | null;
  isCanonicalized: boolean;
  isIndexable: boolean;
  responseTimeMs: number | null;
  pageSizeBytes: number | null;
  crawlDepth: number;
  costUsd: number;
  createdAt: string;
  contentHash: string | null;
  h1Length: number | null;
  h2Length: number | null;
  h1Count: number;
  h2Count: number;
  robotsDirectives: string | null;
  metaKeywords: string | null;
  textRatio: number | null;
  // OG / Twitter Card
  ogTitle: string | null;
  ogDescription: string | null;
  ogImage: string | null;
  ogType: string | null;
  twitterCard: string | null;
  twitterTitle: string | null;
  twitterDescription: string | null;
  twitterImage: string | null;
  // Structured Data
  schemaTypes: string | null;
  schemaJson: string | null;
  schemaErrors: string | null;
  hasStructuredData: boolean;
  // Security Headers
  hasHSTS: boolean;
  hasCSP: boolean;
  xFrameOptions: string | null;
  xContentTypeOptions: string | null;
  imageCount: number;
  linkScore: number;
  // 64-bit simhash fingerprint of body text (16 hex chars) for near-duplicate detection
  simhash: string | null;
  /** Count of internal outlinks on this page that are not crawlable per Google's guidance. */
  uncrawlableOutlinks: number;
}

/** Whether a link follows Google's crawlable-link guidance. */
export type LinkCrawlability = 'crawlable' | 'uncrawlable';

export type UncrawlableReason =
  | 'href_on_non_anchor'   // <div href="…">, <span href="…">
  | 'javascript_href'      // <a href="javascript:goTo('x')">
  | 'onclick_only';        // <a onclick="goto('x')"> with no usable href

export const UNCRAWLABLE_REASON_LABELS: Record<UncrawlableReason, string> = {
  href_on_non_anchor: 'href on a non-anchor element',
  javascript_href: 'javascript: pseudo-URL in href',
  onclick_only: 'onclick handler with no crawlable href',
};

export interface LinkData {
  id: string;
  crawlId: string;
  sourceUrl: string;
  targetUrl: string;
  isInternal: boolean;
  anchorText: string | null;
  relAttr: string | null;
  statusCode?: number | null;
  /** Defaults to 'crawlable' when absent (rows written before this existed). */
  crawlability?: LinkCrawlability;
  /** Why the link is uncrawlable — null/absent for normal links. */
  uncrawlableReason?: string | null;
}

export interface ImageData {
  id: string;
  crawlId: string;
  pageUrl: string;
  imageUrl: string;
  altText: string | null;
  format: string | null;
  hasWidth: boolean;
  hasHeight: boolean;
  isLazy: boolean;
}

export interface RedirectData {
  id: string;
  crawlId: string;
  sourceUrl: string;
  targetUrl: string;
  statusCode: number;
  hopNumber: number;
  finalUrl: string;
}

export interface HreflangData {
  id: string;
  crawlId: string;
  pageUrl: string;
  hreflang: string;
  href: string;
}

export interface CustomExtractionRule {
  name: string;
  selector: string;
}

export interface CustomExtractionResult {
  id: string;
  crawlId: string;
  pageUrl: string;
  ruleName: string;
  selector: string;
  value: string | null;
}

export interface CrawlRecord {
  id: string;
  mode: CrawlEngine;
  startUrl: string;
  startTime: string;
  endTime: string | null;
  status: CrawlStatus;
  configJson: string;
  totalUrls: number;
  completedUrls: number;
  totalSpendUsd: number;
  /** Locked crawls are exempt from the retention policy. */
  locked: boolean;
  /** Set when the crawl was started by a schedule. */
  scheduleId?: string | null;
}

export interface CrawlProgress {
  crawlId: string;
  status: CrawlStatus;
  completed: number;
  total: number;
  currentUrl: string;
  avgResponseMs: number;
  totalSpendUsd: number;
  costLimitUsd: number;
  pagesPerSecond: number;
}

export interface AIAnalysis {
  pageId: string;
  analysisType: 'content' | 'technical' | 'competitor';
  score: number;
  insightsJson: string;
  createdAt: string;
}

export interface IssueRecommendation {
  crawlId: string;
  issueType: string;
  severity: IssueSeverity;
  explanation: string;
  fixSuggestions: string[];
  affectedCount: number;
  createdAt: string;
}

export interface SerpResultRow {
  id: string;
  crawlId: string;
  keyword: string;
  location: string | null;
  device: string | null;
  position: number;
  url: string;
  title: string;
  description: string;
  featuresJson: string;
  costUsd: number;
  createdAt: string;
}

export interface UsageLog {
  id: string;
  timestamp: string;
  engineType: CrawlEngine;
  urlsCrawled: number;
  bytesDownloaded: number;
  costUsd: number;
}

export interface AppSettings {
  brightDataApiKey: string | null;
  brightDataZone: string | null;
  /** Bright Data customer ID (e.g. hl_xxx) — required for proxy mode redirect tracking */
  brightDataCustomerId: string | null;
  /** Browser API credentials in "USER:PASS" form (for JS rendering of SPAs) */
  brightDataBrowserAuth: string | null;
  maxCostPerCrawl: number;
  /** Alias for maxCostPerCrawl used by UI */
  costLimitUsd?: number;
  maxCostPerDay: number;
  // AI Provider settings
  aiProvider: AIProvider;
  ollamaUrl: string;
  ollamaModel: string;
  openaiApiKey: string | null;
  openaiModel: string;
  anthropicApiKey: string | null;
  anthropicModel: string;
  geminiApiKey: string | null;
  geminiModel: string;
  openrouterApiKey: string | null;
  openrouterModel: string;
  defaultEngine: CrawlEngine;
  defaultStorageMode: StorageMode;
  /** Google PageSpeed Insights API key (optional — keyless works at very low volume) */
  psiApiKey: string | null;
  /** Auto-delete settled crawls older than this many days. 0 = never (default). */
  crawlRetentionDays: number;
}

export interface UsageStats {
  totalSpend: number;
  todaySpend: number;
  dailyHistory: { date: string; cost: number; requests: number }[];
  crawlHistory: { crawlId: string; startUrl: string; cost: number; date: string }[];
}

export interface CrawlDiffChange {
  field: string;
  oldValue: string | number | boolean | null;
  newValue: string | number | boolean | null;
}

export interface CrawlDiff {
  url: string;
  status: 'added' | 'removed' | 'changed' | 'unchanged';
  changes: CrawlDiffChange[];
}

export interface GSCRow {
  url: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GSCData {
  rows: GSCRow[];
  siteUrl: string;
  lastFetched: string;
}

export interface GSCOrphanPage {
  url: string;
  clicks: number;
  impressions: number;
  position: number;
  reason: 'not_in_crawl';
}

export interface GSCOpportunity {
  url: string;
  query: string;
  clicks: number;
  impressions: number;
  position: number;
}

// ── GEO/AEO Readiness Scoring ──

export type GEOCategory = 'entity' | 'answer' | 'citation' | 'schema';

export interface GEOIssue {
  category: GEOCategory;
  severity: IssueSeverity;
  message: string;
  recommendation: string;
}

export interface GEOScore {
  pageId: string;
  crawlId: string;
  url: string;
  overallScore: number;
  entityClarity: number;
  answerReadiness: number;
  citationSignals: number;
  structuredDataCompleteness: number;
  issues: GEOIssue[];
  analyzedAt: string;
}

// ── Performance / Core Web Vitals ──

export interface PerformanceScore {
  pageId: string;
  crawlId: string;
  url: string;
  overallScore: number;
  ttfbScore: number;
  pageSizeScore: number;
  imageOptScore: number;
  contentEfficiency: number;
  ttfbMs: number;
  totalBytes: number;
  imageBytes: number;
  issues: PerformanceIssue[];
  analyzedAt: string;
}

export interface PerformanceIssue {
  category: 'ttfb' | 'size' | 'images' | 'content';
  severity: IssueSeverity;
  message: string;
  recommendation: string;
}

// ── PageSpeed Insights / Core Web Vitals ──

export type PsiStrategy = 'mobile' | 'desktop';

export interface PsiScore {
  pageId: string;
  crawlId: string;
  url: string;
  strategy: PsiStrategy;
  /** Lighthouse performance score 0–100 */
  performanceScore: number | null;
  // Lab metrics (Lighthouse)
  lcpMs: number | null;
  clsValue: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  // CrUX field data (28-day real users) — null when the URL has too little traffic
  fieldLcpMs: number | null;
  fieldInpMs: number | null;
  fieldCls: number | null;
  fieldOverallCategory: string | null; // FAST | AVERAGE | SLOW
  fetchedAt: string;
}

// ── Competitor Discovery / Content Gap ──

export interface DiscoverRequest {
  query: string;
  intent?: string;
  country?: string;
  language?: string;
  city?: string;
  numResults?: number;
  filterKeywords?: string[];
  includeContent?: boolean;
  startDate?: string;
  endDate?: string;
}

export interface DiscoverResult {
  link: string;
  title: string;
  description: string;
  relevanceScore: number;
  content: string | null;
}

export interface DiscoverTaskResponse {
  status: 'done' | 'processing' | 'error';
  durationSeconds: number;
  results: DiscoverResult[];
}

export interface ContentGap {
  id: string;
  crawlId: string;
  topic: string;
  hasOwnContent: boolean;
  ownContentCount: number;
  competitorCount: number;
  competitorDomains: string[];
  topCompetitorUrls: { url: string; title: string; relevanceScore: number }[];
  avgRelevanceScore: number;
  gapSeverity: 'high' | 'medium' | 'low' | 'none';
  analyzedAt: string;
}

// ── PDF Report Export ──

export interface ReportConfig {
  crawlId: string;
  title: string;
  companyName?: string;
  analystName?: string;
  sections: ReportSection[];
  brandColor: string;
}

export type ReportSection =
  | 'executive_summary'
  | 'technical_issues'
  | 'content_quality'
  | 'performance'
  | 'geo_readiness'
  | 'internal_links'
  | 'structured_data'
  | 'security'
  | 'images';

// ── Bulk / Flexible Export ──

export type ExportFormat = 'csv' | 'json';

export type BulkExportCategory =
  // Links
  | 'all_inlinks'
  | 'all_outlinks'
  | 'internal_links'
  | 'external_links'
  // By status code
  | 'inlinks_to_3xx'
  | 'inlinks_to_4xx'
  | 'inlinks_to_5xx'
  // Pages
  | 'all_pages_full'
  | 'pages_2xx'
  | 'pages_3xx'
  | 'pages_4xx'
  | 'pages_5xx'
  | 'non_indexable_pages'
  // Images
  | 'all_images'
  | 'images_missing_alt'
  // Scores
  | 'geo_scores'
  | 'perf_scores'
  // Other
  | 'redirects'
  | 'hreflang'
  | 'duplicates'
  | 'custom_extractions';

export interface BulkExportRequest {
  crawlId: string;
  categories: BulkExportCategory[];
  format: ExportFormat;
}

export interface PerUrlExportRequest {
  crawlId: string;
  urls: string[];
  type: 'inlinks' | 'outlinks' | 'images';
  format: ExportFormat;
}

// ─── Issues engine ─────────────────────────────────────────────────────────────

export type IssueCategory =
  | 'page_titles'
  | 'meta_description'
  | 'headings'
  | 'canonicals'
  | 'directives'
  | 'response_codes'
  | 'urls'
  | 'images'
  | 'links'
  | 'security'
  | 'social'
  | 'structured_data'
  | 'content';

export interface IssueDefinition {
  id: string;            // unique id e.g. "missing_title"
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;         // human label "Missing Title"
  description: string;   // why it matters (one-liner)
}

export interface IssueInstance {
  id: string;            // matches IssueDefinition.id
  category: IssueCategory;
  severity: IssueSeverity;
  title: string;
  description: string;
  affectedUrls: string[];
}

// ─── Sitemap (XML) ─────────────────────────────────────────────────────────────

export interface SitemapAnalysisResult {
  sitemapUrl: string;
  fetchedSitemaps: string[];      // expanded sitemap-index children
  urlsInSitemap: string[];        // unique URLs found in sitemap(s)
  notInSitemap: string[];         // crawled & indexable URLs NOT in sitemap
  orphanFromSitemap: string[];    // URLs in sitemap but never crawled
  nonIndexableInSitemap: string[];// URLs in sitemap that are noindex/canonicalised/4xx/5xx
  duplicateInSitemap: string[];   // URLs appearing in 2+ sitemaps
  errors: string[];               // fetch/parse errors
}

export interface SitemapGenerateOptions {
  crawlId: string;
  origin: string;                 // base URL (e.g. https://example.com)
  includeNonCanonical?: boolean;  // default false — exclude canonicalised pages
  defaultChangefreq?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  defaultPriority?: number;       // 0.0–1.0
}

// ─── Scheduled crawls ──────────────────────────────────────────────────────────

export interface CrawlSchedule {
  id: string;
  name: string;
  startUrl: string;
  intervalHours: number;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string;
  configJson: string;
  createdAt: string;
  /** Diff each run against the previous crawl from this schedule. */
  autoCompare: boolean;
  /** Serialised ScheduleDiffSummary from the last auto-compare, if any. */
  lastDiffJson: string | null;
}

/** Result of an auto-compare after a scheduled crawl finishes. */
export interface ScheduleDiffSummary {
  scheduleId: string;
  scheduleName: string;
  previousCrawlId: string;
  currentCrawlId: string;
  added: number;
  removed: number;
  changed: number;
  comparedAt: string;
}

// ─── Robots.txt tester ─────────────────────────────────────────────────────────

export interface RobotsTestRequest {
  robotsTxt: string;              // raw robots.txt body
  url: string;                    // URL to test
  userAgent?: string;             // default '*'
}

export interface RobotsTestResult {
  allowed: boolean;
  matchedRule: string | null;     // e.g. "Disallow: /admin"
  ruleType: 'allow' | 'disallow' | 'none';
  appliedAgent: string;           // which user-agent block matched
}

// IPC channel names
export const IPC = {
  // Crawl control
  CRAWL_START: 'crawl:start',
  CRAWL_PAUSE: 'crawl:pause',
  CRAWL_RESUME: 'crawl:resume',
  CRAWL_STOP: 'crawl:stop',
  CRAWL_PROGRESS: 'crawl:progress',
  CRAWL_ERROR: 'crawl:error',
  CRAWL_COMPLETE: 'crawl:complete',

  // Data retrieval
  DATA_GET_PAGES: 'data:get-pages',
  DATA_GET_LINKS: 'data:get-links',
  DATA_GET_IMAGES: 'data:get-images',
  DATA_GET_REDIRECTS: 'data:get-redirects',
  DATA_GET_HREFLANG: 'data:get-hreflang',
  DATA_GET_DUPLICATES: 'data:get-duplicates',
  DATA_GET_CUSTOM_EXTRACTS: 'data:get-custom-extracts',
  DATA_GET_CRAWLS: 'data:get-crawls',
  DATA_EXPORT_CSV: 'data:export-csv',
  DATA_EXPORT_JSON: 'data:export-json',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SAVE: 'settings:save',
  SETTINGS_TEST_BD: 'settings:test-brightdata',
  SETTINGS_TEST_BD_BROWSER: 'settings:test-brightdata-browser',
  SETTINGS_TEST_OLLAMA: 'settings:test-ollama',
  SETTINGS_TEST_AI_PROVIDER: 'settings:test-ai-provider',

  // AI
  AI_ANALYZE: 'ai:analyze',
  AI_ANALYZE_PAGE: 'ai:analyze-page',
  AI_ANALYZE_PROGRESS: 'ai:analyze-progress',
  AI_GET_RESULTS: 'ai:get-results',
  AI_ANALYZE_ISSUES: 'ai:analyze-issues',
  AI_GET_ISSUE_RECS: 'ai:get-issue-recs',

  // Resume
  CRAWL_GET_INCOMPLETE: 'crawl:get-incomplete',
  CRAWL_RESUME_INCOMPLETE: 'crawl:resume-incomplete',

  // SERP
  SERP_QUERY: 'serp:query',
  SERP_GET_RESULTS: 'serp:get-results',

  // Usage / Cost
  USAGE_GET_STATS: 'usage:get-stats',

  // Crawl comparison
  DATA_COMPARE_CRAWLS: 'data:compare-crawls',

  // Crawl retention
  CRAWL_DELETE: 'crawl:delete',
  CRAWL_SET_LOCKED: 'crawl:set-locked',

  // GSC
  GSC_CONNECT: 'gsc:connect',
  GSC_DISCONNECT: 'gsc:disconnect',
  GSC_GET_SITES: 'gsc:get-sites',
  GSC_FETCH_DATA: 'gsc:fetch-data',
  GSC_GET_STATUS: 'gsc:get-status',

  // GEO/AEO
  GEO_ANALYZE: 'geo:analyze',
  GEO_GET_SCORES: 'geo:get-scores',

  // Performance
  PERF_ANALYZE: 'perf:analyze',
  PERF_GET_SCORES: 'perf:get-scores',

  // PageSpeed Insights / CWV
  PSI_ANALYZE: 'psi:analyze',
  PSI_GET_SCORES: 'psi:get-scores',

  // Report
  REPORT_GENERATE_PDF: 'report:generate-pdf',

  // Bulk / Flexible Export
  EXPORT_BULK: 'export:bulk',
  EXPORT_PER_URL: 'export:per-url',

  // Discover (Competitor Discovery + Content Gap)
  DISCOVER_COMPETITORS: 'discover:competitors',
  DISCOVER_CONTENT_GAPS: 'discover:content-gaps',
  DISCOVER_GET_RESULTS: 'discover:get-results',
  DISCOVER_GET_GAPS: 'discover:get-gaps',

  // Sitemap (XML generation + analysis)
  SITEMAP_GENERATE: 'sitemap:generate',
  SITEMAP_ANALYZE: 'sitemap:analyze',
  SITEMAP_FETCH_URLS: 'sitemap:fetch-urls',

  // Robots.txt tester
  ROBOTS_TEST: 'robots:test',

  // Scheduled crawls
  SCHEDULE_LIST: 'schedule:list',
  SCHEDULE_ADD: 'schedule:add',
  SCHEDULE_DELETE: 'schedule:delete',
  SCHEDULE_TOGGLE: 'schedule:toggle',
} as const;
