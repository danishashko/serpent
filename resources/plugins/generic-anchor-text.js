// ==SerpentPlugin==
// @name         Generic anchor text
// @description  Internal links whose anchor says nothing about the target ("click here", "read more"), grouped by target page
// @version      1.0.0
// @author       Serpent
// ==/SerpentPlugin==

const GENERIC = new Set([
  'click here', 'here', 'read more', 'more', 'learn more', 'find out more', 'see more', 'view more', 'more info',
  'more information', 'details', 'view details', 'link', 'this', 'this page', 'this link', 'continue', 'continue reading',
  'go', 'view', 'see all', 'view all', 'show more', 'discover more', 'know more', 'check it out', 'website',
]);

function normalize(text) {
  return String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

serpent.register({
  render({ root, ui, links }) {
    const internal = links.filter(l => l.isInternal);
    const byTarget = new Map();
    const detail = [];

    for (const l of internal) {
      const anchor = normalize(l.anchorText);
      if (!GENERIC.has(anchor)) continue;
      detail.push({ source_url: l.sourceUrl, target_url: l.targetUrl, anchor_text: l.anchorText });
      let t = byTarget.get(l.targetUrl);
      if (!t) {
        t = { target_url: l.targetUrl, generic_links: 0, anchors: new Map(), sources: new Set() };
        byTarget.set(l.targetUrl, t);
      }
      t.generic_links++;
      t.sources.add(l.sourceUrl);
      t.anchors.set(anchor, (t.anchors.get(anchor) || 0) + 1);
    }

    const rows = [...byTarget.values()]
      .map(t => ({
        target_url: t.target_url,
        generic_links: t.generic_links,
        linking_pages: t.sources.size,
        anchors_used: [...t.anchors.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => a + ' (' + n + ')').join(', '),
      }))
      .sort((a, b) => b.generic_links - a.generic_links);

    root.append(
      ui.stats([
        { label: 'Internal links', value: internal.length },
        { label: 'With generic anchor text', value: detail.length },
        { label: 'Target pages affected', value: rows.length },
      ]),
    );

    if (rows.length === 0) {
      root.append(ui.el('p', { text: 'No internal link in this crawl uses a generic anchor.' }));
      return;
    }

    root.append(
      ui.exportButton('Export targets (CSV)', rows, 'generic-anchors-by-target'),
      ui.exportButton('Export every link (CSV)', detail, 'generic-anchor-links'),
      ui.table(rows, {
        columns: [
          { key: 'target_url', label: 'Target page' },
          { key: 'generic_links', label: 'Generic links' },
          { key: 'linking_pages', label: 'Linking pages' },
          { key: 'anchors_used', label: 'Anchors used' },
        ],
      }),
    );
  },
});
