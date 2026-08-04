import { contextBridge, ipcRenderer } from 'electron';
import { IPC, CrawlConfig, AppSettings, AIProvider, ReportConfig, BulkExportRequest, PerUrlExportRequest, RobotsTestRequest, SitemapGenerateOptions, EmbeddingRunConfig } from '../types/index';

// Expose a safe, typed API to the renderer process
contextBridge.exposeInMainWorld('api', {
  // Crawl control
  crawlStart: (config: CrawlConfig) => ipcRenderer.invoke(IPC.CRAWL_START, config),
  crawlPause: () => ipcRenderer.invoke(IPC.CRAWL_PAUSE),
  crawlResume: () => ipcRenderer.invoke(IPC.CRAWL_RESUME),
  crawlStop: () => ipcRenderer.invoke(IPC.CRAWL_STOP),

  // Events (main → renderer)
  onCrawlProgress: (cb: (progress: unknown) => void) => {
    ipcRenderer.on(IPC.CRAWL_PROGRESS, (_event, progress) => cb(progress));
  },
  onCrawlError: (cb: (msg: string) => void) => {
    ipcRenderer.on(IPC.CRAWL_ERROR, (_event, msg) => cb(msg));
  },
  onCrawlComplete: (cb: (crawlId: string) => void) => {
    ipcRenderer.on(IPC.CRAWL_COMPLETE, (_event, crawlId) => cb(crawlId));
  },
  onCostLimit: (cb: (data: unknown) => void) => {
    ipcRenderer.on('crawl:cost-limit', (_event, data) => cb(data));
  },
  onAIProgress: (cb: (data: unknown) => void) => {
    ipcRenderer.on(IPC.AI_ANALYZE_PROGRESS, (_event, data) => cb(data));
  },
  onLinksUpdated: (cb: (crawlId: string) => void) => {
    ipcRenderer.on('crawl:links-updated', (_event, crawlId) => cb(crawlId));
  },

  // Remove event listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Semantic embeddings
  embeddingsStatus: (crawlId: string) => ipcRenderer.invoke(IPC.EMBEDDINGS_STATUS, crawlId),
  embeddingsGenerate: (req: EmbeddingRunConfig) => ipcRenderer.invoke(IPC.EMBEDDINGS_GENERATE, req),
  embeddingsClear: (crawlId: string) => ipcRenderer.invoke(IPC.EMBEDDINGS_CLEAR, crawlId),
  onEmbeddingsProgress: (cb: (data: { crawlId: string; done: number; total: number }) => void) => {
    ipcRenderer.on(IPC.EMBEDDINGS_PROGRESS, (_e, data) => cb(data));
  },
  semanticAnalyze: (payload: { crawlId: string; similarityThreshold?: number; relevanceThreshold?: number }) =>
    ipcRenderer.invoke(IPC.SEMANTIC_ANALYZE, payload),
  semanticSearch: (payload: { crawlId: string; query: string }) =>
    ipcRenderer.invoke(IPC.SEMANTIC_SEARCH, payload),

  // Data retrieval
  getCrawls: () => ipcRenderer.invoke(IPC.DATA_GET_CRAWLS),
  deleteCrawl: (crawlId: string) => ipcRenderer.invoke(IPC.CRAWL_DELETE, crawlId),
  setCrawlLocked: (crawlId: string, locked: boolean) =>
    ipcRenderer.invoke(IPC.CRAWL_SET_LOCKED, { crawlId, locked }),
  getPages: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_PAGES, crawlId),
  getLinks: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_LINKS, crawlId),
  getImages: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_IMAGES, crawlId),
  getRedirects: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_REDIRECTS, crawlId),
  getHreflang: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_HREFLANG, crawlId),
  getDuplicates: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_DUPLICATES, crawlId),
  getCustomExtracts: (crawlId: string) => ipcRenderer.invoke(IPC.DATA_GET_CUSTOM_EXTRACTS, crawlId),
  exportCsv: (data: { rows: Record<string, unknown>[]; filename: string }) =>
    ipcRenderer.invoke(IPC.DATA_EXPORT_CSV, data),
  exportJson: (data: { rows: Record<string, unknown>[]; filename: string }) =>
    ipcRenderer.invoke(IPC.DATA_EXPORT_JSON, data),

  // Settings
  getSettings: () => ipcRenderer.invoke(IPC.SETTINGS_GET),
  saveSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke(IPC.SETTINGS_SAVE, settings),
  testBrightData: (apiKey: string, zone: string) => ipcRenderer.invoke(IPC.SETTINGS_TEST_BD, apiKey, zone),
  testBrightDataBrowser: (auth: string) => ipcRenderer.invoke(IPC.SETTINGS_TEST_BD_BROWSER, auth),
  testOllama: (url: string) => ipcRenderer.invoke(IPC.SETTINGS_TEST_OLLAMA, url),
  testAIProvider: (provider: AIProvider, config: { ollamaUrl?: string; apiKey?: string }) =>
    ipcRenderer.invoke(IPC.SETTINGS_TEST_AI_PROVIDER, provider, config),

  // AI
  aiAnalyze: (crawlId: string) => ipcRenderer.invoke(IPC.AI_ANALYZE, crawlId),
  aiAnalyzePage: (pageId: string, pageData: { url: string; title: string | null; metaDescription: string | null; h1: string | null; wordCount: number | null; statusCode: number | null; canonicalUrl: string | null; isIndexable: boolean | null }) => ipcRenderer.invoke(IPC.AI_ANALYZE_PAGE, pageId, pageData),
  aiGetResults: (pageId: string) => ipcRenderer.invoke(IPC.AI_GET_RESULTS, pageId),
  aiAnalyzeIssues: (data: { crawlId: string; issueType: string; severity: string; affectedPages: { url: string; title?: string | null; statusCode?: number | null }[] }) =>
    ipcRenderer.invoke(IPC.AI_ANALYZE_ISSUES, data),
  aiGetIssueRecs: (crawlId: string) => ipcRenderer.invoke(IPC.AI_GET_ISSUE_RECS, crawlId),

  // Resume
  getIncompleteCrawl: () => ipcRenderer.invoke(IPC.CRAWL_GET_INCOMPLETE),
  resumeIncompleteCrawl: () => ipcRenderer.invoke(IPC.CRAWL_RESUME_INCOMPLETE),

  // SERP
  serpQuery: (crawlId: string, keywords: string[], location?: string, device?: 'desktop' | 'mobile') =>
    ipcRenderer.invoke(IPC.SERP_QUERY, { crawlId, keywords, location, device }),
  serpGetResults: (crawlId: string) => ipcRenderer.invoke(IPC.SERP_GET_RESULTS, crawlId),

  // Usage / Cost
  getUsageStats: () => ipcRenderer.invoke(IPC.USAGE_GET_STATS),

  // Crawl Comparison
  compareCrawls: (crawlIdA: string, crawlIdB: string) => ipcRenderer.invoke(IPC.DATA_COMPARE_CRAWLS, crawlIdA, crawlIdB),

  // GSC
  gscConnect: () => ipcRenderer.invoke(IPC.GSC_CONNECT),
  gscDisconnect: () => ipcRenderer.invoke(IPC.GSC_DISCONNECT),
  gscGetSites: () => ipcRenderer.invoke(IPC.GSC_GET_SITES),
  gscFetchData: (siteUrl: string) => ipcRenderer.invoke(IPC.GSC_FETCH_DATA, siteUrl),
  gscGetStatus: () => ipcRenderer.invoke(IPC.GSC_GET_STATUS),

  // GEO/AEO
  geoAnalyze: (crawlId: string) => ipcRenderer.invoke(IPC.GEO_ANALYZE, crawlId),
  geoGetScores: (crawlId: string) => ipcRenderer.invoke(IPC.GEO_GET_SCORES, crawlId),

  // Performance
  perfAnalyze: (crawlId: string) => ipcRenderer.invoke(IPC.PERF_ANALYZE, crawlId),
  perfGetScores: (crawlId: string) => ipcRenderer.invoke(IPC.PERF_GET_SCORES, crawlId),

  // PageSpeed Insights / CWV
  psiAnalyze: (payload: { crawlId: string; strategy?: 'mobile' | 'desktop' }) =>
    ipcRenderer.invoke(IPC.PSI_ANALYZE, payload),
  psiGetScores: (crawlId: string) => ipcRenderer.invoke(IPC.PSI_GET_SCORES, crawlId),
  onPsiProgress: (cb: (data: { done: number; total: number; url: string }) => void) => {
    ipcRenderer.on('psi:progress', (_event, data) => cb(data));
  },

  // Reports
  reportGeneratePdf: (data: { config: ReportConfig; crawlId: string }) =>
    ipcRenderer.invoke(IPC.REPORT_GENERATE_PDF, data),

  // Flexible Export
  exportBulk: (req: BulkExportRequest) => ipcRenderer.invoke(IPC.EXPORT_BULK, req),
  exportPerUrl: (req: PerUrlExportRequest) => ipcRenderer.invoke(IPC.EXPORT_PER_URL, req),

  // Discover (Competitor Discovery + Content Gap)
  discoverCompetitors: (data: { crawlId: string; domain: string; keywords: string[]; country?: string }) =>
    ipcRenderer.invoke(IPC.DISCOVER_COMPETITORS, data),
  discoverContentGaps: (data: { crawlId: string; domain: string; topics: string[]; country?: string }) =>
    ipcRenderer.invoke(IPC.DISCOVER_CONTENT_GAPS, data),
  discoverGetResults: (crawlId: string, searchType?: string) =>
    ipcRenderer.invoke(IPC.DISCOVER_GET_RESULTS, { crawlId, searchType }),
  discoverGetGaps: (crawlId: string) =>
    ipcRenderer.invoke(IPC.DISCOVER_GET_GAPS, crawlId),

  // Robots.txt tester
  testRobots: (req: RobotsTestRequest) => ipcRenderer.invoke(IPC.ROBOTS_TEST, req),

  // Scheduled crawls
  scheduleList: () => ipcRenderer.invoke(IPC.SCHEDULE_LIST),
  scheduleAdd: (payload: { name: string; startUrl: string; intervalHours: number; autoCompare?: boolean; config?: Partial<CrawlConfig> }) =>
    ipcRenderer.invoke(IPC.SCHEDULE_ADD, payload),
  scheduleDelete: (id: string) => ipcRenderer.invoke(IPC.SCHEDULE_DELETE, id),
  scheduleToggle: (id: string, enabled: boolean) => ipcRenderer.invoke(IPC.SCHEDULE_TOGGLE, id, enabled),
  onScheduleTriggered: (cb: (data: { scheduleId: string; name: string; crawlId: string }) => void) => {
    ipcRenderer.on('schedule:triggered', (_event, data) => cb(data));
  },

  // Sitemap (XML)
  generateSitemap: (opts: SitemapGenerateOptions) =>
    ipcRenderer.invoke(IPC.SITEMAP_GENERATE, opts),
  analyzeSitemap: (payload: { crawlId: string; sitemapUrl: string }) =>
    ipcRenderer.invoke(IPC.SITEMAP_ANALYZE, payload),
  sitemapFetchUrls: (sitemapUrl: string) =>
    ipcRenderer.invoke(IPC.SITEMAP_FETCH_URLS, sitemapUrl),

  // Auto-updater events
  onUpdateAvailable: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on('update:available', (_event, info) => cb(info));
  },
  onUpdateDownloaded: (cb: (info: { version: string }) => void) => {
    ipcRenderer.on('update:downloaded', (_event, info) => cb(info));
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
});
