import React, { useState, useEffect, useCallback } from 'react';
import CrawlConfig from './components/CrawlConfig';
import ResultsTabs from './components/ResultsTabs';
import CostMonitor from './components/CostMonitor';
import Settings from './components/Settings';
import AIInsights from './components/AIInsights';
import { CrawlProgress, PageData, LinkData, ImageData, CrawlRecord, SerpResultRow, UsageStats } from '../types/index';

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
      crawlStart: (config: unknown) => Promise<{ success: boolean; crawlId?: string; error?: string }>;
      crawlPause: () => Promise<void>;
      crawlResume: () => Promise<void>;
      crawlStop: () => Promise<void>;
      onCrawlProgress: (cb: (p: unknown) => void) => void;
      onCrawlError: (cb: (msg: string) => void) => void;
      onCrawlComplete: (cb: (crawlId: string) => void) => void;
      onCostLimit: (cb: (data: unknown) => void) => void;
      onAIProgress: (cb: (data: unknown) => void) => void;
      removeAllListeners: (channel: string) => void;
      getCrawls: () => Promise<CrawlRecord[]>;
      getPages: (crawlId: string) => Promise<PageData[]>;
      getLinks: (crawlId: string) => Promise<LinkData[]>;
      getImages: (crawlId: string) => Promise<ImageData[]>;
      exportCsv: (data: { rows: Record<string, unknown>[]; filename: string }) => Promise<{ success: boolean }>;
      exportJson: (data: { rows: Record<string, unknown>[]; filename: string }) => Promise<{ success: boolean }>;
      getSettings: () => Promise<unknown>;
      saveSettings: (settings: unknown) => Promise<{ success: boolean; error?: string }>;
      testBrightData: (apiKey: string, zone: string) => Promise<{ success: boolean }>;
      testOllama: (url: string) => Promise<{ success: boolean; models: unknown[] }>;
      aiAnalyze: (crawlId: string) => Promise<{ success: boolean; total?: number; error?: string }>;
      aiGetResults: (pageId: string) => Promise<unknown[]>;
      getIncompleteCrawl: () => Promise<{ id: string; startUrl: string; completedUrls: number; totalUrls: number; status: string } | null>;
      resumeIncompleteCrawl: () => Promise<{ success: boolean; crawlId?: string; error?: string }>;
      serpQuery: (crawlId: string, keywords: string[], location?: string, device?: 'desktop' | 'mobile') => Promise<{ success: boolean; total?: number; totalCost?: number; error?: string }>;
      serpGetResults: (crawlId: string) => Promise<unknown[]>;
      getUsageStats: () => Promise<UsageStats>;
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

  const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = toastCounter + 1;
    setToastCounter(c => c + 1);
    setToasts(t => [...t, { id, message, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000);
  }, [toastCounter]);

  const loadCrawlData = useCallback(async (crawlId: string) => {
    const [p, l, i] = await Promise.all([
      window.api.getPages(crawlId),
      window.api.getLinks(crawlId),
      window.api.getImages(crawlId),
    ]);
    setPages(p);
    setLinks(l);
    setImages(i);
    // Load SERP results (non-blocking)
    window.api.serpGetResults(crawlId).then(results => {
      setSerpResults(results as SerpResultRow[]);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    window.api.onCrawlProgress((p) => {
      const prog = p as CrawlProgress;
      setProgress(prog);
      // Refresh data periodically during crawl
      if (prog.completed % 20 === 0 && prog.crawlId) {
        loadCrawlData(prog.crawlId);
      }
    });

    window.api.onCrawlError((msg) => {
      showToast(`Crawl error: ${msg}`, 'error');
    });

    window.api.onCrawlComplete((crawlId) => {
      setActiveCrawlId(crawlId);
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

    return () => {
      window.api.removeAllListeners('crawl:progress');
      window.api.removeAllListeners('crawl:error');
      window.api.removeAllListeners('crawl:complete');
      window.api.removeAllListeners('crawl:cost-limit');
    };
  }, [showToast, loadCrawlData]);

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
    setPages([]);
    setLinks([]);
    setImages([]);
    setSerpResults([]);
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
          🐸 GhostFrog
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
                  crawlId={activeCrawlId}
                  showToast={showToast}
                  onSerpQuery={handleSerpQuery}
                  serpLoading={serpLoading}
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
