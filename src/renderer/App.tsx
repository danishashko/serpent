import React, { useState, useEffect, useCallback } from 'react';
import CrawlConfig from './components/CrawlConfig';
import ResultsTabs from './components/ResultsTabs';
import CostMonitor from './components/CostMonitor';
import Settings from './components/Settings';
import AIInsights from './components/AIInsights';
import { CrawlProgress, PageData, LinkData, ImageData, CrawlRecord, SerpResultRow, UsageStats, RedirectData, HreflangData, CustomExtractionResult, IssueRecommendation, CrawlDiff, GSCData, GEOScore, PerformanceScore, ReportConfig, DiscoverResult, ContentGap, RobotsTestRequest, RobotsTestResult, SitemapAnalysisResult, SitemapGenerateOptions, CrawlSchedule, PsiScore } from '../types/index';

// Allow Electron drag region CSS property
declare module 'react' {
  interface CSSProperties {
    WebkitAppRegion?: 'drag' | 'no-drag';
  }
}

type View = 'crawl' | 'settings';
type CrawlTab = 'results' | 'ai';

interface Toast {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
}

declare global {
  interface Window {
    api: {
      crawlStart: (config: unknown) => Promise<{ success: boolean; crawlId?: string; error?: string; requiresUpgrade?: boolean }>;
      crawlPause: () => Promise<void>;
      crawlResume: () => Promise<void>;
      crawlStop: () => Promise<void>;
      onCrawlProgress: (cb: (p: unknown) => void) => void;
      onCrawlError: (cb: (msg: string) => void) => void;
      onCrawlComplete: (cb: (crawlId: string) => void) => void;
      onCostLimit: (cb: (data: unknown) => void) => void;
      onAIProgress: (cb: (data: unknown) => void) => void;
      onLinksUpdated: (cb: (crawlId: string) => void) => void;
      removeAllListeners: (channel: string) => void;
      getCrawls: () => Promise<CrawlRecord[]>;
      getPages: (crawlId: string) => Promise<PageData[]>;
      getLinks: (crawlId: string) => Promise<LinkData[]>;
      getImages: (crawlId: string) => Promise<ImageData[]>;
      getRedirects: (crawlId: string) => Promise<RedirectData[]>;
      getHreflang: (crawlId: string) => Promise<HreflangData[]>;
      getDuplicates: (crawlId: string) => Promise<{ contentHash: string; urls: string[] }[]>;
      getCustomExtracts: (crawlId: string) => Promise<CustomExtractionResult[]>;
      exportCsv: (data: { rows: Record<string, unknown>[]; filename: string }) => Promise<{ success: boolean }>;
      exportJson: (data: { rows: Record<string, unknown>[]; filename: string }) => Promise<{ success: boolean }>;
      getSettings: () => Promise<unknown>;
      saveSettings: (settings: unknown) => Promise<{ success: boolean; error?: string }>;
      testBrightData: (apiKey: string, zone: string) => Promise<{ success: boolean }>;
      testBrightDataBrowser: (auth: string) => Promise<{ success: boolean }>;
      testOllama: (url: string) => Promise<{ success: boolean; models: unknown[] }>;
      testAIProvider: (provider: string, config: { ollamaUrl?: string; apiKey?: string }) => Promise<{ success: boolean; models?: string[] }>;
      aiAnalyze: (crawlId: string) => Promise<{ success: boolean; total?: number; error?: string }>;
      aiAnalyzePage: (pageId: string, pageData: { url: string; title: string | null; metaDescription: string | null; h1: string | null; wordCount: number | null; statusCode: number | null; canonicalUrl: string | null; isIndexable: boolean | null }) => Promise<{ success: boolean; error?: string }>;
      aiGetResults: (pageId: string) => Promise<unknown[]>;
      aiAnalyzeIssues: (data: { crawlId: string; issueType: string; severity: string; affectedPages: { url: string; title?: string | null; statusCode?: number | null }[] }) => Promise<{ success: boolean; recommendation?: IssueRecommendation; error?: string }>;
      aiGetIssueRecs: (crawlId: string) => Promise<IssueRecommendation[]>;
      getIncompleteCrawl: () => Promise<{ id: string; startUrl: string; completedUrls: number; totalUrls: number; status: string } | null>;
      resumeIncompleteCrawl: () => Promise<{ success: boolean; crawlId?: string; error?: string }>;
      serpQuery: (crawlId: string, keywords: string[], location?: string, device?: 'desktop' | 'mobile') => Promise<{ success: boolean; total?: number; totalCost?: number; error?: string }>;
      serpGetResults: (crawlId: string) => Promise<unknown[]>;
      getUsageStats: () => Promise<UsageStats>;
      compareCrawls: (crawlIdA: string, crawlIdB: string) => Promise<CrawlDiff[]>;
      gscConnect: () => Promise<boolean>;
      gscDisconnect: () => Promise<boolean>;
      gscGetSites: () => Promise<string[]>;
      gscFetchData: (siteUrl: string) => Promise<GSCData>;
      gscGetStatus: () => Promise<boolean>;
      geoAnalyze: (crawlId: string) => Promise<{ success: boolean; total?: number; error?: string }>;
      geoGetScores: (crawlId: string) => Promise<GEOScore[]>;
      perfAnalyze: (crawlId: string) => Promise<{ success: boolean; total?: number; error?: string }>;
      perfGetScores: (crawlId: string) => Promise<PerformanceScore[]>;
      psiAnalyze: (payload: { crawlId: string; strategy?: 'mobile' | 'desktop' }) => Promise<{ success: boolean; total?: number; errors?: number; skippedUnreachable?: number; capped?: number; error?: string }>;
      psiGetScores: (crawlId: string) => Promise<PsiScore[]>;
      onPsiProgress: (cb: (data: { done: number; total: number; url: string }) => void) => void;
      reportGeneratePdf: (data: { config: ReportConfig; crawlId: string }) => Promise<{ success: boolean; filePath?: string; error?: string }>;
      discoverCompetitors: (data: { crawlId: string; domain: string; keywords: string[]; country?: string }) => Promise<{ success: boolean; results?: DiscoverResult[]; total?: number; error?: string }>;
      discoverContentGaps: (data: { crawlId: string; domain: string; topics: string[]; country?: string }) => Promise<{ success: boolean; gaps?: ContentGap[]; total?: number; error?: string }>;
      discoverGetResults: (crawlId: string, searchType?: string) => Promise<DiscoverResult[]>;
      discoverGetGaps: (crawlId: string) => Promise<ContentGap[]>;
      testRobots: (req: RobotsTestRequest) => Promise<RobotsTestResult>;
      scheduleList: () => Promise<CrawlSchedule[]>;
      scheduleAdd: (payload: { name: string; startUrl: string; intervalHours: number; config?: Record<string, unknown> }) => Promise<{ success: boolean; schedule?: CrawlSchedule; error?: string }>;
      scheduleDelete: (id: string) => Promise<{ success: boolean }>;
      scheduleToggle: (id: string, enabled: boolean) => Promise<{ success: boolean }>;
      onScheduleTriggered: (cb: (data: { scheduleId: string; name: string; crawlId: string }) => void) => void;
      generateSitemap: (opts: SitemapGenerateOptions) => Promise<{ ok: boolean; canceled?: boolean; totalUrls?: number; files?: { filename: string; urlCount: number }[]; written?: string[]; error?: string }>;
      analyzeSitemap: (payload: { crawlId: string; sitemapUrl: string }) => Promise<SitemapAnalysisResult>;
      sitemapFetchUrls: (sitemapUrl: string) => Promise<{ urls: string[]; error?: string }>;
      onUpdateAvailable: (cb: (info: { version: string }) => void) => void;
      onUpdateDownloaded: (cb: (info: { version: string }) => void) => void;
      installUpdate?: () => Promise<void>;
    };
  }
}

export default function App(): React.ReactElement {
  const [view, setView] = useState<View>('crawl');
  const [progress, setProgress] = useState<CrawlProgress | null>(null);
  const [activeCrawlId, setActiveCrawlId] = useState<string | null>(null);
  const [pages, setPages] = useState<PageData[]>([]);
  const [links, setLinks] = useState<LinkData[]>([]);
  const [images, setImages] = useState<ImageData[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [toastCounter, setToastCounter] = useState(0);
  const [resumePrompt, setResumePrompt] = useState<{ id: string; startUrl: string; completedUrls: number } | null>(null);
  const [crawlTab, setCrawlTab] = useState<CrawlTab>('results');
  const [serpResults, setSerpResults] = useState<SerpResultRow[]>([]);
  const [serpLoading, setSerpLoading] = useState(false);
  const [redirects, setRedirects] = useState<RedirectData[]>([]);
  const [hreflang, setHreflang] = useState<HreflangData[]>([]);
  const [duplicates, setDuplicates] = useState<{ contentHash: string; urls: string[] }[]>([]);
  const [customExtracts, setCustomExtracts] = useState<CustomExtractionResult[]>([]);
  const [geoScores, setGeoScores] = useState<GEOScore[]>([]);
  const [perfScores, setPerfScores] = useState<PerformanceScore[]>([]);
  const [discoverResults, setDiscoverResults] = useState<DiscoverResult[]>([]);
  const [contentGaps, setContentGaps] = useState<ContentGap[]>([]);
  const [updateBanner, setUpdateBanner] = useState<{ version: string; downloaded: boolean } | null>(null);

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = toastCounter + 1;
    setToastCounter(c => c + 1);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, [toastCounter]);

  const loadInFlightRef = React.useRef(false);
  const lastLoadAtRef = React.useRef(0);
  const livePreviewPausedRef = React.useRef(false);
  const livePreviewWarnedRef = React.useRef(false);

  const loadCrawlData = useCallback(async (crawlId: string) => {
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    try {
      const [p, l, i, r, h, d, ce] = await Promise.all([
        window.api.getPages(crawlId),
        window.api.getLinks(crawlId),
        window.api.getImages(crawlId),
        window.api.getRedirects(crawlId),
        window.api.getHreflang(crawlId),
        window.api.getDuplicates(crawlId),
        window.api.getCustomExtracts(crawlId),
      ]);
      setPages(p);
      setLinks(l);
      setImages(i);
      setRedirects(r);
      setHreflang(h);
      setDuplicates(d);
      setCustomExtracts(ce);
      lastLoadAtRef.current = Date.now();
    } finally {
      loadInFlightRef.current = false;
    }
    // Load SERP results (non-blocking)
    window.api.serpGetResults(crawlId).then(results => {
      setSerpResults(results as SerpResultRow[]);
    }).catch(() => {});
    // Load GEO + Performance scores (non-blocking)
    window.api.geoGetScores(crawlId).then(setGeoScores).catch(() => {});
    window.api.perfGetScores(crawlId).then(setPerfScores).catch(() => {});
    // Load Discover results (non-blocking)
    window.api.discoverGetResults(crawlId).then(setDiscoverResults).catch(() => {});
    window.api.discoverGetGaps(crawlId).then(setContentGaps).catch(() => {});
  }, []);

  useEffect(() => {
    window.api.onCrawlProgress((p) => {
      const prog = p as CrawlProgress;
      setProgress(prog);
      // Skip live data refresh once dataset gets huge — IPC payloads + table re-render lock the UI.
      // Once paused, stays paused for the rest of this crawl; final reload happens on 'crawl:complete'.
      if (livePreviewPausedRef.current) return;
      if (prog.completed >= 3000) {
        livePreviewPausedRef.current = true;
        if (!livePreviewWarnedRef.current) {
          livePreviewWarnedRef.current = true;
          showToast('Live preview paused — large crawl detected. Results will load when crawl completes.', 'info');
        }
        return;
      }
      // Time-based throttle: at most one refresh every 8s, and never overlap an in-flight load.
      if (!prog.crawlId) return;
      if (loadInFlightRef.current) return;
      if (Date.now() - lastLoadAtRef.current < 8000) return;
      loadCrawlData(prog.crawlId);
    });

    window.api.onCrawlError((msg) => {
      showToast(`Crawl error: ${msg}`, 'error');
    });

    window.api.onCrawlComplete((crawlId) => {
      setActiveCrawlId(crawlId);
      // Crawl is done — safe to load full dataset, even if it's big.
      livePreviewPausedRef.current = false;
      livePreviewWarnedRef.current = false;
      loadCrawlData(crawlId);
      showToast('Crawl completed!', 'success');
    });

    window.api.onCostLimit((data) => {
      const d = data as { currentSpend: number; limit: number };
      showToast(
        `Cost limit warning: $${d.currentSpend.toFixed(4)} / $${d.limit.toFixed(2)} limit. Crawl paused.`,
        'warning'
      );
    });

    window.api.onLinksUpdated((crawlId: string) => {
      // External link status check finished — refresh links data silently
      window.api.getLinks(crawlId).then(l => setLinks(l as LinkData[])).catch(() => {});
    });

    return () => {
      window.api.removeAllListeners('crawl:progress');
      window.api.removeAllListeners('crawl:error');
      window.api.removeAllListeners('crawl:complete');
      window.api.removeAllListeners('crawl:cost-limit');
      window.api.removeAllListeners('crawl:links-updated');
    };
  }, [showToast, loadCrawlData]);

  // Subscribe to auto-updater events (only available in production)
  useEffect(() => {
    if (window.api.onUpdateAvailable) {
      window.api.onUpdateAvailable((info) => {
        setUpdateBanner({ version: info.version, downloaded: false });
      });
    }
    if (window.api.onUpdateDownloaded) {
      window.api.onUpdateDownloaded((info) => {
        setUpdateBanner({ version: info.version, downloaded: true });
      });
    }
  }, []);

  // Check for incomplete crawl on mount
  useEffect(() => {
    window.api.getIncompleteCrawl().then(incomplete => {
      if (incomplete) {
        setResumePrompt({ id: incomplete.id, startUrl: incomplete.startUrl, completedUrls: incomplete.completedUrls });
      }
    });
  }, []);

  const handleResumeCrawl = async () => {
    if (!resumePrompt) return;
    setResumePrompt(null);
    const result = await window.api.resumeIncompleteCrawl();
    if (result.success && result.crawlId) {
      setActiveCrawlId(result.crawlId);
      showToast('Resuming incomplete crawl...', 'info');
    } else {
      showToast(`Failed to resume: ${result.error}`, 'error');
    }
  };

  const handleCrawlStart = async (crawlId: string) => {
    setActiveCrawlId(crawlId);
    livePreviewPausedRef.current = false;
    livePreviewWarnedRef.current = false;
    lastLoadAtRef.current = 0;
    setPages([]);
    setLinks([]);
    setImages([]);
    setSerpResults([]);
    setRedirects([]);
    setHreflang([]);
    setDuplicates([]);
    setCustomExtracts([]);
    setGeoScores([]);
    setPerfScores([]);
    setDiscoverResults([]);
    setContentGaps([]);
  };

  const handleSerpQuery = async (keywords: string[], location?: string, device?: 'desktop' | 'mobile') => {
    if (!activeCrawlId) return;
    setSerpLoading(true);
    try {
      const result = await window.api.serpQuery(activeCrawlId, keywords, location, device);
      if (result.success) {
        showToast(`SERP queried ${result.total} keywords ($${(result.totalCost ?? 0).toFixed(3)})`, 'success');
        const updated = await window.api.serpGetResults(activeCrawlId);
        setSerpResults(updated as SerpResultRow[]);
      } else {
        showToast(`SERP error: ${result.error}`, 'error');
      }
    } catch (err) {
      showToast(`SERP query failed: ${String(err)}`, 'error');
    } finally {
      setSerpLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Title bar drag area */}
      <div style={{
        height: 'var(--title-bar-height)',
        background: 'var(--bg-primary)',
        WebkitAppRegion: 'drag',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 16,
        gap: 16,
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-green)', WebkitAppRegion: 'no-drag' }}>
          🐍 Serpent
        </span>
        <nav style={{ display: 'flex', gap: 4, WebkitAppRegion: 'no-drag' }}>
          {(['crawl', 'settings'] as View[]).map(v => (
            <button
              key={v}
              className="btn-icon"
              onClick={() => setView(v)}
              style={{ color: view === v ? 'var(--text-primary)' : undefined, fontWeight: view === v ? 600 : 400 }}
            >
              {v === 'crawl' ? '🔍 Crawl' : '⚙️ Settings'}
            </button>
          ))}
        </nav>
        {progress && progress.status === 'running' && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, WebkitAppRegion: 'no-drag', paddingRight: 8 }}>
            <span className="spinner" />
            <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
              {progress.completed} / {progress.total} URLs · {progress.pagesPerSecond}/s
                          {progress.totalSpendUsd > 0 && ` · $${progress.totalSpendUsd.toFixed(4)}`}
            </span>
          </div>
        )}
      </div>

      {/* Update notification banner */}
      {updateBanner && (
        <div style={{
          background: updateBanner.downloaded ? '#166534' : '#1e3a5f',
          borderBottom: '1px solid var(--border)',
          padding: '6px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: 12,
          flexShrink: 0,
        }}>
          <span style={{ color: '#d1fae5' }}>
            {updateBanner.downloaded
              ? `✅ Serpent ${updateBanner.version} downloaded — restart to install`
              : `⬆️ Serpent ${updateBanner.version} is available — downloading in background...`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {updateBanner.downloaded && (
              <button
                className="btn-icon"
                style={{ fontSize: 11, padding: '2px 10px', background: 'var(--accent-green)', color: '#000', borderRadius: 4 }}
                onClick={() => window.api.installUpdate?.()}
              >
                Restart & Install
              </button>
            )}
            <button
              className="btn-icon"
              style={{ fontSize: 11, color: '#d1fae5', opacity: 0.7 }}
              onClick={() => setUpdateBanner(null)}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {view === 'crawl' ? (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left panel */}
            <div style={{
              width: 280,
              flexShrink: 0,
              borderRight: '1px solid var(--border)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}>
              <CrawlConfig
                progress={progress}
                onCrawlStart={handleCrawlStart}
                showToast={showToast}
              />
              {progress && progress.totalSpendUsd > 0 && (
                <CostMonitor progress={progress} />
              )}
            </div>

            {/* Results */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {/* Progress bar */}
              {progress && progress.status !== 'idle' && (
                <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                      {progress.status === 'running' ? 'Crawling...' : progress.status === 'paused' ? 'Paused' : 'Completed'}
                      {' · '}Avg {progress.avgResponseMs}ms · {progress.completed} URLs
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {progress.total > 0 ? `${Math.round((progress.completed / progress.total) * 100)}%` : ''}
                    </span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className={`progress-bar-fill ${progress.status === 'running' ? 'running' : ''}`}
                      style={{ width: progress.total > 0 ? `${Math.min(100, (progress.completed / progress.total) * 100)}%` : '0%' }}
                    />
                  </div>
                </div>
              )}

              {/* Sub-tab bar */}
              <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                {(['results', 'ai'] as CrawlTab[]).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setCrawlTab(tab)}
                    style={{
                      padding: '6px 16px', fontSize: 12, fontWeight: crawlTab === tab ? 600 : 400,
                      color: crawlTab === tab ? 'var(--accent-green)' : 'var(--text-secondary)',
                      background: 'transparent', border: 'none', cursor: 'pointer',
                      borderBottom: crawlTab === tab ? '2px solid var(--accent-green)' : '2px solid transparent',
                    }}
                  >
                    {tab === 'results' ? '📊 Results' : '🤖 AI Insights'}
                  </button>
                ))}
              </div>
              {crawlTab === 'results' ? (
                <ResultsTabs
                  pages={pages}
                  links={links}
                  images={images}
                  serpResults={serpResults}
                  redirects={redirects}
                  hreflang={hreflang}
                  duplicates={duplicates}
                  customExtracts={customExtracts}
                  geoScores={geoScores}
                  perfScores={perfScores}
                  crawlId={activeCrawlId}
                  showToast={showToast}
                  onSerpQuery={handleSerpQuery}
                  serpLoading={serpLoading}
                  onGeoScoresUpdate={setGeoScores}
                  onPerfScoresUpdate={setPerfScores}
                  discoverResults={discoverResults}
                  contentGaps={contentGaps}
                  onDiscoverResultsUpdate={setDiscoverResults}
                  onContentGapsUpdate={setContentGaps}
                />
              ) : (
                <AIInsights
                  pages={pages}
                  crawlId={activeCrawlId}
                  showToast={showToast}
                />
              )}
            </div>
          </div>
        ) : (
          <Settings showToast={showToast} />
        )}
      </div>

      {/* Resume prompt */}
      {resumePrompt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', zIndex: 2000,
        }}>
          <div style={{
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 24, maxWidth: 420, width: '90%',
          }}>
            <h3 style={{ margin: '0 0 12px', color: 'var(--text-primary)' }}>Resume Incomplete Crawl?</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 8px' }}>
              Found an incomplete crawl of <strong>{resumePrompt.startUrl}</strong>
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '0 0 16px' }}>
              {resumePrompt.completedUrls} URLs already crawled
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn-secondary" onClick={() => setResumePrompt(null)}>Dismiss</button>
              <button className="btn-primary" onClick={handleResumeCrawl}>Resume Crawl</button>
            </div>
          </div>
        </div>
      )}

      {/* Toasts */}
      <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1000 }}>
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
