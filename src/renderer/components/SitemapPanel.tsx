import React, { useMemo, useState } from 'react';
import { PageData, SitemapAnalysisResult } from '../../types/index';

interface Props {
  crawlId: string | null;
  pages: PageData[];
}

export default function SitemapPanel({ crawlId, pages }: Props): React.ReactElement {
  const origin = useMemo(() => {
    for (const p of pages) {
      try {
        const u = new URL(p.url);
        return `${u.protocol}//${u.host}`;
      } catch { /* skip */ }
    }
    return '';
  }, [pages]);

  // ── Generate
  const [genBusy, setGenBusy] = useState(false);
  const [genStatus, setGenStatus] = useState<string | null>(null);
  const [genFiles, setGenFiles] = useState<{ filename: string; urlCount: number }[] | null>(null);
  const [changefreq, setChangefreq] = useState<string>('');
  const [priority, setPriority] = useState<string>('');

  const handleGenerate = async (): Promise<void> => {
    if (!crawlId || !origin) return;
    setGenBusy(true);
    setGenStatus(null);
    setGenFiles(null);
    try {
      const opts = {
        crawlId,
        origin,
        defaultChangefreq: (changefreq || undefined) as
          'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never' | undefined,
        defaultPriority: priority ? Number(priority) : undefined,
      };
      const r = await window.api.generateSitemap(opts);
      if (r.canceled) {
        setGenStatus('Cancelled.');
      } else if (r.ok) {
        setGenFiles(r.files ?? []);
        setGenStatus(`✓ Wrote ${r.totalUrls ?? 0} URLs across ${r.files?.length ?? 0} file(s).`);
      } else {
        setGenStatus(`✗ ${r.error ?? 'Failed.'}`);
      }
    } finally {
      setGenBusy(false);
    }
  };

  // ── Analyze
  const [sitemapUrl, setSitemapUrl] = useState<string>(origin ? `${origin}/sitemap.xml` : '');
  const [anaBusy, setAnaBusy] = useState(false);
  const [anaResult, setAnaResult] = useState<SitemapAnalysisResult | null>(null);

  const handleAnalyze = async (): Promise<void> => {
    if (!crawlId || !sitemapUrl.trim()) return;
    setAnaBusy(true);
    setAnaResult(null);
    try {
      const r = await window.api.analyzeSitemap({ crawlId, sitemapUrl: sitemapUrl.trim() });
      setAnaResult(r);
    } finally {
      setAnaBusy(false);
    }
  };

  if (!crawlId) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: 'var(--text-muted)' }}>
        Run or load a crawl to use the sitemap tools.
      </div>
    );
  }

  return (
    <div data-testid="sitemap-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* ── Generate ── */}
      <section
        style={{
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg-secondary)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>Generate XML Sitemap</h3>
        <p style={{ margin: '4px 0 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Builds a sitemap from indexable HTTP-200 URLs in this crawl. Origin: <code>{origin || '(unknown)'}</code>.
          A sitemap-index will be emitted automatically for crawls over 50,000 URLs.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <label className="label" style={{ display: 'block' }}>changefreq (optional)</label>
            <select className="input" value={changefreq} onChange={(e) => setChangefreq(e.target.value)}>
              <option value="">(omit)</option>
              <option value="always">always</option>
              <option value="hourly">hourly</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="monthly">monthly</option>
              <option value="yearly">yearly</option>
              <option value="never">never</option>
            </select>
          </div>
          <div>
            <label className="label" style={{ display: 'block' }}>priority (optional 0.0–1.0)</label>
            <input
              className="input"
              type="number"
              min={0}
              max={1}
              step={0.1}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{ width: 110 }}
            />
          </div>
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={genBusy || !origin}
          >
            {genBusy ? 'Generating…' : 'Generate & Save'}
          </button>
        </div>
        {genStatus && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>{genStatus}</div>
        )}
        {genFiles && genFiles.length > 0 && (
          <ul style={{ marginTop: 8, paddingLeft: 20, fontSize: 11 }}>
            {genFiles.map((f) => (
              <li key={f.filename}><code>{f.filename}</code> — {f.urlCount} URLs</li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Analyze ── */}
      <section
        style={{
          padding: 14,
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--bg-secondary)',
        }}
      >
        <h3 style={{ margin: 0, fontSize: 14 }}>Analyze Existing Sitemap</h3>
        <p style={{ margin: '4px 0 10px', fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Fetch a sitemap (or sitemap-index, including <code>.xml.gz</code>) and diff its URLs against this crawl.
        </p>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            type="url"
            placeholder="https://example.com/sitemap.xml"
            value={sitemapUrl}
            onChange={(e) => setSitemapUrl(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="btn-primary"
            onClick={handleAnalyze}
            disabled={anaBusy || !sitemapUrl.trim()}
          >
            {anaBusy ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>

        {anaResult && (
          <div data-testid="sitemap-analysis-result" style={{ marginTop: 12, fontSize: 12 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <Stat label="In sitemap" value={anaResult.urlsInSitemap.length} />
              <Stat label="Not in sitemap" value={anaResult.notInSitemap.length} severity={anaResult.notInSitemap.length > 0 ? 'warn' : undefined} />
              <Stat label="Orphan in sitemap" value={anaResult.orphanFromSitemap.length} severity={anaResult.orphanFromSitemap.length > 0 ? 'warn' : undefined} />
              <Stat label="Non-indexable in sitemap" value={anaResult.nonIndexableInSitemap.length} severity={anaResult.nonIndexableInSitemap.length > 0 ? 'crit' : undefined} />
              <Stat label="Duplicates" value={anaResult.duplicateInSitemap.length} severity={anaResult.duplicateInSitemap.length > 0 ? 'crit' : undefined} />
              <Stat label="Sitemaps fetched" value={anaResult.fetchedSitemaps.length} />
            </div>

            <UrlList title="Crawled but missing from sitemap" urls={anaResult.notInSitemap} />
            <UrlList title="Listed in sitemap but never crawled" urls={anaResult.orphanFromSitemap} />
            <UrlList title="Listed but not indexable" urls={anaResult.nonIndexableInSitemap} />
            <UrlList title="Duplicates across child sitemaps" urls={anaResult.duplicateInSitemap} />

            {anaResult.errors.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <strong style={{ fontSize: 11, color: '#f85149' }}>Errors</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 11, color: 'var(--text-secondary)' }}>
                  {anaResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, severity }: { label: string; value: number; severity?: 'warn' | 'crit' }): React.ReactElement {
  const color = severity === 'crit' ? '#f85149' : severity === 'warn' ? '#d29922' : 'var(--text-primary)';
  return (
    <div style={{
      padding: '6px 10px',
      border: '1px solid var(--border)',
      borderRadius: 4,
      background: 'var(--bg-primary)',
      minWidth: 110,
    }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 16, color, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
    </div>
  );
}

function UrlList({ title, urls }: { title: string; urls: string[] }): React.ReactElement | null {
  if (urls.length === 0) return null;
  const [expanded, setExpanded] = React.useState(false);
  const visible = expanded ? urls : urls.slice(0, 25);
  return (
    <details
      open
      style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 4, padding: 8, background: 'var(--bg-primary)' }}
    >
      <summary style={{ fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--text-primary)' }}>
        {title} ({urls.length})
      </summary>
      <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, fontFamily: 'monospace', fontSize: 11 }}>
        {visible.map((u) => (
          <li key={u} style={{ padding: '2px 0', wordBreak: 'break-all', color: 'var(--text-secondary)' }}>{u}</li>
        ))}
      </ul>
      {urls.length > visible.length && (
        <button
          onClick={() => setExpanded(true)}
          className="btn-ghost"
          style={{ marginTop: 6, fontSize: 11 }}
        >
          Show all {urls.length}
        </button>
      )}
    </details>
  );
}
