import React, { useState, useMemo } from 'react';
import { PageData, LinkData, ImageData, SerpResultRow } from '../../types/index';

interface Props {
  pages: PageData[];
  links: LinkData[];
  images: ImageData[];
  serpResults: SerpResultRow[];
  crawlId: string | null;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
  onSerpQuery?: (keywords: string[], location?: string, device?: 'desktop' | 'mobile') => void;
  serpLoading?: boolean;
}

type Tab = 'pages' | 'links' | 'images' | 'issues' | 'serp';
type IssueFilter =
  | 'all'
  | 'missing_title'
  | 'duplicate_title'
  | 'missing_meta'
  | 'missing_h1'
  | 'broken'
  | 'redirect'
  | 'noindex'
  | 'thin_content';

const titleWidthColor = (px: number): string => {
  if (px < 200) return 'var(--text-muted)';
  if (px <= 580) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const metaWidthColor = (px: number): string => {
  if (px < 100) return 'var(--text-muted)';
  if (px <= 990) return 'var(--accent-green)';
  return 'var(--accent-red)';
};

const statusColor = (code: number): string => {
  if (code === 200) return 'var(--accent-green)';
  if (code >= 300 && code < 400) return 'var(--accent-orange)';
  if (code >= 400) return 'var(--accent-red)';
  return 'var(--text-muted)';
};

export default function ResultsTabs({ pages, links, images, serpResults, crawlId, showToast, onSerpQuery, serpLoading }: Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>('pages');
  const [issueFilter, setIssueFilter] = useState<IssueFilter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('url');
  const [sortAsc, setSortAsc] = useState(true);
  const [serpKeywords, setSerpKeywords] = useState('');
  const [serpLocation, setSerpLocation] = useState('United States');
  const [serpDevice, setSerpDevice] = useState<'desktop' | 'mobile'>('desktop');

  const handleSort = (key: string) => {
    if (sortKey === key) setSortAsc(a => !a);
    else { setSortKey(key); setSortAsc(true); }
  };

  const titleCounts = useMemo(() => {
    const m: Record<string, number> = {};
    pages.forEach(p => { if (p.title) m[p.title] = (m[p.title] ?? 0) + 1; });
    return m;
  }, [pages]);

  const filteredPages = useMemo(() => {
    let list = [...pages];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => p.url.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q));
    }
    if (issueFilter !== 'all' && tab === 'issues') {
      list = list.filter(p => {
        switch (issueFilter) {
          case 'missing_title': return !p.title;
          case 'duplicate_title': return !!p.title && (titleCounts[p.title] ?? 0) > 1;
          case 'missing_meta': return !p.metaDescription;
          case 'missing_h1': return !p.h1;
          case 'broken': return (p.statusCode ?? 0) >= 400;
          case 'redirect': return (p.statusCode ?? 0) >= 300 && (p.statusCode ?? 0) < 400;
          case 'noindex': return !p.isIndexable;
          case 'thin_content': return (p.wordCount ?? 0) < 300;
          default: return true;
        }
      });
    }
    list.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortKey] ?? '';
      const bv = (b as unknown as Record<string, unknown>)[sortKey] ?? '';
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [pages, search, issueFilter, tab, titleCounts, sortKey, sortAsc]);

  const issueCounts: Record<IssueFilter, number> = useMemo(() => ({
    all: pages.length,
    missing_title: pages.filter(p => !p.title).length,
    duplicate_title: pages.filter(p => !!p.title && (titleCounts[p.title] ?? 0) > 1).length,
    missing_meta: pages.filter(p => !p.metaDescription).length,
    missing_h1: pages.filter(p => !p.h1).length,
    broken: pages.filter(p => (p.statusCode ?? 0) >= 400).length,
    redirect: pages.filter(p => (p.statusCode ?? 0) >= 300 && (p.statusCode ?? 0) < 400).length,
    noindex: pages.filter(p => !p.isIndexable).length,
    thin_content: pages.filter(p => (p.wordCount ?? 0) < 300).length,
  }), [pages, titleCounts]);

  const exportCsv = async () => {
    if (!crawlId) return;
    const { rows, filename } = getExportData('csv');
    if (rows.length === 0) { showToast('No data to export', 'warning'); return; }
    const result = await window.api.exportCsv({ rows, filename });
    if (result.success) showToast('CSV exported!', 'success');
    else showToast('CSV export cancelled', 'info');
  };

  const exportJson = async () => {
    if (!crawlId) return;
    const { rows, filename } = getExportData('json');
    if (rows.length === 0) { showToast('No data to export', 'warning'); return; }
    const result = await window.api.exportJson({ rows, filename });
    if (result.success) showToast('JSON exported!', 'success');
    else showToast('JSON export cancelled', 'info');
  };

  const getExportData = (ext: string): { rows: Record<string, unknown>[]; filename: string } => {
    const prefix = `ghostfrog-${crawlId}`;
    if (tab === 'pages' || tab === 'issues') {
      return {
        rows: filteredPages.map(p => ({
          url: p.url, status_code: p.statusCode ?? '', title: p.title ?? '',
          title_len_px: p.titlePixelWidth ?? '', meta_description: p.metaDescription ?? '',
          meta_len_px: p.metaDescPixelWidth ?? '', h1: p.h1 ?? '', canonical: p.canonicalUrl ?? '',
          indexable: p.isIndexable ? 'true' : 'false', word_count: p.wordCount ?? '', response_ms: p.responseTimeMs ?? '',
        })),
        filename: `${prefix}-pages.${ext}`,
      };
    }
    if (tab === 'links') {
      const filtered = links.filter(l => !search || l.sourceUrl.toLowerCase().includes(search.toLowerCase()) || l.targetUrl.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(l => ({
          source_url: l.sourceUrl, target_url: l.targetUrl, anchor_text: l.anchorText ?? '',
          type: l.isInternal ? 'internal' : 'external', rel: l.relAttr ?? '',
        })),
        filename: `${prefix}-links.${ext}`,
      };
    }
    if (tab === 'images') {
      const filtered = images.filter(img => !search || img.imageUrl.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(img => ({
          image_url: img.imageUrl, alt_text: img.altText ?? '', source_page: img.pageUrl,
        })),
        filename: `${prefix}-images.${ext}`,
      };
    }
    if (tab === 'serp') {
      const filtered = serpResults.filter(s => !search || s.keyword.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()));
      return {
        rows: filtered.map(s => ({
          keyword: s.keyword, position: s.position, url: s.url, title: s.title,
          description: s.description, features: s.featuresJson, device: s.device ?? '', location: s.location ?? '',
        })),
        filename: `${prefix}-serp.${ext}`,
      };
    }
    return { rows: [], filename: '' };
  };

  const handleSerpQuery = () => {
    if (!onSerpQuery || !crawlId) return;
    const kws = serpKeywords.split('\n').map(k => k.trim()).filter(Boolean);
    if (kws.length === 0) { showToast('Enter at least one keyword', 'warning'); return; }
    onSerpQuery(kws, serpLocation, serpDevice);
  };

  const Th = ({ label, sortable, field }: { label: string; sortable?: boolean; field?: string }) => (
    <th
      onClick={sortable && field ? () => handleSort(field) : undefined}
      style={{ cursor: sortable ? 'pointer' : 'default', userSelect: 'none', whiteSpace: 'nowrap' }}
    >
      {label}
      {sortable && field === sortKey && (sortAsc ? ' ▲' : ' ▼')}
    </th>
  );

  const tabs: Tab[] = ['pages', 'links', 'images', 'issues', 'serp'];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Tab bar + search */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 12px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {tabs.map(t => (
            <button
              key={t}
              className="btn-icon"
              onClick={() => setTab(t)}
              style={{
                fontWeight: tab === t ? 600 : 400,
                color: tab === t ? 'var(--text-primary)' : undefined,
                borderBottom: tab === t ? '2px solid var(--accent-blue)' : '2px solid transparent',
                borderRadius: 0,
                paddingBottom: 4,
              }}
            >
              {t === 'pages' && `Pages (${pages.length})`}
              {t === 'links' && `Links (${links.length})`}
              {t === 'images' && `Images (${images.length})`}
              {t === 'issues' && `Issues (${issueCounts.broken + issueCounts.missing_title + issueCounts.missing_h1 + issueCounts.noindex})`}
              {t === 'serp' && `SERP (${serpResults.length})`}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <input
          className="input"
          style={{ width: 200, padding: '3px 8px', fontSize: 12 }}
          placeholder="Filter…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {crawlId && (
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={exportCsv}>
              ↓ CSV
            </button>
            <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={exportJson}>
              ↓ JSON
            </button>
          </div>
        )}
      </div>

      {/* Issues filter bar */}
      {tab === 'issues' && (
        <div style={{
          display: 'flex',
          gap: 6,
          padding: '6px 12px',
          borderBottom: '1px solid var(--border)',
          overflowX: 'auto',
          flexShrink: 0,
        }}>
          {(Object.keys(issueCounts) as IssueFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setIssueFilter(f)}
              style={{
                padding: '3px 10px',
                fontSize: 11,
                borderRadius: 12,
                border: '1px solid ' + (issueFilter === f ? 'var(--accent-blue)' : 'var(--border)'),
                background: issueFilter === f ? 'rgba(76,133,255,0.15)' : 'transparent',
                color: issueFilter === f ? 'var(--accent-blue)' : 'var(--text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {f.replace(/_/g, ' ')}
              <span style={{ marginLeft: 5, color: issueCounts[f] > 0 && f !== 'all' ? 'var(--accent-red)' : 'var(--text-muted)' }}>
                {issueCounts[f]}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Table area */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {(tab === 'pages' || tab === 'issues') && (
          <table className="data-table">
            <thead>
              <tr>
                <Th label="URL" sortable field="url" />
                <Th label="Status" sortable field="statusCode" />
                <Th label="Title" sortable field="title" />
                <Th label="Title px" sortable field="titlePixelWidth" />
                <Th label="Meta" sortable field="metaDescription" />
                <Th label="Meta px" sortable field="metaPixelWidth" />
                <Th label="H1" sortable field="h1" />
                <Th label="Words" sortable field="wordCount" />
                <Th label="ms" sortable field="responseMs" />
                <Th label="Noindex" />
              </tr>
            </thead>
            <tbody>
              {filteredPages.length === 0 ? (
                <tr><td colSpan={10} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                  {pages.length === 0 ? 'Start a crawl to see results' : 'No results match filter'}
                </td></tr>
              ) : filteredPages.map(p => (
                <tr key={p.id}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={p.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>
                      {p.url}
                    </a>
                  </td>
                  <td style={{ color: statusColor(p.statusCode ?? 0), fontWeight: 600 }}>{p.statusCode ?? '—'}</td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.title ? (
                      <span title={p.title}>{p.title}</span>
                    ) : (
                      <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>MISSING</span>
                    )}
                  </td>
                  <td style={{ color: titleWidthColor(p.titlePixelWidth ?? 0), fontVariantNumeric: 'tabular-nums' }}>
                    {p.titlePixelWidth ?? '—'}
                  </td>
                  <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.metaDescription ? (
                      <span title={p.metaDescription}>{p.metaDescription}</span>
                    ) : (
                      <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>MISSING</span>
                    )}
                  </td>
                  <td style={{ color: metaWidthColor(p.metaDescPixelWidth ?? 0), fontVariantNumeric: 'tabular-nums' }}>
                    {p.metaDescPixelWidth ?? '—'}
                  </td>
                  <td style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.h1 ?? <span style={{ color: 'var(--accent-red)', fontSize: 11 }}>MISSING</span>}
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.wordCount ?? '—'}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{p.responseTimeMs ?? '—'}</td>
                  <td>
                    {!p.isIndexable && <span style={{ color: 'var(--accent-orange)', fontSize: 10, fontWeight: 600 }}>NOINDEX</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'links' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Source URL</th>
                <th>Destination URL</th>
                <th>Anchor Text</th>
                <th>Type</th>
                <th>Nofollow</th>
              </tr>
            </thead>
            <tbody>
              {links.length === 0 ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No links collected yet</td></tr>
              ) : links.filter(l => !search || l.sourceUrl.toLowerCase().includes(search.toLowerCase()) || l.targetUrl.toLowerCase().includes(search.toLowerCase())).map((l, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={l.sourceUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{l.sourceUrl}</a>
                  </td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={l.targetUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{l.targetUrl}</a>
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{l.anchorText || '(none)'}</td>
                  <td>
                    <span style={{
                      fontSize: 10,
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: !l.isInternal ? 'rgba(255,140,50,0.15)' : 'rgba(76,133,255,0.15)',
                      color: !l.isInternal ? 'var(--accent-orange)' : 'var(--accent-blue)',
                    }}>
                      {!l.isInternal ? 'External' : 'Internal'}
                    </span>
                  </td>
                  <td style={{ color: l.relAttr?.includes('nofollow') ? 'var(--accent-orange)' : 'var(--text-muted)', fontSize: 11 }}>
                    {l.relAttr?.includes('nofollow') ? 'nofollow' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'images' && (
          <table className="data-table">
            <thead>
              <tr>
                <th>Image URL</th>
                <th>Alt Text</th>
                <th>Source Page</th>
              </tr>
            </thead>
            <tbody>
              {images.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>No images collected yet</td></tr>
              ) : images.filter(img => !search || img.imageUrl.toLowerCase().includes(search.toLowerCase())).map((img, i) => (
                <tr key={i}>
                  <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <a href={img.imageUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{img.imageUrl}</a>
                  </td>
                  <td style={{ color: img.altText ? 'var(--text-secondary)' : 'var(--accent-red)', fontSize: img.altText ? 13 : 11 }}>
                    {img.altText || 'MISSING'}
                  </td>
                  <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    {img.pageUrl}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === 'serp' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            {/* SERP keyword input */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Keywords (one per line)</label>
                <textarea
                  className="input"
                  style={{ height: 60, fontSize: 12, resize: 'none', fontFamily: 'inherit' }}
                  placeholder={'seo spider tool\nwebsite crawler\nsite audit tool'}
                  value={serpKeywords}
                  onChange={e => setSerpKeywords(e.target.value)}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Location</label>
                <input className="input" style={{ width: 130, padding: '4px 8px', fontSize: 12 }} value={serpLocation} onChange={e => setSerpLocation(e.target.value)} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Device</label>
                <select className="input" style={{ width: 90, padding: '4px 6px', fontSize: 12 }} value={serpDevice} onChange={e => setSerpDevice(e.target.value as 'desktop' | 'mobile')}>
                  <option value="desktop">Desktop</option>
                  <option value="mobile">Mobile</option>
                </select>
              </div>
              <button
                className="btn-primary"
                style={{ padding: '6px 14px', fontSize: 12, whiteSpace: 'nowrap' }}
                onClick={handleSerpQuery}
                disabled={!crawlId || serpLoading}
              >
                {serpLoading ? 'Querying…' : '🔍 Query SERP'}
              </button>
            </div>

            {/* SERP results table */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>#</th>
                    <th>URL</th>
                    <th>Title</th>
                    <th>Description</th>
                    <th>Features</th>
                    <th>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {serpResults.length === 0 ? (
                    <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>
                      {crawlId ? 'Enter keywords above to query SERP rankings' : 'Start a crawl first to use SERP queries'}
                    </td></tr>
                  ) : serpResults
                    .filter(s => !search || s.keyword.toLowerCase().includes(search.toLowerCase()) || s.url.toLowerCase().includes(search.toLowerCase()))
                    .map((s, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>{s.keyword}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums', color: s.position <= 3 ? 'var(--accent-green)' : s.position <= 10 ? 'var(--accent-blue)' : 'var(--text-secondary)', fontWeight: 600 }}>
                        {s.position}
                      </td>
                      <td style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-blue)', textDecoration: 'none' }}>{s.url}</a>
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </td>
                      <td style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 12 }}>
                        {s.description}
                      </td>
                      <td style={{ fontSize: 10 }}>
                        {(() => { try { const f = JSON.parse(s.featuresJson); return Array.isArray(f) ? f.join(', ') : ''; } catch { return ''; } })()}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.device ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div style={{
        padding: '4px 12px',
        borderTop: '1px solid var(--border)',
        fontSize: 11,
        color: 'var(--text-muted)',
        display: 'flex',
        gap: 16,
        flexShrink: 0,
      }}>
        {tab === 'pages' || tab === 'issues' ? (
          <>
            <span>Total: {pages.length}</span>
            <span style={{ color: 'var(--accent-green)' }}>200: {pages.filter(p => p.statusCode === 200).length}</span>
            <span style={{ color: 'var(--accent-orange)' }}>3xx: {pages.filter(p => (p.statusCode ?? 0) >= 300 && (p.statusCode ?? 0) < 400).length}</span>
            <span style={{ color: 'var(--accent-red)' }}>4xx/5xx: {pages.filter(p => (p.statusCode ?? 0) >= 400).length}</span>
            <span>Noindex: {pages.filter(p => !p.isIndexable).length}</span>
          </>
        ) : tab === 'links' ? (
          <>
            <span>Total: {links.length}</span>
            <span style={{ color: 'var(--accent-blue)' }}>Internal: {links.filter(l => l.isInternal).length}</span>
            <span style={{ color: 'var(--accent-orange)' }}>External: {links.filter(l => !l.isInternal).length}</span>
          </>
        ) : tab === 'serp' ? (
          <>
            <span>Results: {serpResults.length}</span>
            <span>Keywords: {new Set(serpResults.map(s => s.keyword)).size}</span>
            <span style={{ color: 'var(--accent-green)' }}>Top 3: {serpResults.filter(s => s.position <= 3).length}</span>
            <span style={{ color: 'var(--accent-blue)' }}>Top 10: {serpResults.filter(s => s.position <= 10).length}</span>
          </>
        ) : (
          <>
            <span>Total: {images.length}</span>
            <span style={{ color: 'var(--accent-red)' }}>Missing alt: {images.filter(i => !i.altText).length}</span>
          </>
        )}
        {filteredPages.length !== pages.length && tab !== 'links' && tab !== 'images' && (
          <span>Showing: {filteredPages.length}</span>
        )}
      </div>
    </div>
  );
}
