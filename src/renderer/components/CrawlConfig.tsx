import React, { useState, useEffect } from 'react';
import { CrawlConfig as CrawlConfigType, CrawlProgress } from '../../types/index';

interface Props {
  progress: CrawlProgress | null;
  onCrawlStart: (crawlId: string) => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onUpgradeRequired?: () => void;
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

export default function CrawlConfig({ progress, onCrawlStart, showToast, onUpgradeRequired }: Props): React.ReactElement {
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

  const [isStarting, setIsStarting] = useState(false);

  const handleStart = async () => {
    if (isStarting) return;
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

    setIsStarting(true);
    try {
      const result = await window.api.crawlStart(finalConfig);
      if (result.success && result.crawlId) {
        onCrawlStart(result.crawlId);
        setIsRunning(true);
      } else if (result.requiresUpgrade) {
        onUpgradeRequired?.();
      } else {
        showToast(result.error ?? 'Failed to start crawl', 'error');
      }
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setIsStarting(false);
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
            { key: 'extractHreflang', label: 'Hreflang tags' },
            { key: 'respectRobots', label: 'Respect robots.txt' },
          ].map(({ key, label }) => (
            <label key={key} className="check-row">
              <input
                type="checkbox"
                checked={!!config[key as keyof CrawlConfigType]}
                onChange={e => set(key as keyof CrawlConfigType, e.target.checked as CrawlConfigType[keyof CrawlConfigType])}
                disabled={busy}
              />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Custom robots.txt + tester */}
      {config.respectRobots && (
        <CustomRobotsSection
          customRobotsTxt={config.customRobotsTxt ?? ''}
          robotsUserAgent={config.robotsUserAgent ?? 'Serpent'}
          startUrl={config.startUrl}
          busy={busy}
          onChangeBody={(v) => set('customRobotsTxt', v as CrawlConfigType['customRobotsTxt'])}
          onChangeUserAgent={(v) => set('robotsUserAgent', v as CrawlConfigType['robotsUserAgent'])}
        />
      )}

      {/* JS rendering toggle (local engine only) */}
      {config.engine === 'local' && (
        <div style={{
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid ' + (config.jsRender ? 'var(--accent-blue)' : 'var(--border)'),
          background: config.jsRender ? 'rgba(76,133,255,0.07)' : 'var(--bg-secondary)',
        }}>
          <label className="check-row">
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

      {/* Custom Extraction Rules */}
      <div>
        <label className="label">Custom Extraction Rules</label>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 6px' }}>
          Extract data from pages using CSS selectors
        </p>
        {(config.customExtractions ?? []).map((rule, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
            <input
              className="input"
              style={{ flex: 1, padding: '3px 6px', fontSize: 11 }}
              placeholder="Name"
              value={rule.name}
              onChange={e => {
                const rules = [...(config.customExtractions ?? [])];
                rules[i] = { ...rules[i], name: e.target.value };
                set('customExtractions', rules);
              }}
              disabled={busy}
            />
            <input
              className="input"
              style={{ flex: 2, padding: '3px 6px', fontSize: 11, fontFamily: 'monospace' }}
              placeholder="CSS selector (e.g. h2.price)"
              value={rule.selector}
              onChange={e => {
                const rules = [...(config.customExtractions ?? [])];
                rules[i] = { ...rules[i], selector: e.target.value };
                set('customExtractions', rules);
              }}
              disabled={busy}
            />
            <button
              className="btn-ghost"
              style={{ padding: '2px 6px', fontSize: 11, color: 'var(--accent-red)' }}
              onClick={() => {
                const rules = (config.customExtractions ?? []).filter((_, j) => j !== i);
                set('customExtractions', rules.length ? rules : undefined);
              }}
              disabled={busy}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          className="btn-ghost"
          style={{ fontSize: 11, padding: '3px 10px', marginTop: 2 }}
          onClick={() => {
            const rules = [...(config.customExtractions ?? []), { name: '', selector: '' }];
            set('customExtractions', rules);
          }}
          disabled={busy}
        >
          + Add Rule
        </button>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 8 }}>
        {!busy ? (
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleStart} disabled={isStarting}>
            {isStarting ? '⏳ Starting…' : '▶ Start Crawl'}
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

// ─── Custom robots.txt textarea + tester ──────────────────────────────────────

interface CustomRobotsProps {
  customRobotsTxt: string;
  robotsUserAgent: string;
  startUrl: string;
  busy: boolean;
  onChangeBody: (v: string) => void;
  onChangeUserAgent: (v: string) => void;
}

const COMMON_AGENTS = ['Serpent', '*', 'Googlebot', 'Googlebot-Mobile', 'Bingbot', 'GPTBot', 'ClaudeBot', 'PerplexityBot'];

function CustomRobotsSection(props: CustomRobotsProps): React.ReactElement {
  const { customRobotsTxt, robotsUserAgent, startUrl, busy, onChangeBody, onChangeUserAgent } = props;
  const [testUrl, setTestUrl] = useState<string>('');
  const [testUa, setTestUa] = useState<string>('Googlebot');
  const [result, setResult] = useState<{ allowed: boolean; matchedRule: string | null; appliedAgent: string } | null>(null);
  const [testing, setTesting] = useState<boolean>(false);

  useEffect(() => {
    if (!testUrl && startUrl) setTestUrl(startUrl);
  }, [startUrl, testUrl]);

  const runTest = async (): Promise<void> => {
    if (!customRobotsTxt.trim() || !testUrl.trim()) return;
    setTesting(true);
    try {
      const r = await window.api.testRobots({
        robotsTxt: customRobotsTxt,
        url: testUrl.trim(),
        userAgent: testUa,
      });
      setResult({ allowed: r.allowed, matchedRule: r.matchedRule, appliedAgent: r.appliedAgent });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{
      padding: 10,
      borderRadius: 6,
      border: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div>
        <label className="label">Custom robots.txt (overrides live fetch)</label>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', margin: '2px 0 4px' }}>
          Paste a robots.txt body to test rules without modifying the target site. Leave blank to fetch from /robots.txt.
        </p>
        <textarea
          value={customRobotsTxt}
          onChange={(e) => onChangeBody(e.target.value)}
          disabled={busy}
          rows={6}
          spellCheck={false}
          placeholder={'User-agent: *\nDisallow: /admin\nAllow: /public'}
          style={{
            width: '100%',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: 6,
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg-primary)',
            color: 'var(--text-primary)',
            resize: 'vertical',
            minHeight: 90,
          }}
        />
      </div>

      <div>
        <label className="label">Crawl as User-Agent</label>
        <select
          className="input"
          value={robotsUserAgent}
          onChange={(e) => onChangeUserAgent(e.target.value)}
          disabled={busy}
        >
          {COMMON_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      <details style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
        <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 500, color: 'var(--text-secondary)' }}>
          robots.txt tester
        </summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          <input
            className="input"
            type="url"
            placeholder="https://example.com/path"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
          />
          <select className="input" value={testUa} onChange={(e) => setTestUa(e.target.value)}>
            {COMMON_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <button
            className="btn-ghost"
            onClick={runTest}
            disabled={testing || !customRobotsTxt.trim() || !testUrl.trim()}
            style={{ alignSelf: 'flex-start' }}
          >
            {testing ? 'Testing…' : 'Test URL'}
          </button>
          {result && (
            <div
              role="status"
              data-testid="robots-test-result"
              style={{
                padding: 8,
                borderRadius: 4,
                background: result.allowed ? 'rgba(46,160,67,0.12)' : 'rgba(248,81,73,0.12)',
                border: '1px solid ' + (result.allowed ? 'rgba(46,160,67,0.4)' : 'rgba(248,81,73,0.4)'),
                fontSize: 11,
                lineHeight: 1.4,
              }}
            >
              <div style={{ fontWeight: 600 }}>
                {result.allowed ? '✓ Allowed' : '✗ Blocked'} for User-Agent <code>{result.appliedAgent}</code>
              </div>
              {result.matchedRule && (
                <div style={{ marginTop: 2, color: 'var(--text-secondary)' }}>
                  Matched: <code>{result.matchedRule}</code>
                </div>
              )}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}
