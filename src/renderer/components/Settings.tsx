import React, { useState, useEffect } from 'react';
import { AppSettings } from '../../types/index';

interface Props {
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

const defaultSettings: AppSettings = {
  brightDataApiKey: null,
  brightDataZone: 'web_unlocker1',
  maxCostPerCrawl: 5.0,
  maxCostPerDay: 20.0,
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3',
  defaultEngine: 'local',
  defaultStorageMode: 'database',
};

export default function Settings({ showToast }: Props): React.ReactElement {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingBd, setTestingBd] = useState(false);
  const [testingOllama, setTestingOllama] = useState(false);
  const [bdStatus, setBdStatus] = useState<'untested' | 'ok' | 'fail'>('untested');
  const [ollamaStatus, setOllamaStatus] = useState<'untested' | 'ok' | 'fail'>('untested');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [showBdKey, setShowBdKey] = useState(false);

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

  const handleTestOllama = async () => {
    setTestingOllama(true);
    setOllamaStatus('untested');
    try {
      const result = await window.api.testOllama(settings.ollamaUrl ?? 'http://localhost:11434');
      setOllamaStatus(result.success ? 'ok' : 'fail');
      if (result.success) {
        const models = (result.models as { name: string }[]).map(m => m.name);
        setOllamaModels(models);
        showToast(`Ollama OK — ${models.length} model(s) found`, 'success');
      } else {
        showToast('Ollama not reachable — is it running?', 'error');
      }
    } finally {
      setTestingOllama(false);
    }
  };

  const statusBadge = (s: 'untested' | 'ok' | 'fail') => {
    if (s === 'ok') return <span style={{ color: 'var(--accent-green)', fontSize: 11 }}>● Connected</span>;
    if (s === 'fail') return <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>● Failed</span>;
    return null;
  };

  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <span className="spinner" />
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: 24, maxWidth: 600 }}>
      <h2 style={{ marginBottom: 24, fontSize: 16, fontWeight: 700 }}>Settings</h2>

      {/* Bright Data section */}
      <section style={{ marginBottom: 28 }}>
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

      {/* Ollama section */}
      <section style={{ marginBottom: 28 }}>
        <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-secondary)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          🤖 Ollama (Local AI)
          {statusBadge(ollamaStatus)}
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="label">Ollama URL</label>
            <input
              className="input"
              type="url"
              placeholder="http://localhost:11434"
              value={settings.ollamaUrl ?? 'http://localhost:11434'}
              onChange={e => set('ollamaUrl', e.target.value)}
            />
          </div>
          <div>
            <label className="label">Default Model</label>
            {ollamaModels.length > 0 ? (
              <select
                className="input"
                value={settings.ollamaModel ?? 'llama3'}
                onChange={e => set('ollamaModel', e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                {ollamaModels.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            ) : (
              <input
                className="input"
                type="text"
                placeholder="llama3"
                value={settings.ollamaModel ?? 'llama3'}
                onChange={e => set('ollamaModel', e.target.value)}
              />
            )}
          </div>
          <button
            className="btn-ghost"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={handleTestOllama}
            disabled={testingOllama}
          >
            {testingOllama ? <><span className="spinner" /> Testing…</> : '🔌 Test Ollama'}
          </button>
          {ollamaModels.length > 0 && (
            <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Available: {ollamaModels.join(', ')}
            </p>
          )}
          <p style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            Run <code style={{ color: 'var(--text-secondary)' }}>ollama serve</code> locally for AI-powered SEO analysis.
            Download models with <code style={{ color: 'var(--text-secondary)' }}>ollama pull llama3</code>.
          </p>
        </div>
      </section>

      <button
        className="btn-primary"
        onClick={handleSave}
        disabled={saving}
        style={{ minWidth: 120 }}
      >
        {saving ? <><span className="spinner" /> Saving…</> : '💾 Save Settings'}
      </button>
    </div>
  );
}
