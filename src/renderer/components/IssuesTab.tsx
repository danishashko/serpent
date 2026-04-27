import React, { useMemo, useState } from 'react';
import { PageData, IssueCategory, IssueInstance, IssueSeverity } from '../../types/index';
import { computeIssues, categoryLabel, getCategories } from '../lib/issues-detector';

interface Props {
  pages: PageData[];
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = {
  critical: 0,
  warning: 1,
  opportunity: 2,
  info: 3,
};

const SEVERITY_COLOR: Record<IssueSeverity, string> = {
  critical: '#f85149',
  warning: '#d29922',
  opportunity: '#58a6ff',
  info: '#8b949e',
};

export default function IssuesTab({ pages }: Props): React.ReactElement {
  const issues = useMemo(() => computeIssues(pages), [pages]);

  const byCategory = useMemo(() => {
    const m = new Map<IssueCategory, IssueInstance[]>();
    for (const cat of getCategories()) m.set(cat, []);
    for (const i of issues) {
      const arr = m.get(i.category);
      if (arr) arr.push(i);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) ||
        (b.affectedUrls.length - a.affectedUrls.length),
      );
    }
    return m;
  }, [issues]);

  const categories = getCategories().filter((c) => (byCategory.get(c)?.length ?? 0) > 0);

  const [activeCategory, setActiveCategory] = useState<IssueCategory | null>(categories[0] ?? null);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);

  // Re-derive active issue/category if data changes.
  const safeCategory: IssueCategory | null = activeCategory && categories.includes(activeCategory)
    ? activeCategory
    : (categories[0] ?? null);

  const issuesInCategory = safeCategory ? byCategory.get(safeCategory) ?? [] : [];
  const safeIssue = issuesInCategory.find((i) => i.id === activeIssueId) ?? issuesInCategory[0] ?? null;

  const totalAffected = issues.reduce((acc, i) => acc + i.affectedUrls.length, 0);

  if (issues.length === 0) {
    return (
      <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
        No issues detected. Run a crawl to populate this view.
      </div>
    );
  }

  return (
    <div
      data-testid="issues-tab"
      style={{
        display: 'grid',
        gridTemplateColumns: '220px 1fr 1.4fr',
        gap: 0,
        height: '100%',
        minHeight: 0,
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {/* ── Pane 1: categories ── */}
      <div
        data-testid="issues-categories"
        style={{
          borderRight: '1px solid var(--border)',
          background: 'var(--bg-secondary)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '8px 12px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          Issues ({totalAffected})
        </div>
        {categories.map((c) => {
          const list = byCategory.get(c) ?? [];
          const total = list.reduce((acc, i) => acc + i.affectedUrls.length, 0);
          const worst = list[0]?.severity ?? 'info';
          return (
            <button
              key={c}
              onClick={() => { setActiveCategory(c); setActiveIssueId(null); }}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                borderLeft: `3px solid ${safeCategory === c ? SEVERITY_COLOR[worst] : 'transparent'}`,
                background: safeCategory === c ? 'var(--bg-primary)' : 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                color: 'var(--text-primary)',
                textAlign: 'left',
              }}
            >
              <span>{categoryLabel(c)}</span>
              <span style={{
                fontSize: 10,
                color: 'var(--text-muted)',
                background: 'var(--bg-primary)',
                padding: '2px 6px',
                borderRadius: 10,
                border: '1px solid var(--border)',
              }}>{total}</span>
            </button>
          );
        })}
      </div>

      {/* ── Pane 2: issues in category ── */}
      <div
        data-testid="issues-list"
        style={{ borderRight: '1px solid var(--border)', overflowY: 'auto' }}
      >
        {issuesInCategory.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>No issues.</div>
        ) : (
          issuesInCategory.map((i) => (
            <button
              key={i.id}
              onClick={() => setActiveIssueId(i.id)}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                width: '100%',
                padding: '10px 12px',
                border: 'none',
                borderBottom: '1px solid var(--border)',
                background: safeIssue?.id === i.id ? 'var(--bg-secondary)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span
                aria-label={i.severity}
                style={{
                  flexShrink: 0,
                  marginTop: 4,
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  background: SEVERITY_COLOR[i.severity],
                }}
              />
              <span style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: 'var(--text-primary)' }}>{i.title}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>{i.severity}</div>
              </span>
              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11,
                  color: 'var(--text-secondary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {i.affectedUrls.length}
              </span>
            </button>
          ))
        )}
      </div>

      {/* ── Pane 3: affected URLs ── */}
      <div
        data-testid="issues-affected"
        style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {safeIssue ? (
          <>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 10, height: 10, borderRadius: 5,
                    background: SEVERITY_COLOR[safeIssue.severity],
                  }}
                />
                <h3 style={{ margin: 0, fontSize: 14 }}>{safeIssue.title}</h3>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {safeIssue.description}
              </p>
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
                {safeIssue.affectedUrls.length} affected URL{safeIssue.affectedUrls.length === 1 ? '' : 's'}
              </p>
            </div>
            <ul
              data-testid="issues-affected-list"
              style={{ listStyle: 'none', margin: 0, padding: 0, overflowY: 'auto', flex: 1 }}
            >
              {safeIssue.affectedUrls.map((u) => (
                <li
                  key={u}
                  style={{
                    padding: '6px 14px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    color: 'var(--text-secondary)',
                    borderBottom: '1px solid var(--border)',
                    wordBreak: 'break-all',
                  }}
                >
                  {u}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <div style={{ padding: 16, color: 'var(--text-muted)', fontSize: 12 }}>
            Select an issue to see affected URLs.
          </div>
        )}
      </div>
    </div>
  );
}
