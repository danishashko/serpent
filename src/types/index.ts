// Shared types across main and renderer processes

export type CrawlEngine = 'local' | 'brightdata';
export type CrawlMode = 'spider' | 'list';
export type CrawlStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error';
export type StorageMode = 'memory' | 'database';
export type AIProvider = 'ollama' | 'openai' | 'anthropic' | 'gemini';
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
}

export interface LinkData {
  id: string;
  crawlId: string;
  sourceUrl: string;
  targetUrl: string;
  isInternal: boolean;
  anchorText: string | null;
  relAttr: string | null;
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
  defaultEngine: CrawlEngine;
  defaultStorageMode: StorageMode;
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
  SETTINGS_TEST_OLLAMA: 'settings:test-ollama',
  SETTINGS_TEST_AI_PROVIDER: 'settings:test-ai-provider',

  // AI
  AI_ANALYZE: 'ai:analyze',
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

  // GSC
  GSC_CONNECT: 'gsc:connect',
  GSC_DISCONNECT: 'gsc:disconnect',
  GSC_GET_SITES: 'gsc:get-sites',
  GSC_FETCH_DATA: 'gsc:fetch-data',
  GSC_GET_STATUS: 'gsc:get-status',
} as const;
