import React, { useState, useEffect } from 'react';
import { CrawlConfig as CrawlConfigType, CrawlProgress } from '../../types/index';

interface Props {
  progress: CrawlProgress | null;
  onCrawlStart: (crawlId: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

type CrawlMode = 'spider' | 'list';
type CrawlEngine = 'local' | 'brightdata';

const defaultConfig: CrawlConfigType = {
  startUrl: '',
  mode: 'spider',
  engine: 'local',
  storageMode: 'database',
  maxUrls: 500,
  maxDepth: 5,
  concurrency: 5,
  respectRobots: true,
  followRedirects: true,
  restrictToSubdomain: false,
  timeout: 10000,
  extractTitles: true,
  extractMeta: true,
  extractHeadings: true,
  extractImages: true,
  extractLinks: true,
  extractCanonicals: true,
  maxCostUsd: 5.0,
  bdZone: 'web_unlocker1',
};

export default function CrawlConfig({ progress, onCrawlStart, showToast }: Props): React.ReactElement {
  const [config, setConfig] = useState<CrawlConfigType>(defaultConfig);
  const [listUrls, setListUrls] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (progress) {
      setIsRunning(progress.status === 'running');
      setIsPaused(progress.status === 'paused');
      if (progress.status === 'completed' || progress.status === 'error') {
        setIsRunning(false);
        setIsPaused(false);
      }
    }
  }, [progress]);

  const set = <K extends keyof CrawlConfigType>(key: K, value: CrawlConfigType[K]) =>
    setConfig(c => ({ ...c, [key]: value }));

  const handleStart = async () => {
    if (!config.startUrl && config.mode === 'spider') {
      showToast('Please enter a seed URL', 'error');
      return;
    }

    let finalConfig = { ...config };

    if (config.mode === 'list') {
      const urls = listUrls.split('\n').map(u => u.trim()).filter(Boolean);
      if (!urls.length) {
        showToast('Please enter at least one URL', 'error');
        return;
      }
      finalConfig = { ...finalConfig, startUrl: urls[0], urlList: urls };
    }

    try {
      const result = await window.api.crawlStart(finalConfig);
      if (result.success && result.crawlId) {
        onCrawlStart(result.crawlId);
        setIsRunning(true);
      } else {
        showToast(result.error ?? 'Failed to start crawl', 'error');
      }
    } catch (e) {
      showToast(String(e), 'error');
    }
  };

  const handlePauseResume = async () => {
    if (isPaused) {
      await window.api.crawlResume();
      setIsPaused(false);
      setIsRunning(true);
    } else {
      await window.api.crawlPause();
      setIsPaused(true);
      setIsRunning(false);
    }
  };

  const handleStop = async () => {
    await window.api.crawlStop();
    setIsRunning(false);
    setIsPaused(false);
  };

  const busy = isRunning || isPaused;

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 4, fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Mode</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['spider', 'list'] as CrawlMode[]).map(m => (
            <button
              key={m}
              className={`btn-icon ${config.mode === m ? 'active' : ''}`}
              style={{
                flex: 1,
                background: config.mode === m ? 'var(--accent-blue)' : 'var(--bg-secondary)',
                color: config.mode === m ? '#fff' : 'var(--text-secondary)',
                border: '1px solid ' + (config.mode === m ? 'var(--accent-blue)' : 'var(--border)'),
                borderRadius: 6,
                padding: '5px 0',
                fontSize: 12,
                fontWeight: config.mode === m ? 600 : 400,
                cursor: 'pointer',
              }}
              onClick={() => set('mode', m)}
              disabled={busy}
            >
              {m === 'spider' ? '🕷 Spider' : '📋 List'}
            </button>
          ))}
        </div>
      </div>

      {config.mode === 'spider' ? (
        <div>
          <label className="label">Seed URL</label>
          <input
            className="input"
            type="url"
            placeholder="https://example.com"
            value={config.startUrl}
            onChange={e => set('startUrl', e.target.value)}
            disabled={busy}
          />
        </div>
      ) : (
        <div>
          <label className="label">URLs (one per line)</label>
          <textarea
            className="input"
            rows={6}
            placeholder="https://example.com/page1&#10;https://example.com/page2"
            value={listUrls}
            onChange={e => setListUrls(e.target.value)}
            disabled={busy}
            style={{ resize: 'vertical', minHeight: 80, fontFamily: 'monospace', fontSize: 11 }}
          />
        </div>
      )}

      {/* Engine toggle */}
      <div>
        <label className="label" style={{ marginBottom: 6 }}>Crawl Engine</label>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['local', 'brightdata'] as CrawlEngine[]).map(e => (
            <button
              key={e}
              style={{
                flex: 1,
                padding: '6px 0',
                fontSize: 11,
                fontWeight: 500,
                border: '1px solid ' + (config.engine === e ? (e === 'brightdata' ? 'var(--accent-orange)' : 'var(--accent-green)') : 'var(--border)'),
                borderRadius: 6,
                background: config.engine === e ? (e === 'brightdata' ? 'rgba(255,140,50,0.12)' : 'rgba(46,213,115,0.12)') : 'var(--bg-secondary)',
                color: config.engine === e ? (e === 'brightdata' ? 'var(--accent-orange)' : 'var(--accent-green)') : 'var(--text-secondary)',
                cursor: 'pointer',
              }}
              onClick={() => set('engine', e)}
              disabled={busy}
            >
              {e === 'local' ? '🔧 Local' : '☁️ Bright Data'}
            </button>
          ))}
        </div>
        {config.engine === 'brightdata' && (
          <p style={{ fontSize: 10, color: 'var(--accent-orange)', marginTop: 4 }}>
            ~$1.00/1,000 pages · Set API key in Settings
          </p>
        )}
        {config.engine === 'local' && (
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Free · May fail on JS-heavy / bot-protected sites
          </p>
        )}
      </div>

      {/* Limits */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="label">Max URLs</label>
          <input
            className="input"
            type="number"
            min={1}
            max={100000}
            value={config.maxUrls}
            onChange={e => set('maxUrls', Number(e.target.value))}
            disabled={busy}
          />
        </div>
        <div>
          <label className="label">Max Depth</label>
          <input
            className="input"
            type="number"
            min={1}
            max={20}
            value={config.maxDepth}
            onChange={e => set('maxDepth', Number(e.target.value))}
            disabled={busy}
          />
        </div>
      </div>

      {config.engine === 'brightdata' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label className="label">Cost Limit ($)</label>
            <input
              className="input"
              type="number"
              min={0.01}
              step={0.5}
              value={config.maxCostUsd}
              onChange={e => set('maxCostUsd', Number(e.target.value))}
              disabled={busy}
            />
          </div>
          <div>
            <label className="label">BD Zone</label>
            <input
              className="input"
              type="text"
              value={config.bdZone ?? 'web_unlocker1'}
              onChange={e => set('bdZone', e.target.value)}
              disabled={busy}
            />
          </div>
        </div>
      )}

      {/* Extraction flags */}
      <div>
        <label className="label">Extract</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {[
            { key: 'extractMeta', label: 'Meta tags / Open Graph' },
            { key: 'extractLinks', label: 'Internal / External links' },
            { key: 'extractImages', label: 'Images' },
            { key: 'respectRobots', label: 'Respect robots.txt' },
          ].map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
              <input
                type="checkbox"
                checked={!!config[key as keyof CrawlConfigType]}
                onChange={e => set(key as keyof CrawlConfigType, e.target.checked as CrawlConfigType[keyof CrawlConfigType])}
                disabled={busy}
              />
              <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
            </label>
          ))}
        </div>
      </div>

      {/* JS rendering toggle (local engine only) */}
      {config.engine === 'local' && (
        <div style={{
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid ' + (config.jsRender ? 'var(--accent-blue)' : 'var(--border)'),
          background: config.jsRender ? 'rgba(76,133,255,0.07)' : 'var(--bg-secondary)',
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12 }}>
            <input
              type="checkbox"
              checked={!!config.jsRender}
              onChange={e => set('jsRender', e.target.checked)}
              disabled={busy}
            />
            <span style={{ fontWeight: 500, color: config.jsRender ? 'var(--accent-blue)' : 'var(--text-secondary)' }}>
              JS Rendering (Headless Chromium)
            </span>
          </label>
          <p style={{ margin: '4px 0 0 24px', fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.4 }}>
            Uses Electron's built-in Chromium to render JS-heavy pages.
            Slower (~1–2 s/page) but captures React/Vue/Angular content.
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8 }}>
        {!busy ? (
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleStart}>
            ▶ Start Crawl
          </button>
        ) : (
          <>
            <button className="btn-ghost" style={{ flex: 1 }} onClick={handlePauseResume}>
              {isPaused ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button className="btn-danger" style={{ flex: 1 }} onClick={handleStop}>
              ■ Stop
            </button>
          </>
        )}
      </div>
    </div>
  );
}
