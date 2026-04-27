import React, { useState, useEffect } from 'react';
import { PageData } from '../../types/index';

interface AIResult {
  pageId: string;
  analysisType: 'content' | 'technical';
  score: number;
  insightsJson: string;
  createdAt: string;
}

interface Props {
  pages: PageData[];
  crawlId: string | null;
  showToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function AIInsights({ pages, crawlId, showToast }: Props): React.ReactElement {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzingPage, setAnalyzingPage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ total: number; completed: number; currentUrl: string } | null>(null);
  const [results, setResults] = useState<Map<string, AIResult[]>>(new Map());
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  useEffect(() => {
    window.api.onAIProgress((data) => {
      const d = data as { total: number; completed: number; currentUrl: string };
      setProgress(d);
    });
    return () => {
      window.api.removeAllListeners('ai:analyze-progress');
    };
  }, []);

  const handleAnalyze = async () => {
    if (!crawlId) {
      showToast('No crawl selected', 'warning');
      return;
    }
    setAnalyzing(true);
    setProgress(null);

    const result = await window.api.aiAnalyze(crawlId);
    setAnalyzing(false);

    if (result.success) {
      showToast(`AI analysis complete: ${result.total} pages analyzed`, 'success');
      // Load results for all pages
      await loadAllResults();
    } else {
      showToast(`AI analysis failed: ${result.error}`, 'error');
    }
  };

  const handleAnalyzePage = async (page: PageData) => {
    setAnalyzingPage(page.id);
    const result = await window.api.aiAnalyzePage(page.id, {
      url: page.url,
      title: page.title,
      metaDescription: page.metaDescription,
      h1: page.h1,
      wordCount: page.wordCount,
      statusCode: page.statusCode,
      canonicalUrl: page.canonicalUrl,
      isIndexable: page.isIndexable,
    });
    setAnalyzingPage(null);

    if (result.success) {
      showToast(`Analysis complete for ${page.url}`, 'success');
      const res = await window.api.aiGetResults(page.id) as AIResult[];
      setResults(prev => {
        const next = new Map(prev);
        if (res.length > 0) next.set(page.id, res);
        return next;
      });
    } else {
      showToast(`Analysis failed: ${result.error}`, 'error');
    }
  };

  const loadAllResults = async () => {
    const map = new Map<string, AIResult[]>();
    for (const page of pages) {
      const res = await window.api.aiGetResults(page.id) as AIResult[];
      if (res.length > 0) {
        map.set(page.id, res);
      }
    }
    setResults(map);
  };

  useEffect(() => {
    if (pages.length > 0) {
      loadAllResults();
    }
  }, [pages]);

  const getScoreColor = (score: number): string => {
    if (score >= 7) return 'var(--accent-green)';
    if (score >= 4) return 'var(--accent-orange)';
    return 'var(--accent-red)';
  };

  const getPageScore = (pageId: string, type: 'content' | 'technical'): number | null => {
    const pageResults = results.get(pageId);
    if (!pageResults) return null;
    const result = pageResults.find(r => r.analysisType === type);
    return result ? result.score : null;
  };

  const getPageInsights = (pageId: string, type: 'content' | 'technical'): Record<string, unknown> | null => {
    const pageResults = results.get(pageId);
    if (!pageResults) return null;
    const result = pageResults.find(r => r.analysisType === type);
    if (!result) return null;
    try {
      return JSON.parse(result.insightsJson);
    } catch {
      return null;
    }
  };

  const selectedInsights = selectedPage ? {
    content: getPageInsights(selectedPage, 'content'),
    technical: getPageInsights(selectedPage, 'technical'),
  } : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{
        padding: '8px 12px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
          🤖 AI Insights
        </span>
        <button
          className="btn-primary"
          disabled={analyzing || !crawlId || pages.length === 0}
          onClick={handleAnalyze}
          style={{ fontSize: 11, padding: '4px 10px' }}
        >
          {analyzing ? 'Analyzing...' : 'Analyze All Pages'}
        </button>
        {progress && (
          <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
            {progress.completed}/{progress.total} pages
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Page list with scores */}
        <div style={{ width: 320, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
          {pages.map(page => {
            const contentScore = getPageScore(page.id, 'content');
            const techScore = getPageScore(page.id, 'technical');
            const isSelected = selectedPage === page.id;
            const hasResults = contentScore !== null || techScore !== null;
            const isAnalyzingThis = analyzingPage === page.id;

            return (
              <div
                key={page.id}
                onClick={() => setSelectedPage(page.id)}
                style={{
                  padding: '6px 10px', borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', fontSize: 11,
                  background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                    {page.url}
                  </div>
                  {!hasResults && !isAnalyzingThis && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAnalyzePage(page); }}
                      disabled={analyzing}
                      style={{
                        fontSize: 10, padding: '2px 6px', cursor: 'pointer', flexShrink: 0,
                        border: '1px solid var(--border)', borderRadius: 3,
                        background: 'var(--bg-secondary)', color: 'var(--text-secondary)',
                      }}
                      title="Analyze this page"
                    >
                      Analyze
                    </button>
                  )}
                  {isAnalyzingThis && (
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>⏳</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 2 }}>
                  {contentScore !== null ? (
                    <span style={{ color: getScoreColor(contentScore) }}>
                      Content: {contentScore}/10
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Content: —</span>
                  )}
                  {techScore !== null ? (
                    <span style={{ color: getScoreColor(techScore) }}>
                      Technical: {techScore}/10
                    </span>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>Technical: —</span>
                  )}
                </div>
              </div>
            );
          })}
          {pages.length === 0 && (
            <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
              No pages crawled yet
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
          {selectedInsights ? (
            <div>
              {selectedInsights.content && (
                <InsightSection title="Content Quality" data={selectedInsights.content} />
              )}
              {selectedInsights.technical && (
                <InsightSection title="Technical SEO" data={selectedInsights.technical} />
              )}
              {!selectedInsights.content && !selectedInsights.technical && selectedPage && (
                <div style={{ textAlign: 'center', marginTop: 40 }}>
                  <div style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>
                    No AI insights yet for this page
                  </div>
                  <button
                    onClick={() => {
                      const page = pages.find(p => p.id === selectedPage);
                      if (page) handleAnalyzePage(page);
                    }}
                    disabled={analyzing || analyzingPage !== null}
                    style={{
                      fontSize: 11, padding: '4px 10px', cursor: 'pointer',
                      border: '1px solid var(--border)', borderRadius: 3,
                      background: 'var(--bg-secondary)', color: 'var(--text-primary)',
                    }}
                  >
                    {analyzingPage === selectedPage ? 'Analyzing...' : 'Analyze This Page'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              {results.size === 0
                ? (
                  <div>
                    <div style={{ marginBottom: 6 }}>No AI analysis results yet.</div>
                    <div style={{ fontSize: 11 }}>Click &quot;Analyze All Pages&quot; to analyze everything,<br/>or click &quot;Analyze&quot; on individual pages.</div>
                    <div style={{ fontSize: 11, marginTop: 8, color: 'var(--text-muted)' }}>Requires an AI provider configured in Settings.</div>
                  </div>
                )
                : 'Select a page to view insights'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function InsightSection({ title, data }: { title: string; data: Record<string, unknown> }): React.ReactElement {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: '0 0 8px', color: 'var(--text-primary)', fontSize: 13 }}>{title}</h4>
      {Object.entries(data).map(([key, value]) => {
        if (key === 'score') return null;
        return (
          <div key={key} style={{ marginBottom: 6 }}>
            <span style={{ color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }}>
              {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}:
            </span>
            <div style={{ color: 'var(--text-primary)', fontSize: 12, marginTop: 2 }}>
              {typeof value === 'object' && value !== null
                ? JSON.stringify(value, null, 2)
                : String(value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
