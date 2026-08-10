import React, { useState, useEffect, useRef } from 'react';
import { AppSettings, AIProvider, CrawlSchedule, CrawlRecord, ScheduleDiffSummary } from '../../types/index';
import { applyTheme, getThemePref, type ThemePref } from '../lib/theme';

const SETTINGS_SECTIONS: { id: string; label: string }[] = [
  { id: 'appearance', label: '🎨 Appearance' },
  { id: 'bright-data', label: '☁️ Bright Data' },
  { id: 'browser-api', label: '🌐 Browser API' },
  { id: 'ai-provider', label: '🤖 AI provider' },
  { id: 'pagespeed', label: '📈 PageSpeed' },
  { id: 'schedules', label: '🕑 Scheduled crawls' },
  { id: 'saved-crawls', label: '🗄️ Saved crawls' },
];

interface Props {
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

const defaultSettings: AppSettings = {
  brightDataApiKey: null,
  brightDataZone: 'web_unlocker1',
  brightDataSerpZone: null,
  brightDataCustomerId: null,
  brightDataBrowserAuth: null,
  maxCostPerCrawl: 5.0,
  maxCostPerDay: 20.0,
  aiProvider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  openaiApiKey: null,
  openaiModel: 'gpt-4o-mini',
  anthropicApiKey: null,
  anthropicModel: 'claude-sonnet-4-20250514',
  geminiApiKey: null,
  geminiModel: 'gemini-2.0-flash',
  openrouterApiKey: null,
  openrouterModel: 'deepseek/deepseek-v4-flash',
  defaultEngine: 'local',
  defaultStorageMode: 'database',
  psiApiKey: null,
  crawlRetentionDays: 0,
};

const AI_PROVIDERS: { value: AIProvider; label: string; icon: string }[] = [
  { value: 'ollama', label: 'Ollama (Local)', icon: '🏠' },
  { value: 'openai', label: 'OpenAI', icon: '🟢' },
  { value: 'anthropic', label: 'Anthropic', icon: '🟠' },
  { value: 'gemini', label: 'Google Gemini', icon: '🔵' },
  { value: 'openrouter', label: 'OpenRouter', icon: '🔀' },
];

export default function Settings({ showToast }: Props): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingBd, setTestingBd] = useState(false);
  const [testingBdBrowser, setTestingBdBrowser] = useState(false);
  const [testingAI, setTestingAI] = useState(false);
  const [bdStatus, setBdStatus] = useState<'untested' | 'ok' | 'fail'>('untested');
  const [bdBrowserStatus, setBdBrowserStatus] = useState<'untested' | 'ok' | 'fail'>('untested');
  const [aiStatus, setAiStatus] = useState<'untested' | 'ok' | 'fail'>('untested');
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);
  const [showBdKey, setShowBdKey] = useState(false);
  const [showBdBrowserAuth, setShowBdBrowserAuth] = useState(false);
  const [showAiKey, setShowAiKey] = useState(false);
  const [themePref, setThemePref] = useState<ThemePref>(getThemePref);
  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await window.api.getSettings();
        setSettings(s as AppSettings);
      } catch {
        // use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Highlight the rail entry for whichever section is nearest the top of the
  // scroll area. Runs only once the form is rendered — the loading branch
  // returns before any section exists.
  useEffect(() => {
    if (loading) return;
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActiveSection(visible.target.id);
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const s of SETTINGS_SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [loading]);

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) =>
    setSettings(s => ({ ...s, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const result = await window.api.saveSettings(settings);
      if (result.success) showToast('Settings saved', 'success');
      else showToast(result.error ?? 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTestBd = async () => {
    if (!settings.brightDataApiKey) {
      showToast('Enter API key first', 'error');
      return;
    }
    setTestingBd(true);
    setBdStatus('untested');
    try {
      const result = await window.api.testBrightData(settings.brightDataApiKey, settings.brightDataZone ?? 'web_unlocker1');
      setBdStatus(result.success ? 'ok' : 'fail');
      showToast(result.success ? 'Bright Data connection OK!' : 'Bright Data connection failed', result.success ? 'success' : 'error');
    } finally {
      setTestingBd(false);
    }
  };

  const handleTestBdBrowser = async () => {
    if (!settings.brightDataBrowserAuth || !settings.brightDataBrowserAuth.includes(':')) {
      showToast('Enter Browser API credentials as USER:PASS', 'error');
      return;
    }
    setTestingBdBrowser(true);
    setBdBrowserStatus('untested');
    try {
      const result = await window.api.testBrightDataBrowser(settings.brightDataBrowserAuth);
      setBdBrowserStatus(result.success ? 'ok' : 'fail');
      showToast(result.success ? 'Browser API connection OK!' : 'Browser API connection failed', result.success ? 'success' : 'error');
    } finally {
      setTestingBdBrowser(false);
    }
  };

  const handleTestAI = async () => {
    const provider = settings.aiProvider ?? 'ollama';
    let config: { ollamaUrl?: string; apiKey?: string } = {};

    if (provider === 'ollama') {
      config = { ollamaUrl: settings.ollamaUrl ?? 'http://localhost:11434' };
    } else {
      const keyMap: Record<string, string | null | undefined> = {
        openai: settings.openaiApiKey,
        anthropic: settings.anthropicApiKey,
        gemini: settings.geminiApiKey,
        openrouter: settings.openrouterApiKey,
      };
      const key = keyMap[provider];
      if (!key) {
        showToast('Enter API key first', 'error');
        return;
      }
      config = { apiKey: key };
    }

    setTestingAI(true);
    setAiStatus('untested');
    try {
      const result = await window.api.testAIProvider(provider, config);
      setAiStatus(result.success ? 'ok' : 'fail');
      if (result.success) {
        const models = (result.models ?? []) as string[];
        setDiscoveredModels(models);
        showToast(`${AI_PROVIDERS.find(p => p.value === provider)?.label} OK — ${models.length} model(s) available`, 'success');
      } else {
        setDiscoveredModels([]);
        showToast(`${AI_PROVIDERS.find(p => p.value === provider)?.label} connection failed`, 'error');
      }
    } finally {
      setTestingAI(false);
    }
  };

  const statusBadge = (s: 'untested' | 'ok' | 'fail') => {
    if (s === 'ok') return <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>● Connected</span>;
    if (s === 'fail') return <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>● Failed</span>;
    return null;
  };

  // Determine which model field key corresponds to the selected provider
  const modelFieldKey = (): keyof AppSettings => {
    switch (settings.aiProvider) {
      case 'openai': return 'openaiModel';
      case 'anthropic': return 'anthropicModel';
      case 'gemini': return 'geminiModel';
      case 'openrouter': return 'openrouterModel';
      default: return 'ollamaModel';
    }
  };

  const currentModel = (): string => {
    return (settings[modelFieldKey()] as string) ?? '';
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  );

  const selectedProvider = settings.aiProvider ?? 'ollama';
  const isCloudProvider = selectedProvider !== 'ollama';

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      {/* Section rail — the settings column is long enough that scrolling
          blind was the only way to find anything. */}
      <nav className="settings-nav">
        {SETTINGS_SECTIONS.map(s => (
          <button
            key={s.id}
            className={activeSection === s.id ? 'active' : ''}
            onClick={() => {
              setActiveSection(s.id);
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 24, fontSize: 16, fontWeight: 700 }}>Settings</h2>

      {/* Appearance */}
      <section id="appearance" style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14 }}>
          🎨 Appearance
        </h3>
        <label className="label">Theme</label>
        <div className="toggle" style={{ maxWidth: 300 }}>
          {(['system', 'light', 'dark'] as ThemePref[]).map(p => (
            <div
              key={p}
              className={`toggle-option${themePref === p ? ' active' : ''}`}
              onClick={() => { applyTheme(p); setThemePref(p); }}
            >
              {p === 'system' ? 'System' : p === 'light' ? 'Light' : 'Dark'}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
          Stored locally on this machine, separate from the credentials below.
        </p>
      </section>

      {/* Bright Data section */}
      <section id="bright-data" style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          ☁️ Bright Data Web Unlocker
          {statusBadge(bdStatus)}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">API Key</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type={showBdKey ? 'text' : 'password'}
                placeholder="Bearer token from Bright Data console"
                value={settings.brightDataApiKey ?? ''}
                onChange={e => set('brightDataApiKey', e.target.value)}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button className="btn-ghost" onClick={() => setShowBdKey(v => !v)} style={{ fontSize: 12, padding: '0 10px' }}>
                {showBdKey ? '🙈' : '👁'}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Zone Name</label>
            <input
              className="input"
              type="text"
              placeholder="web_unlocker1"
              value={settings.brightDataZone ?? 'web_unlocker1'}
              onChange={e => set('brightDataZone', e.target.value)}
            />
          </div>
          <div>
            <label className="label">SERP Zone Name <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(required for SERP analysis)</span></label>
            <input
              className="input"
              type="text"
              placeholder="serp_api1"
              value={settings.brightDataSerpZone ?? ''}
              onChange={e => set('brightDataSerpZone', e.target.value)}
            />
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Must be a SERP API zone. The Web Unlocker zone above cannot answer SERP queries.
            </p>
          </div>
          <div>
            <label className="label">Customer ID <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(for proxy mode redirect tracking)</span></label>
            <input
              className="input"
              type="text"
              placeholder="hl_xxxxxxxx"
              value={settings.brightDataCustomerId ?? ''}
              onChange={e => set('brightDataCustomerId', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Default Cost Limit (USD)</label>
            <input
              className="input"
              type="number"
              min={0.1}
              step={0.5}
              value={settings.maxCostPerCrawl}
              onChange={e => set('maxCostPerCrawl', Number(e.target.value))}
            />
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Crawl will pause when spend exceeds this limit
            </p>
          </div>
          <button
            className="btn-ghost"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={handleTestBd}
            disabled={testingBd}
          >
            {testingBd ? <><span className="spinner" /> Testing…</> : '🔌 Test Connection'}
          </button>
        </div>
      </section>

      {/* Bright Data Browser API section */}
      <section id="browser-api" style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          🌐 Bright Data Browser API (JS rendering)
          {statusBadge(bdBrowserStatus)}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">Credentials (USER:PASS)</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="input"
                type={showBdBrowserAuth ? 'text' : 'password'}
                placeholder="brd-customer-...-zone-...:password"
                value={settings.brightDataBrowserAuth ?? ''}
                onChange={e => set('brightDataBrowserAuth', e.target.value)}
                style={{ flex: 1, fontFamily: 'monospace' }}
              />
              <button className="btn-ghost" onClick={() => setShowBdBrowserAuth(v => !v)} style={{ fontSize: 12, padding: '0 10px' }}>
                {showBdBrowserAuth ? '🙈' : '👁'}
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              From your Browser API zone's Overview tab. Renders JS/SPA sites · ~$8/GB
            </p>
          </div>
          <button
            className="btn-ghost"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={handleTestBdBrowser}
            disabled={testingBdBrowser}
          >
            {testingBdBrowser ? <><span className="spinner" /> Testing…</> : '🔌 Test Connection'}
          </button>
        </div>
      </section>

      {/* AI Provider section */}
      <section id="ai-provider" style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          🤖 AI Analysis Provider
          {statusBadge(aiStatus)}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Provider selector */}
          <div>
            <label className="label">Provider</label>
            <select
              className="input"
              value={selectedProvider}
              onChange={e => {
                set('aiProvider', e.target.value as AIProvider);
                setAiStatus('untested');
                setDiscoveredModels([]);
              }}
              style={{ cursor: 'pointer' }}
            >
              {AI_PROVIDERS.map(p => (
                <option key={p.value} value={p.value}>{p.icon} {p.label}</option>
              ))}
            </select>
          </div>

          {/* Ollama-specific: URL */}
          {selectedProvider === 'ollama' && (
            <div>
              <label className="label">Ollama URL</label>
              <input
                className="input"
                type="url"
                placeholder="http://localhost:11434"
                value={settings.ollamaUrl ?? 'http://localhost:11434'}
                onChange={e => set('ollamaUrl', e.target.value)}
              />
              <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Run <code style={{ color: 'var(--text-secondary)' }}>ollama serve</code> locally.
                Download models: <code style={{ color: 'var(--text-secondary)' }}>ollama pull llama3</code>
              </p>
            </div>
          )}

          {/* Cloud providers: API Key */}
          {isCloudProvider && (
            <div>
              <label className="label">
                {AI_PROVIDERS.find(p => p.value === selectedProvider)?.label} API Key
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  type={showAiKey ? 'text' : 'password'}
                  placeholder={`Enter your ${selectedProvider} API key`}
                  value={
                    selectedProvider === 'openai' ? (settings.openaiApiKey ?? '') :
                    selectedProvider === 'anthropic' ? (settings.anthropicApiKey ?? '') :
                    selectedProvider === 'openrouter' ? (settings.openrouterApiKey ?? '') :
                    (settings.geminiApiKey ?? '')
                  }
                  onChange={e => {
                    const key = selectedProvider === 'openai' ? 'openaiApiKey' :
                                selectedProvider === 'anthropic' ? 'anthropicApiKey' :
                                selectedProvider === 'openrouter' ? 'openrouterApiKey' : 'geminiApiKey';
                    set(key, e.target.value);
                  }}
                  style={{ flex: 1, fontFamily: 'monospace' }}
                />
                <button className="btn-ghost" onClick={() => setShowAiKey(v => !v)} style={{ fontSize: 12, padding: '0 10px' }}>
                  {showAiKey ? '🙈' : '👁'}
                </button>
              </div>
            </div>
          )}

          {/* Model selection */}
          <div>
            <label className="label">Model</label>
            {discoveredModels.length > 0 ? (
              <select
                className="input"
                value={currentModel()}
                onChange={e => set(modelFieldKey(), e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                {discoveredModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type="text"
                placeholder={
                  selectedProvider === 'ollama' ? 'llama3' :
                  selectedProvider === 'openai' ? 'gpt-4o-mini' :
                  selectedProvider === 'anthropic' ? 'claude-sonnet-4-20250514' :
                  selectedProvider === 'openrouter' ? 'openai/gpt-4o-mini' :
                  'gemini-2.0-flash'
                }
                value={currentModel()}
                onChange={e => set(modelFieldKey(), e.target.value)}
              />
            )}
            {discoveredModels.length > 0 && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                {discoveredModels.length} model(s) available
              </p>
            )}
          </div>

          {/* Test button */}
          <button
            className="btn-ghost"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={handleTestAI}
            disabled={testingAI}
          >
            {testingAI ? <><span className="spinner" /> Testing…</> : `🔌 Test ${AI_PROVIDERS.find(p => p.value === selectedProvider)?.label}`}
          </button>
        </div>
      </section>

      {/* PageSpeed Insights */}
      <section id="pagespeed" style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14 }}>
          📈 PageSpeed Insights (Core Web Vitals)
        </h3>
        <div>
          <label className="label">API Key <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(optional — free, raises quota to 25k/day)</span></label>
          <input
            className="input"
            data-testid="psi-api-key"
            type="password"
            placeholder="AIza… (from Google Cloud Console, PageSpeed Insights API)"
            value={settings.psiApiKey ?? ''}
            onChange={e => set('psiApiKey', e.target.value || null)}
            style={{ fontFamily: 'monospace' }}
          />
          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
            Without a key, CWV fetches are limited to a few URLs per run.
          </p>
        </div>
      </section>

      {/* Scheduled crawls */}
      <ScheduledCrawlsSection showToast={showToast} />

      {/* Saved crawls / retention */}
      <CrawlRetentionSection
        showToast={showToast}
        retentionDays={settings.crawlRetentionDays ?? 0}
        onRetentionChange={days => set('crawlRetentionDays', days)}
      />

          </div>
        </div>

        {/* Pinned — Save was previously stranded below ~1600px of scroll */}
        <div className="panel-footer" style={{ justifyContent: 'flex-end' }}>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ minWidth: 140 }}
          >
            {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Scheduled crawls ─────────────────────────────────────────────────────────

function ScheduledCrawlsSection({ showToast }: Props): React.ReactElement {
  const [schedules, setSchedules] = useState<CrawlSchedule[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [intervalHours, setIntervalHours] = useState(24);
  const [autoCompare, setAutoCompare] = useState(false);
  const [adding, setAdding] = useState(false);

  const refresh = async () => {
    try {
      setSchedules(await window.api.scheduleList());
    } catch { /* main not ready */ }
  };

  useEffect(() => { refresh(); }, []);

  // Scheduled crawls fire and finish while this panel is already mounted, so
  // without these the list keeps showing pre-run state (no next-run time, no
  // auto-compare result) until the user navigates away and back.
  useEffect(() => {
    window.api.onScheduleTriggered(() => { refresh(); });
    window.api.onScheduleCompared(() => { refresh(); });
    return () => {
      window.api.removeAllListeners('schedule:triggered');
      window.api.removeAllListeners('schedule:compared');
    };
  }, []);

  const handleAdd = async () => {
    if (!url.trim()) { showToast('Enter a URL to schedule', 'error'); return; }
    setAdding(true);
    try {
      const result = await window.api.scheduleAdd({ name: name.trim(), startUrl: url.trim(), intervalHours, autoCompare });
      if (result.success) {
        showToast('Schedule added', 'success');
        setName(''); setUrl(''); setAutoCompare(false);
        await refresh();
      } else {
        showToast(result.error ?? 'Failed to add schedule', 'error');
      }
    } finally {
      setAdding(false);
    }
  };

  const fmtInterval = (h: number) => h >= 1 ? `${h % 1 === 0 ? h : h.toFixed(2)} h` : `${Math.round(h * 60)} min`;
  const fmtTime = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';

  const fmtDiff = (json: string | null): string | null => {
    if (!json) return null;
    try {
      const d = JSON.parse(json) as ScheduleDiffSummary;
      return `${d.added} new · ${d.removed} removed · ${d.changed} changed`;
    } catch {
      return null;
    }
  };

  return (
    <section id="schedules" data-testid="schedules-section" style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14 }}>
        🕑 Scheduled Crawls
      </h3>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        Recurring local crawls that run while Serpent is open.
      </p>

      {schedules.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
          {schedules.map(s => (
            <div key={s.id} data-testid="schedule-row" style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
              border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 11,
            }}>
              <label className="check-row" style={{ margin: 0 }} title={s.enabled ? 'Enabled' : 'Disabled'}>
                <input
                  type="checkbox"
                  checked={s.enabled}
                  onChange={async e => { await window.api.scheduleToggle(s.id, e.target.checked); await refresh(); }}
                />
              </label>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.name}
                  {s.autoCompare && (
                    <span
                      title="Each run is diffed against the previous crawl from this schedule"
                      style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 4, background: 'var(--tint-blue)', color: 'var(--accent-blue)', fontWeight: 600 }}
                    >AUTO-COMPARE</span>
                  )}
                </div>
                <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {s.startUrl} · every {fmtInterval(s.intervalHours)} · next: {fmtTime(s.nextRun)}
                </div>
                {fmtDiff(s.lastDiffJson) && (
                  <div data-testid="schedule-diff" style={{ color: 'var(--accent-blue)', fontSize: 10, marginTop: 2 }}>
                    Last change: {fmtDiff(s.lastDiffJson)}
                  </div>
                )}
              </div>
              <button
                className="btn-ghost"
                style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent-red)' }}
                onClick={async () => { await window.api.scheduleDelete(s.id); await refresh(); }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 90px', gap: 6 }}>
          <input
            className="input"
            data-testid="schedule-name"
            placeholder="Name (optional)"
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            className="input"
            data-testid="schedule-url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />
          <input
            className="input"
            data-testid="schedule-interval"
            type="number"
            min={0.01}
            step={1}
            title="Interval (hours)"
            value={intervalHours}
            onChange={e => setIntervalHours(Number(e.target.value))}
          />
        </div>
        <label className="check-row" style={{ fontSize: 11, margin: 0 }}>
          <input
            type="checkbox"
            data-testid="schedule-auto-compare"
            checked={autoCompare}
            onChange={e => setAutoCompare(e.target.checked)}
          />
          Auto-compare each run against the previous crawl
        </label>
        <button
          className="btn-ghost"
          data-testid="schedule-add"
          style={{ alignSelf: 'flex-start', fontSize: 12 }}
          onClick={handleAdd}
          disabled={adding}
        >
          {adding ? '⏳ Adding…' : '+ Add Schedule'}
        </button>
      </div>
    </section>
  );
}

// ─── Saved crawls / retention ─────────────────────────────────────────────────

const RETENTION_OPTIONS = [
  { value: 0, label: 'Never delete' },
  { value: 30, label: 'Delete after 30 days' },
  { value: 60, label: 'Delete after 60 days' },
  { value: 90, label: 'Delete after 90 days' },
];

interface RetentionProps extends Props {
  retentionDays: number;
  onRetentionChange: (days: number) => void;
}

function CrawlRetentionSection({ showToast, retentionDays, onRetentionChange }: RetentionProps): React.ReactElement {
  const [crawls, setCrawls] = useState<CrawlRecord[]>([]);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setCrawls(await window.api.getCrawls());
    } catch { /* main not ready */ }
  };

  useEffect(() => { refresh(); }, []);

  const toggleLock = async (c: CrawlRecord) => {
    await window.api.setCrawlLocked(c.id, !c.locked);
    await refresh();
  };

  const remove = async (c: CrawlRecord) => {
    // Two-step: the first click arms, the second deletes. Avoids a modal
    // dialog, which would block the Electron renderer during e2e runs.
    if (confirmId !== c.id) { setConfirmId(c.id); return; }
    setConfirmId(null);
    const res = await window.api.deleteCrawl(c.id);
    showToast(res.success ? 'Crawl deleted' : (res.error ?? 'Delete failed'), res.success ? 'success' : 'error');
    await refresh();
  };

  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

  return (
    <section id="saved-crawls" data-testid="retention-section" style={{ marginBottom: 28 }}>
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14 }}>
        🗄️ Saved Crawls
      </h3>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 10px' }}>
        Crawls are kept forever by default. Locked crawls are never auto-deleted.
      </p>

      <div className="form-group" style={{ marginBottom: 12 }}>
        <label>Retention</label>
        <select
          className="input"
          data-testid="retention-select"
          value={retentionDays}
          onChange={e => onRetentionChange(Number(e.target.value))}
        >
          {RETENTION_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
          Applied on save and once a day. Running and paused crawls are never deleted.
        </p>
      </div>

      {crawls.length === 0 ? (
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>No saved crawls yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
          {crawls.map(c => (
            <div key={c.id} data-testid="crawl-row" style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '6px 10px',
              border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-secondary)', fontSize: 11,
            }}>
              <button
                className="btn-ghost"
                data-testid="crawl-lock"
                title={c.locked ? 'Locked — exempt from retention' : 'Unlocked'}
                style={{ padding: '2px 6px', fontSize: 13 }}
                onClick={() => toggleLock(c)}
              >
                {c.locked ? '🔒' : '🔓'}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.startUrl}</div>
                <div style={{ color: 'var(--text-muted)' }}>
                  {fmtDate(c.startTime)} · {c.completedUrls} URLs · {c.status}
                </div>
              </div>
              <button
                className="btn-ghost"
                data-testid="crawl-delete"
                style={{ padding: '2px 8px', fontSize: 11, color: 'var(--accent-red)' }}
                onClick={() => remove(c)}
              >
                {confirmId === c.id ? 'Confirm?' : '✕'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
