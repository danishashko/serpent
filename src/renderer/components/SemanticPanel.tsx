import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  EmbeddingProvider,
  EmbeddingTarget,
  EmbeddingStatus,
  SemanticAnalysis,
  SemanticResult,
  SemanticNeighbourRow,
} from '../../types/index';

interface Props {
  crawlId: string | null;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

const PROVIDERS: { value: EmbeddingProvider; label: string; model: string }[] = [
  { value: 'gemini', label: 'Google Gemini', model: 'gemini-embedding-001' },
  { value: 'openai', label: 'OpenAI', model: 'text-embedding-3-small' },
  { value: 'ollama', label: 'Ollama (local)', model: 'nomic-embed-text' },
];

type View = 'similar' | 'relevance' | 'search';

export default function SemanticPanel({ crawlId, showToast }: Props): React.ReactElement {
  const [status, setStatus] = useState<EmbeddingStatus | null>(null);
  const [provider, setProvider] = useState<EmbeddingProvider>('gemini');
  const [model, setModel] = useState(PROVIDERS[0].model);
  const [target, setTarget] = useState<EmbeddingTarget>('text');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [analysis, setAnalysis] = useState<SemanticAnalysis | null>(null);
  const [view, setView] = useState<View>('similar');
  const [threshold, setThreshold] = useState(0.95);
  const [relevanceThreshold, setRelevanceThreshold] = useState(0.7);
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SemanticNeighbourRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!crawlId) return;
    try {
      setStatus(await window.api.embeddingsStatus(crawlId));
    } catch { /* main not ready */ }
  }, [crawlId]);

  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    window.api.onEmbeddingsProgress(data => {
      if (data.crawlId === crawlId) setProgress({ done: data.done, total: data.total });
    });
    return () => window.api.removeAllListeners('embeddings:progress');
  }, [crawlId]);

  // Default to titles when the crawl has no stored body text — embedding
  // fallback text would otherwise silently produce a much weaker analysis.
  useEffect(() => {
    if (status && !status.hasBodyText) setTarget('title');
  }, [status?.hasBodyText]);

  const runAnalysis = useCallback(async (t = threshold, r = relevanceThreshold) => {
    if (!crawlId) return;
    const result = await window.api.semanticAnalyze({
      crawlId,
      similarityThreshold: t,
      relevanceThreshold: r,
    });
    setAnalysis(result);
  }, [crawlId, threshold, relevanceThreshold]);

  useEffect(() => {
    if (status && status.embedded > 0) runAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.embedded]);

  const handleGenerate = async () => {
    if (!crawlId) return;
    setRunning(true);
    setProgress(null);
    try {
      const res = await window.api.embeddingsGenerate({ crawlId, provider, model, target });
      if (res.success) {
        showToast(`Embedded ${res.embedded} pages`, 'success');
        await refreshStatus();
      } else {
        showToast(res.error ?? 'Embedding failed', 'error');
      }
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  const handleClear = async () => {
    if (!crawlId) return;
    await window.api.embeddingsClear(crawlId);
    setAnalysis(null);
    setSearchResults(null);
    await refreshStatus();
    showToast('Embeddings cleared', 'info');
  };

  const handleSearch = async () => {
    if (!crawlId || !query.trim()) return;
    setSearching(true);
    try {
      const res = await window.api.semanticSearch({ crawlId, query: query.trim() });
      if (res.success) setSearchResults(res.results ?? []);
      else showToast(res.error ?? 'Search failed', 'error');
    } finally {
      setSearching(false);
    }
  };

  const similarPages = useMemo(
    () => (analysis?.results ?? [])
      .filter(r => r.similarCount > 0)
      .sort((a, b) => b.closestScore - a.closestScore),
    [analysis],
  );

  const lowRelevance = useMemo(
    () => (analysis?.results ?? [])
      .filter(r => r.relevanceScore < (analysis?.relevanceThreshold ?? 0.7))
      .sort((a, b) => a.relevanceScore - b.relevanceScore),
    [analysis],
  );

  if (!crawlId) {
    return <div style={{ padding: 32, color: 'var(--text-muted)' }}>Run a crawl first.</div>;
  }

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div data-testid="semantic-panel" style={{ padding: 16, overflowY: 'auto' }}>
      {/* Generate */}
      <section style={{ marginBottom: 20, padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 10 }}>
          🧬 Embeddings
        </h3>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
          Embeddings capture meaning rather than wording, so they find pages covering the same subject
          in different words — and pages that sit far from what the rest of the site is about.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <select
            className="input"
            data-testid="embed-provider"
            value={provider}
            onChange={e => {
              const p = e.target.value as EmbeddingProvider;
              setProvider(p);
              setModel(PROVIDERS.find(x => x.value === p)!.model);
            }}
          >
            {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <input
            className="input"
            data-testid="embed-model"
            value={model}
            onChange={e => setModel(e.target.value)}
            title="Embedding model"
          />
          <select
            className="input"
            data-testid="embed-target"
            value={target}
            onChange={e => setTarget(e.target.value as EmbeddingTarget)}
          >
            <option value="text">Page text</option>
            <option value="title">Title + meta</option>
          </select>
        </div>

        {status && !status.hasBodyText && (
          <p data-testid="no-body-text-warning" style={{ fontSize: 10, color: 'var(--accent-orange)', margin: '0 0 8px' }}>
            This crawl did not store page text. Title + meta still works; for full-text analysis,
            re-crawl with “Store page text for embeddings” enabled.
          </p>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="btn-primary" data-testid="embed-run" onClick={handleGenerate} disabled={running}>
            {running ? <><span className="spinner" /> Embedding…</> : '⚡ Generate Embeddings'}
          </button>
          {status && status.embedded > 0 && (
            <button className="btn-ghost" data-testid="embed-clear" onClick={handleClear} style={{ fontSize: 11 }}>
              Clear
            </button>
          )}
          <span data-testid="embed-status" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {progress
              ? `${progress.done} / ${progress.total}`
              : status
                ? `${status.embedded} of ${status.totalPages} pages embedded${status.model ? ` · ${status.model}` : ''}`
                : '—'}
          </span>
        </div>
      </section>

      {analysis && analysis.results.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            {(['similar', 'relevance', 'search'] as View[]).map(v => (
              <button
                key={v}
                className={view === v ? 'btn-primary' : 'btn-ghost'}
                data-testid={`semantic-view-${v}`}
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => setView(v)}
              >
                {v === 'similar' && `Semantically Similar (${similarPages.length})`}
                {v === 'relevance' && `Low Relevance (${lowRelevance.length})`}
                {v === 'search' && 'Semantic Search'}
              </button>
            ))}
            {analysis.representativeUrl && (
              <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                Most representative page: <span style={{ color: 'var(--accent-blue)' }}>{analysis.representativeUrl}</span>
              </span>
            )}
          </div>

          {view === 'similar' && (
            <>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                Similarity threshold: <b>{threshold.toFixed(2)}</b>
                <input
                  type="range"
                  data-testid="similarity-threshold"
                  min={0.5}
                  max={0.99}
                  step={0.01}
                  value={threshold}
                  onChange={e => {
                    const t = Number(e.target.value);
                    setThreshold(t);
                    runAnalysis(t, relevanceThreshold);
                  }}
                  style={{ width: 200, marginLeft: 10, verticalAlign: 'middle' }}
                />
              </label>
              <SimilarTable rows={similarPages} pct={pct} />
            </>
          )}

          {view === 'relevance' && (
            <>
              <label style={{ fontSize: 11, color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
                Relevance floor: <b>{relevanceThreshold.toFixed(2)}</b>
                <input
                  type="range"
                  data-testid="relevance-threshold"
                  min={0.1}
                  max={0.95}
                  step={0.01}
                  value={relevanceThreshold}
                  onChange={e => {
                    const r = Number(e.target.value);
                    setRelevanceThreshold(r);
                    runAnalysis(threshold, r);
                  }}
                  style={{ width: 200, marginLeft: 10, verticalAlign: 'middle' }}
                />
              </label>
              <table className="data-table">
                <thead><tr><th>URL</th><th>Relevance to site</th></tr></thead>
                <tbody>
                  {lowRelevance.length === 0 ? (
                    <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      No outliers below this threshold.
                    </td></tr>
                  ) : lowRelevance.map(r => (
                    <tr key={r.url} data-testid="relevance-row">
                      <td><a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.url}</a></td>
                      <td style={{ color: 'var(--accent-orange)', fontWeight: 600 }}>{pct(r.relevanceScore)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {view === 'search' && (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="input"
                  data-testid="semantic-query"
                  placeholder="Describe what you're looking for…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                />
                <button className="btn-primary" data-testid="semantic-search-run" onClick={handleSearch} disabled={searching}>
                  {searching ? <span className="spinner" /> : 'Search'}
                </button>
              </div>
              <table className="data-table">
                <thead><tr><th>URL</th><th>Relevance</th></tr></thead>
                <tbody>
                  {!searchResults ? (
                    <tr><td colSpan={2} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
                      Ranks pages by meaning, not keyword matching.
                    </td></tr>
                  ) : searchResults.map(r => (
                    <tr key={r.url} data-testid="search-row">
                      <td><a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.url}</a></td>
                      <td style={{ fontWeight: 600 }}>{pct(r.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

function SimilarTable({ rows, pct }: { rows: SemanticResult[]; pct: (n: number) => string }): React.ReactElement {
  return (
    <table className="data-table">
      <thead>
        <tr><th>URL</th><th>Closest Match</th><th>Similarity</th><th>Similar Pages</th></tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 24 }}>
            No pages meet this similarity threshold.
          </td></tr>
        ) : rows.map(r => (
          <tr key={r.url} data-testid="similar-row">
            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{r.url}</a>
            </td>
            <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.closestUrl ?? '—'}
            </td>
            <td style={{ fontWeight: 600, color: r.closestScore >= 0.95 ? 'var(--accent-orange)' : 'var(--text-primary)' }}>
              {pct(r.closestScore)}
            </td>
            <td>{r.similarCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
