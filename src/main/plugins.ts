/**
 * Plugin tabs: a .js file dropped into the plugins folder becomes a tab.
 *
 * Trust model. A plugin is somebody else's code, so it never runs in the app
 * window. Each one is served from its own serpent-plugin:// page and shown in
 * an <iframe sandbox="allow-scripts">: an opaque origin with no preload bridge
 * (no window.api, no Node), and a Content-Security-Policy that allows no
 * network at all. It receives a copy of the crawl over postMessage and can ask
 * the host for exactly one thing, a file export, which the user confirms in a
 * save dialog. A plugin can therefore read the crawl it is shown and draw a
 * tab; it cannot read API keys, touch the database or send data anywhere.
 *
 * This module is pure (fs + path only) so it can be unit-tested; index.ts
 * wires it to the protocol handler and IPC.
 */
import fs from 'fs';
import path from 'path';
import type { PluginInfo } from '../types/index';

export const PLUGIN_SCHEME = 'serpent-plugin';
export const PLUGIN_HOST = 'plugin';
export const PLUGIN_API_VERSION = 1;
/** A plugin is one readable source file; anything larger is a bundle that does not belong here. */
export const MAX_PLUGIN_BYTES = 512 * 1024;
export const MAX_PLUGINS = 50;

/**
 * No network of any kind: scripts only from this scheme (the runtime and the
 * plugin file), inline styles for theming, data: images for charts.
 */
export const PLUGIN_CSP =
  `default-src 'none'; script-src ${PLUGIN_SCHEME}:; style-src 'unsafe-inline'; img-src data:; ` +
  "base-uri 'none'; form-action 'none'";

export interface PluginHeader {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
}

/** "My Report (v2).js" -> "my-report-v2". Null for anything that is not a usable .js file name. */
export function pluginIdFromFile(file: string): string | null {
  if (!/\.js$/i.test(file) || file.startsWith('.')) return null;
  const id = file
    .slice(0, -3)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || null;
}

/**
 * Metadata lives in a comment block at the top of the file:
 *
 *   // ==SerpentPlugin==
 *   // @name         Directory breakdown
 *   // @description  Pages, errors and word count per top-level folder
 *   // @version      1.0.0
 *   // @author       Jane Doe
 *   // ==/SerpentPlugin==
 */
export function parsePluginHeader(code: string): PluginHeader {
  const block = code.match(/==SerpentPlugin==([\s\S]*?)==\/SerpentPlugin==/);
  if (!block) return {};
  const out: PluginHeader = {};
  for (const line of block[1].split(/\r?\n/)) {
    const m = line.match(/@(name|description|version|author)\s+(.+?)\s*$/);
    if (!m) continue;
    const key = m[1] as keyof PluginHeader;
    if (out[key] === undefined) out[key] = m[2].slice(0, 200);
  }
  return out;
}

/** Every .js file in the folder, sorted by name. A missing folder is an empty list, not an error. */
export function listPlugins(dir: string): PluginInfo[] {
  let files: string[];
  try {
    files = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: PluginInfo[] = [];
  const seen = new Set<string>();
  for (const file of files.sort((a, b) => a.localeCompare(b))) {
    const id = pluginIdFromFile(file);
    if (!id) continue;
    if (out.length >= MAX_PLUGINS) break;
    const full = path.join(dir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const info: PluginInfo = { id, file, name: file.slice(0, -3), description: '', version: '', author: '', mtimeMs: stat.mtimeMs };
    if (seen.has(id)) {
      info.error = `Another plugin file already uses the id "${id}". Rename one of them.`;
      info.id = `${id}-${out.length}`;
    } else if (stat.size > MAX_PLUGIN_BYTES) {
      info.error = `File is larger than ${Math.round(MAX_PLUGIN_BYTES / 1024)} KB.`;
    } else {
      try {
        const header = parsePluginHeader(fs.readFileSync(full, 'utf8'));
        if (header.name) info.name = header.name;
        info.description = header.description ?? '';
        info.version = header.version ?? '';
        info.author = header.author ?? '';
      } catch (err) {
        info.error = `Could not read the file: ${(err as Error).message}`;
      }
    }
    seen.add(id);
    out.push(info);
  }
  return out;
}

/**
 * Source of one plugin, looked up through the folder listing so that an id can
 * never be turned into a path outside the plugins folder.
 */
export function readPluginCode(dir: string, id: string): string | null {
  const info = listPlugins(dir).find(p => p.id === id && !p.error);
  if (!info) return null;
  try {
    return fs.readFileSync(path.join(dir, info.file), 'utf8');
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const BASE_URL = `${PLUGIN_SCHEME}://${PLUGIN_HOST}`;

/** The page a plugin runs in. No inline script: the CSP only allows files from this scheme. */
export function pluginPageHtml(info: PluginInfo): string {
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${PLUGIN_CSP}">` +
    `<title>${escapeHtml(info.name)}</title>` +
    `<style>${PLUGIN_BASE_CSS}</style></head><body><div id="root"></div>` +
    `<script src="${BASE_URL}/runtime.js"></script>` +
    `<script src="${BASE_URL}/${info.id}/plugin.js?v=${Math.floor(info.mtimeMs)}"></script>` +
    '</body></html>'
  );
}

export interface PluginResponse {
  status: number;
  contentType: string;
  body: string;
}

/** Route a serpent-plugin:// request: /runtime.js, /<id>/index.html or /<id>/plugin.js. */
export function pluginResponse(dir: string, requestUrl: string): PluginResponse {
  const notFound: PluginResponse = { status: 404, contentType: 'text/plain; charset=utf-8', body: 'Not found' };
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return notFound;
  }
  if (url.protocol !== `${PLUGIN_SCHEME}:` || url.hostname !== PLUGIN_HOST) return notFound;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 1 && parts[0] === 'runtime.js') {
    return { status: 200, contentType: 'text/javascript; charset=utf-8', body: PLUGIN_RUNTIME_JS };
  }
  if (parts.length !== 2 || !/^[a-z0-9-]+$/.test(parts[0])) return notFound;
  const [id, resource] = parts;
  if (resource === 'index.html') {
    const info = listPlugins(dir).find(p => p.id === id && !p.error);
    return info ? { status: 200, contentType: 'text/html; charset=utf-8', body: pluginPageHtml(info) } : notFound;
  }
  if (resource === 'plugin.js') {
    const code = readPluginCode(dir, id);
    return code === null ? notFound : { status: 200, contentType: 'text/javascript; charset=utf-8', body: code };
  }
  return notFound;
}

/** Copy the bundled example plugins into the user's folder, never overwriting a file that is already there. */
export function installExamplePlugins(examplesDir: string, pluginsDir: string): string[] {
  fs.mkdirSync(pluginsDir, { recursive: true });
  const copied: string[] = [];
  let files: string[] = [];
  try {
    files = fs.readdirSync(examplesDir);
  } catch {
    return copied;
  }
  for (const file of files) {
    if (!pluginIdFromFile(file)) continue;
    const target = path.join(pluginsDir, file);
    if (fs.existsSync(target)) continue;
    fs.writeFileSync(target, fs.readFileSync(path.join(examplesDir, file)));
    copied.push(file);
  }
  return copied;
}

// ─── What runs inside the plugin frame ────────────────────────────────────────

export const PLUGIN_BASE_CSS = [
  ':root{--bg-primary:#0f1117;--bg-secondary:#1a1d27;--bg-tertiary:#242736;--bg-hover:#2e3245;--border:#2e3245;',
  '--text-primary:#e8eaf0;--text-secondary:#8b93a8;--text-muted:#5a6278;--accent-blue:#4c85ff;--accent-green:#2ed573;',
  '--accent-red:#ff4757;--accent-orange:#ffa502;--accent-purple:#a29bfe;--accent-teal:#00cec9;',
  '--tint-blue:rgba(76,133,255,.15);--tint-green:rgba(46,213,115,.15);--tint-red:rgba(255,71,87,.15);--tint-orange:rgba(255,165,2,.15)}',
  '*{box-sizing:border-box}',
  "html,body{margin:0;background:var(--bg-primary);color:var(--text-primary);font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}",
  '#root{padding:16px}',
  'h1,h2,h3{margin:0 0 8px;font-weight:600}h1{font-size:16px}h2{font-size:14px}h3{font-size:13px}',
  'p{margin:0 0 10px;color:var(--text-secondary)}',
  '.sp-stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 14px}',
  '.sp-stat{background:var(--bg-secondary);border:1px solid var(--border);border-radius:6px;padding:8px 12px;min-width:110px}',
  '.sp-stat b{display:block;font-size:18px;font-variant-numeric:tabular-nums}',
  '.sp-stat span{font-size:11px;color:var(--text-muted)}',
  '.sp-table{width:100%;border-collapse:collapse;font-size:12px;margin:0 0 14px}',
  '.sp-table th{position:sticky;top:0;background:var(--bg-secondary);color:var(--text-secondary);text-align:left;font-weight:600;padding:6px 8px;border-bottom:1px solid var(--border);cursor:pointer;white-space:nowrap;user-select:none}',
  '.sp-table td{padding:5px 8px;border-bottom:1px solid var(--border);max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.sp-table td.num,.sp-table th.num{text-align:right;font-variant-numeric:tabular-nums}',
  '.sp-table tr:hover td{background:var(--bg-hover)}',
  '.sp-note{font-size:11px;color:var(--text-muted);margin:0 0 10px}',
  '.sp-btn{background:transparent;color:var(--text-secondary);border:1px solid var(--border);border-radius:6px;padding:3px 10px;font-size:12px;cursor:pointer;margin:0 6px 10px 0}',
  '.sp-btn:hover{background:var(--bg-hover);color:var(--text-primary)}',
  '.sp-error{border:1px solid var(--accent-red);background:var(--tint-red);border-radius:6px;padding:10px 12px;white-space:pre-wrap;font-family:Consolas,monospace;font-size:12px}',
].join('');

/**
 * The runtime is plain ES5-style JavaScript kept as a string because it is
 * served to the frame, not compiled into the app. It defines window.serpent
 * and the small UI kit plugins draw with.
 */
export const PLUGIN_RUNTIME_JS = String.raw`(function () {
  'use strict';
  var root = document.getElementById('root');
  var def = null;
  var payload = null;
  var rendered = false;
  var failed = false;

  function post(msg) { parent.postMessage(msg, '*'); }

  function fail(err) {
    failed = true;
    var message = err && err.stack ? String(err.stack) : String(err && err.message ? err.message : err);
    var box = document.createElement('div');
    box.className = 'sp-error';
    box.textContent = 'Plugin error\n\n' + message;
    root.textContent = '';
    root.appendChild(box);
    post({ type: 'serpent:error', message: message.slice(0, 2000) });
  }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined) return;
        if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
        else if (k === 'class' || k === 'className') node.className = String(v);
        else if (k === 'text') node.textContent = String(v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
        else node.setAttribute(k, String(v));
      });
    }
    [].concat(children === undefined || children === null ? [] : children).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'object' && c.nodeType ? c : document.createTextNode(String(c)));
    });
    return node;
  }

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  // table(rows, { columns: ['url', { key: 'words', label: 'Words' }], limit: 500 })
  function table(rows, opts) {
    opts = opts || {};
    rows = Array.isArray(rows) ? rows : [];
    var limit = opts.limit || 500;
    var cols = (opts.columns || (rows[0] ? Object.keys(rows[0]) : [])).map(function (c) {
      return typeof c === 'string' ? { key: c, label: c } : { key: c.key, label: c.label || c.key };
    });
    var sortKey = null;
    var asc = true;
    var wrap = el('div');
    var tbl = el('table', { class: 'sp-table' });
    var note = el('div', { class: 'sp-note' });
    wrap.appendChild(tbl);
    wrap.appendChild(note);

    function draw() {
      var data = rows.slice();
      if (sortKey !== null) {
        data.sort(function (a, b) {
          var x = a[sortKey], y = b[sortKey];
          if (x === y) return 0;
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          var r = isNum(x) && isNum(y) ? x - y : String(x).localeCompare(String(y));
          return asc ? r : -r;
        });
      }
      tbl.textContent = '';
      var head = el('tr');
      cols.forEach(function (c) {
        var numeric = rows.length > 0 && isNum(rows[0][c.key]);
        head.appendChild(el('th', {
          class: numeric ? 'num' : '',
          text: c.label + (sortKey === c.key ? (asc ? ' ▲' : ' ▼') : ''),
          onclick: function () {
            if (sortKey === c.key) asc = !asc; else { sortKey = c.key; asc = !numeric; }
            draw();
          }
        }));
      });
      tbl.appendChild(el('thead', null, head));
      var body = el('tbody');
      data.slice(0, limit).forEach(function (row) {
        var tr = el('tr');
        cols.forEach(function (c) {
          var v = row[c.key];
          var text = v === null || v === undefined ? '' : isNum(v) ? v.toLocaleString() : String(v);
          tr.appendChild(el('td', { class: isNum(v) ? 'num' : '', text: text, title: text }));
        });
        body.appendChild(tr);
      });
      tbl.appendChild(body);
      note.textContent = rows.length > limit
        ? 'Showing ' + limit.toLocaleString() + ' of ' + rows.length.toLocaleString() + ' rows. Export for the full list.'
        : rows.length.toLocaleString() + (rows.length === 1 ? ' row' : ' rows');
    }
    draw();
    return wrap;
  }

  // stats([{ label: 'Pages', value: 120 }, ...])
  function stats(items) {
    return el('div', { class: 'sp-stats' }, (items || []).map(function (s) {
      return el('div', { class: 'sp-stat' }, [
        el('b', { text: isNum(s.value) ? s.value.toLocaleString() : String(s.value) }),
        el('span', { text: s.label })
      ]);
    }));
  }

  // Ask the app to save rows as a file. The user picks the location in a save dialog.
  function download(rows, filename, format) {
    post({ type: 'serpent:export', rows: rows, filename: String(filename || 'plugin-export'), format: format === 'xlsx' ? 'xlsx' : 'csv' });
  }

  function exportButton(label, rows, filename, format) {
    return el('button', { class: 'sp-btn', text: label, onclick: function () { download(typeof rows === 'function' ? rows() : rows, filename, format); } });
  }

  var ui = { el: el, table: table, stats: stats, download: download, exportButton: exportButton };

  function applyTheme(vars) {
    if (!vars) return;
    Object.keys(vars).forEach(function (k) {
      if (/^--[a-z-]+$/.test(k) && vars[k]) document.documentElement.style.setProperty(k, String(vars[k]));
    });
  }

  function run() {
    if (!def || !payload || rendered) return;
    rendered = true;
    try {
      root.textContent = '';
      var result = def.render({
        root: root,
        ui: ui,
        crawl: payload.crawl,
        pages: payload.pages,
        links: payload.links,
        images: payload.images,
        apiVersion: ${PLUGIN_API_VERSION}
      });
      if (result && typeof result.then === 'function') result.then(null, fail);
    } catch (e) {
      fail(e);
    }
  }

  window.serpent = {
    apiVersion: ${PLUGIN_API_VERSION},
    ui: ui,
    register: function (definition) {
      if (!definition || typeof definition.render !== 'function') {
        fail(new Error('serpent.register() needs an object with a render(ctx) function.'));
        return;
      }
      def = definition;
      run();
    }
  };

  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data) return;
    if (e.data.type === 'serpent:theme') applyTheme(e.data.theme);
    if (e.data.type === 'serpent:data') {
      applyTheme(e.data.theme);
      payload = e.data;
      run();
    }
  });
  window.addEventListener('error', function (e) { fail(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { fail(e.reason); });
  window.addEventListener('load', function () {
    if (def) post({ type: 'serpent:ready' });
    else if (!failed) fail(new Error('This file never called serpent.register({ render(ctx) { ... } }).'));
  });
})();
`;
