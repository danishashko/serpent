import React, { useEffect, useRef, useState } from 'react';
import { ImageData, LinkData, PageData, PluginInfo, PLUGIN_THEME_VARS } from '../../types/index';

type Toast = (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;

interface Props {
  crawlId: string | null;
  pages: PageData[];
  links: LinkData[];
  images: ImageData[];
  plugins: PluginInfo[];
  /** Plugin shown in the frame; null shows the list of installed plugins. */
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onReload: () => Promise<PluginInfo[]>;
  showToast: Toast;
}

/** Rows a plugin may hand to the export dialog in one request. */
const MAX_EXPORT_ROWS = 1_000_000;

function themeVars(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const name of PLUGIN_THEME_VARS) {
    const value = style.getPropertyValue(name).trim();
    if (value) out[name] = value;
  }
  return out;
}

function isRowArray(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length <= MAX_EXPORT_ROWS && value.every(r => r !== null && typeof r === 'object' && !Array.isArray(r));
}

/**
 * One plugin, in a sandboxed frame. The frame has an opaque origin and no
 * bridge to the app; everything it knows arrives in the serpent:data message,
 * and the only thing it can ask for is a file export.
 */
function PluginFrame({ plugin, crawlId, pages, links, images, showToast }: {
  plugin: PluginInfo; crawlId: string | null; pages: PageData[]; links: LinkData[]; images: ImageData[]; showToast: Toast;
}): React.ReactElement {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  // Latest crawl data without re-subscribing the message listener on every progress tick.
  const dataRef = useRef({ crawlId, pages, links, images });
  dataRef.current = { crawlId, pages, links, images };

  const send = (): void => {
    const d = dataRef.current;
    frameRef.current?.contentWindow?.postMessage(
      { type: 'serpent:data', crawl: { id: d.crawlId }, pages: d.pages, links: d.links, images: d.images, theme: themeVars() },
      '*',
    );
  };

  useEffect(() => {
    setReady(false);
    const onMessage = (e: MessageEvent): void => {
      if (e.source !== frameRef.current?.contentWindow) return;
      const msg = e.data as { type?: string; rows?: unknown; filename?: unknown; format?: unknown; message?: unknown } | null;
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'serpent:ready') {
        setReady(true);
        send();
      } else if (msg.type === 'serpent:error') {
        showToast(`Plugin "${plugin.name}" failed. Details are in its tab.`, 'error');
      } else if (msg.type === 'serpent:export') {
        if (!isRowArray(msg.rows) || msg.rows.length === 0) { showToast('The plugin had nothing to export', 'warning'); return; }
        const base = String(msg.filename ?? 'plugin-export').replace(/[^\w.-]+/g, '-').replace(/\.(csv|xlsx)$/i, '').slice(0, 80) || 'plugin-export';
        const job = msg.format === 'xlsx'
          ? window.api.exportXlsx({ rows: msg.rows, filename: `${base}.xlsx`, sheetName: plugin.name })
          : window.api.exportCsv({ rows: msg.rows, filename: `${base}.csv` });
        job.then(r => { if (r.success) showToast('Export saved', 'success'); }).catch(err => showToast(String(err), 'error'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plugin.id, plugin.mtimeMs]);

  // A different crawl: reload the frame so the plugin renders from scratch.
  const frameKey = `${plugin.id}:${plugin.mtimeMs}:${crawlId ?? ''}`;

  // Follow light/dark switches without reloading the plugin.
  useEffect(() => {
    if (!ready) return;
    const observer = new MutationObserver(() => {
      frameRef.current?.contentWindow?.postMessage({ type: 'serpent:theme', theme: themeVars() }, '*');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [ready]);

  return (
    <iframe
      key={frameKey}
      ref={frameRef}
      data-testid="plugin-frame"
      title={plugin.name}
      sandbox="allow-scripts"
      src={`serpent-plugin://plugin/${plugin.id}/index.html?v=${Math.floor(plugin.mtimeMs)}`}
      style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', background: 'var(--bg-primary)' }}
    />
  );
}

const EXAMPLE = `// ==SerpentPlugin==
// @name         Longest titles
// @description  The 50 longest page titles in the crawl
// @version      1.0.0
// ==/SerpentPlugin==

serpent.register({
  render({ root, ui, pages }) {
    const rows = pages
      .filter(p => p.title)
      .map(p => ({ url: p.url, title: p.title, length: p.title.length }))
      .sort((a, b) => b.length - a.length)
      .slice(0, 50);
    root.append(ui.stats([{ label: 'Pages with a title', value: rows.length }]));
    root.append(ui.exportButton('Export CSV', rows, 'longest-titles'));
    root.append(ui.table(rows));
  },
});`;

export default function PluginsPanel({ crawlId, pages, links, images, plugins, activeId, onSelect, onReload, showToast }: Props): React.ReactElement {
  const active = activeId ? plugins.find(p => p.id === activeId) ?? null : null;

  if (active && !active.error) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
        <PluginFrame plugin={active} crawlId={crawlId} pages={pages} links={links} images={images} showToast={showToast} />
      </div>
    );
  }

  const reload = async (): Promise<void> => {
    const list = await onReload();
    showToast(`${list.length} plugin${list.length === 1 ? '' : 's'} found`, 'info');
  };

  const installExamples = async (): Promise<void> => {
    const r = await window.api.installExamplePlugins();
    await onReload();
    showToast(r.copied.length > 0 ? `Added ${r.copied.length} example plugin${r.copied.length === 1 ? '' : 's'}` : 'The examples are already in your plugins folder', r.copied.length > 0 ? 'success' : 'info');
  };

  const btn: React.CSSProperties = { fontSize: 12, padding: '3px 10px' };

  return (
    <div data-testid="plugins-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>Plugins</h3>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" style={btn} onClick={() => window.api.openPluginsFolder()}>Open plugins folder</button>
        <button className="btn-ghost" style={btn} data-testid="plugins-install-examples" onClick={installExamples}>Add example plugins</button>
        <button className="btn-ghost" style={btn} data-testid="plugins-reload" onClick={reload}>Reload</button>
      </div>

      <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        A plugin is one <code>.js</code> file. Put it in the plugins folder, press Reload, and it gets its own tab with the
        crawl's pages, links and images. Plugins run in a sandbox: no network, no access to your API keys or files.
      </div>

      {plugins.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No plugins installed yet.</div>
      ) : (
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Description</th><th>Version</th><th>File</th></tr>
          </thead>
          <tbody>
            {plugins.map(p => (
              <tr key={p.id} data-testid="plugin-row" onClick={() => { if (!p.error) onSelect(p.id); }} style={{ cursor: p.error ? 'default' : 'pointer' }}>
                <td style={{ color: p.error ? 'var(--accent-red)' : 'var(--accent-blue)' }}>{p.name}</td>
                <td>{p.error ? <span style={{ color: 'var(--accent-red)' }}>{p.error}</span> : p.description}</td>
                <td>{p.version}</td>
                <td style={{ color: 'var(--text-muted)' }}>{p.file}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>A complete plugin</div>
        <pre style={{
          margin: 0, padding: 12, fontSize: 12, lineHeight: 1.5, overflowX: 'auto',
          background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
        }}>{EXAMPLE}</pre>
      </div>
    </div>
  );
}
