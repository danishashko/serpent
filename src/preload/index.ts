import { contextBridge, ipcRenderer } from 'electron';
import { IPC, CrawlConfig, AppSettings, AIProvider } from '../types/index';

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

  // Remove event listeners
  removeAllListeners: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },

  // Data retrieval
  getCrawls: () => ipcRenderer.invoke(IPC.DATA_GET_CRAWLS),
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
  testOllama: (url: string) => ipcRenderer.invoke(IPC.SETTINGS_TEST_OLLAMA, url),
  testAIProvider: (provider: AIProvider, config: { ollamaUrl?: string; apiKey?: string }) =>
    ipcRenderer.invoke(IPC.SETTINGS_TEST_AI_PROVIDER, provider, config),

  // AI
  aiAnalyze: (crawlId: string) => ipcRenderer.invoke(IPC.AI_ANALYZE, crawlId),
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
});
