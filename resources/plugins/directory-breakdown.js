// ==SerpentPlugin==
// @name         Directory breakdown
// @description  Pages, errors, indexability and word count for each top-level folder of the site
// @version      1.0.0
// @author       Serpent
// ==/SerpentPlugin==

serpent.register({
  render({ root, ui, pages }) {
    const groups = new Map();

    for (const p of pages) {
      let folder = '/';
      try {
        // "/pricing" is a page at the root; "/blog/" and "/blog/post" belong to the /blog/ folder.
        const m = new URL(p.url).pathname.match(/^\/([^/]+)\//);
        if (m) folder = '/' + m[1] + '/';
      } catch (e) {
        continue;
      }
      let g = groups.get(folder);
      if (!g) {
        g = { folder, pages: 0, ok: 0, redirects: 0, errors: 0, indexable: 0, words: 0, counted: 0 };
        groups.set(folder, g);
      }
      const status = p.statusCode || 0;
      g.pages++;
      if (status >= 200 && status < 300) g.ok++;
      else if (status >= 300 && status < 400) g.redirects++;
      else g.errors++;
      if (p.isIndexable && status >= 200 && status < 300) g.indexable++;
      if (typeof p.wordCount === 'number' && status >= 200 && status < 300) {
        g.words += p.wordCount;
        g.counted++;
      }
    }

    const rows = [...groups.values()]
      .map(g => ({
        folder: g.folder,
        pages: g.pages,
        ok_2xx: g.ok,
        redirects_3xx: g.redirects,
        errors: g.errors,
        indexable: g.indexable,
        indexable_pct: g.pages ? Math.round((g.indexable / g.pages) * 100) : 0,
        avg_words: g.counted ? Math.round(g.words / g.counted) : 0,
      }))
      .sort((a, b) => b.pages - a.pages);

    const withErrors = rows.filter(r => r.errors > 0).length;
    root.append(
      ui.stats([
        { label: 'Folders', value: rows.length },
        { label: 'Pages', value: pages.length },
        { label: 'Folders with errors', value: withErrors },
      ]),
      ui.exportButton('Export CSV', rows, 'directory-breakdown'),
      ui.exportButton('Export XLSX', rows, 'directory-breakdown', 'xlsx'),
      ui.table(rows, {
        columns: [
          { key: 'folder', label: 'Folder' },
          { key: 'pages', label: 'Pages' },
          { key: 'ok_2xx', label: '2xx' },
          { key: 'redirects_3xx', label: '3xx' },
          { key: 'errors', label: 'Errors' },
          { key: 'indexable', label: 'Indexable' },
          { key: 'indexable_pct', label: 'Indexable %' },
          { key: 'avg_words', label: 'Avg. words' },
        ],
      }),
    );
  },
});
