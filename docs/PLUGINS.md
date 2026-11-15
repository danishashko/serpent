# Plugins

A plugin is one `.js` file. Drop it in the plugins folder and it becomes a tab next to the built-in ones, with the current crawl's pages, links and images to work with.

## Install a plugin

1. Open the **Plugins** tab and click **Open plugins folder**.
2. Copy the `.js` file into that folder.
3. Click **Reload**. The plugin appears as its own tab.

**Add example plugins** copies two working plugins into the folder so you have something to read and edit:

| File | What it shows |
|---|---|
| `directory-breakdown.js` | Pages, errors, indexability and average word count for each top-level folder |
| `generic-anchor-text.js` | Internal links whose anchor is "click here", "read more" and similar, grouped by target page |

The plugins folder lives in the app's user data directory:

| OS | Path |
|---|---|
| Windows | `%APPDATA%\Serpent\plugins` |
| macOS | `~/Library/Application Support/Serpent/plugins` |
| Linux | `~/.config/Serpent/plugins` |

## Write a plugin

```js
// ==SerpentPlugin==
// @name         Longest titles
// @description  The 50 longest page titles in the crawl
// @version      1.0.0
// @author       Your name
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
});
```

The header block is optional. Without it the tab is named after the file.

`render(ctx)` is called once, when the tab opens. It may be `async`. Reopen the tab to render again with fresh data.

### `ctx`

| Field | Type | Contents |
|---|---|---|
| `root` | `HTMLElement` | The element to draw into |
| `ui` | object | The helpers below |
| `pages` | array | One object per crawled URL: `url`, `statusCode`, `title`, `metaDescription`, `h1`, `h2`, `wordCount`, `crawlDepth`, `canonicalUrl`, `isIndexable`, `contentType`, `inSitemap`, `brokenOutlinks` and the rest of the Pages export. `bodyText` is present when the crawl had **Store page text** on |
| `links` | array | `sourceUrl`, `targetUrl`, `isInternal`, `anchorText`, `relAttr`, `statusCode` |
| `images` | array | `pageUrl`, `imageUrl`, `altText`, `statusCode` and size fields |
| `crawl` | object | `{ id }` |
| `apiVersion` | number | `1` |

### `ui`

| Helper | Returns | Notes |
|---|---|---|
| `ui.table(rows, { columns, limit })` | element | Sortable table. `columns` is a list of keys or `{ key, label }`; the default is every key of the first row. Shows the first 500 rows unless `limit` says otherwise |
| `ui.stats([{ label, value }])` | element | A row of number tiles |
| `ui.exportButton(label, rows, filename, format)` | element | A button that saves `rows` as `'csv'` (default) or `'xlsx'`. `rows` may be a function that returns the rows |
| `ui.download(rows, filename, format)` | nothing | The same export without a button |
| `ui.el(tag, props, children)` | element | Shorthand for `document.createElement`. `props` takes `text`, `class`, `style` (object), `on…` handlers and plain attributes |

Plain DOM code works too. The page ships a small stylesheet with the app's colours as CSS variables (`--bg-primary`, `--bg-secondary`, `--text-primary`, `--text-secondary`, `--text-muted`, `--border`, `--accent-blue`, `--accent-green`, `--accent-red`, `--accent-orange`), and they follow the light and dark theme.

## What a plugin can and cannot do

Plugins run in a sandbox, so installing one from somebody else is a small risk.

A plugin **can**:

- read the pages, links and images of the crawl that is open
- draw anything in its own tab
- ask for a CSV or XLSX export, which you confirm in a save dialog

A plugin **cannot**:

- make any network request (`fetch`, XHR, WebSocket, images, forms, beacons and page navigation are all blocked)
- read your API keys, settings, other crawls or files
- reach the app window, the database or Node.js
- load code from a URL, run inline `<script>` or call `eval`
- use `localStorage` or cookies

In practice that means one self-contained file: no imports, no CDN libraries. Paste a library's source into the file if you need one, up to the 512 KB limit per plugin.

## Troubleshooting

| Symptom | Cause |
|---|---|
| The plugin is listed in red | The file is over 512 KB, or two files produce the same id (`report.js` and `Report!.js`) |
| "This file never called serpent.register" | The file ran but did not register a `render` function |
| A red error box in the tab | The plugin threw. The box shows the message and stack |
| The tab is empty after a new crawl | Tabs render once. Switch to another tab and back |
