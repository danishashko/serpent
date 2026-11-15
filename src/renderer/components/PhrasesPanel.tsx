import React, { useMemo, useState } from 'react';
import { LinkData, PageData } from '../../types/index';
import { computePhrases, hasBodyText, PHRASE_SOURCES, PhraseSource, phraseTexts } from '../lib/ngrams';

interface Props {
  crawlId: string | null;
  pages: PageData[];
  links: LinkData[];
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

const LENGTHS = [1, 2, 3, 4];
const ROW_LIMIT = 500;

export default function PhrasesPanel({ crawlId, pages, links, showToast }: Props): React.ReactElement {
  const [source, setSource] = useState<PhraseSource>('title');
  const [n, setN] = useState(2);
  const [minCount, setMinCount] = useState(2);
  const [dropStopwords, setDropStopwords] = useState(true);
  const [filter, setFilter] = useState('');

  const bodyAvailable = useMemo(() => hasBodyText(pages), [pages]);
  const texts = useMemo(() => phraseTexts(source, pages, links), [source, pages, links]);
  const result = useMemo(
    () => computePhrases(texts, { n, minCount, dropStopwords, limit: ROW_LIMIT }),
    [texts, n, minCount, dropStopwords],
  );

  const needle = filter.trim().toLowerCase();
  const rows = needle ? result.rows.filter(r => r.phrase.includes(needle)) : result.rows;
  const sourceLabel = PHRASE_SOURCES.find(s => s.key === source)?.label ?? source;

  const exportRows = (): { rows: Record<string, unknown>[]; filename: string } => ({
    rows: rows.map(r => ({
      phrase: r.phrase,
      words: n,
      occurrences: r.count,
      pages: r.pages,
      pages_pct: result.pagesAnalyzed ? Math.round((r.pages / result.pagesAnalyzed) * 1000) / 10 : 0,
      source: sourceLabel,
    })),
    filename: `serpent-${crawlId ?? 'crawl'}-phrases-${source}-${n}word`,
  });

  const handleExport = async (format: 'csv' | 'xlsx'): Promise<void> => {
    const data = exportRows();
    if (data.rows.length === 0) { showToast('No phrases to export', 'warning'); return; }
    const result = format === 'csv'
      ? await window.api.exportCsv({ rows: data.rows, filename: `${data.filename}.csv` })
      : await window.api.exportXlsx({ rows: data.rows, filename: `${data.filename}.xlsx`, sheetName: 'Phrases' });
    if (result.success) showToast(`Phrases exported (${data.rows.length} rows)`, 'success');
  };

  const chip = (active: boolean): React.CSSProperties => ({
    fontSize: 12,
    padding: '3px 10px',
    borderRadius: 'var(--radius)',
    border: '1px solid var(--border)',
    background: active ? 'var(--tint-blue)' : 'transparent',
    color: active ? 'var(--accent-blue)' : 'var(--text-secondary)',
    cursor: 'pointer',
  });

  return (
    <div data-testid="phrases-panel" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <select
          className="input"
          data-testid="phrases-source"
          style={{ padding: '3px 8px', fontSize: 12 }}
          value={source}
          onChange={e => setSource(e.target.value as PhraseSource)}
        >
          {PHRASE_SOURCES.map(s => (
            <option key={s.key} value={s.key} disabled={s.key === 'body' && !bodyAvailable}>
              {s.label}{s.key === 'body' && !bodyAvailable ? ' (not stored for this crawl)' : ''}
            </option>
          ))}
        </select>

        <div style={{ display: 'flex', gap: 4 }} role="group" aria-label="Words per phrase">
          {LENGTHS.map(len => (
            <button key={len} data-testid={`phrases-n-${len}`} style={chip(n === len)} onClick={() => setN(len)}>
              {len} {len === 1 ? 'word' : 'words'}
            </button>
          ))}
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
          Min. occurrences
          <input
            className="input"
            type="number"
            min={1}
            style={{ width: 56, padding: '3px 6px', fontSize: 12 }}
            value={minCount}
            onChange={e => setMinCount(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={dropStopwords} onChange={e => setDropStopwords(e.target.checked)} />
          Skip English stopwords
        </label>

        <input
          className="input"
          style={{ width: 180, padding: '3px 8px', fontSize: 12 }}
          placeholder="Filter phrases…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />

        <div style={{ flex: 1 }} />
        <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => handleExport('csv')}>↓ CSV</button>
        <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }} onClick={() => handleExport('xlsx')}>↓ XLSX</button>
      </div>

      <div data-testid="phrases-summary" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {result.pagesAnalyzed.toLocaleString()} {result.pagesAnalyzed === 1 ? 'page' : 'pages'} · {result.distinct.toLocaleString()} distinct {n === 1 ? 'words' : 'phrases'}
        {result.rows.length === ROW_LIMIT && ` · top ${ROW_LIMIT} shown`}
        {result.truncated && ' · stopped early: the crawl has more text than fits in one pass'}
        {!bodyAvailable && source !== 'body' && ' · body text needs the "Store page text" crawl option'}
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>{n === 1 ? 'Word' : 'Phrase'}</th>
            <th style={{ textAlign: 'right' }}>Occurrences</th>
            <th style={{ textAlign: 'right' }}>Pages</th>
            <th style={{ textAlign: 'right' }}>% of pages</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="table-empty">
                {pages.length === 0 ? 'Run a crawl to see its phrases.' : 'No phrases match. Lower the minimum occurrences or pick another source.'}
              </td>
            </tr>
          )}
          {rows.map(r => (
            <tr key={r.phrase} data-testid="phrase-row">
              <td>{r.phrase}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.count.toLocaleString()}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.pages.toLocaleString()}</td>
              <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {result.pagesAnalyzed ? ((r.pages / result.pagesAnalyzed) * 100).toFixed(1) : '0.0'}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
