import type { CrawlDiff } from '../../types';

interface CrawlComparisonProps {
  diffs: CrawlDiff[];
  onClose: () => void;
}

const statusColors: Record<string, string> = {
  added: 'var(--accent-green)',
  removed: 'var(--accent-red)',
  changed: 'var(--accent-orange)',
  unchanged: 'var(--text-muted)',
};

export default function CrawlComparison({ diffs, onClose }: CrawlComparisonProps) {
  const sorted = [...diffs].sort((a, b) => {
    const order = { removed: 0, changed: 1, added: 2, unchanged: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  const counts = {
    added: diffs.filter(d => d.status === 'added').length,
    removed: diffs.filter(d => d.status === 'removed').length,
    changed: diffs.filter(d => d.status === 'changed').length,
    unchanged: diffs.filter(d => d.status === 'unchanged').length,
  };

  return (
    <div style={{ padding: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>Crawl Comparison</h3>
        <button onClick={onClose} style={{ cursor: 'pointer' }}>✕ Close</button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', fontSize: '0.85rem' }}>
        <span style={{ color: statusColors.added }}>+{counts.added} added</span>
        <span style={{ color: statusColors.removed }}>−{counts.removed} removed</span>
        <span style={{ color: statusColors.changed }}>~{counts.changed} changed</span>
        <span style={{ color: statusColors.unchanged }}>{counts.unchanged} unchanged</span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Status</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>URL</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border)' }}>Changes</th>
          </tr>
        </thead>
        <tbody>
          {sorted.filter(d => d.status !== 'unchanged').map((diff, i) => (
            <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '6px 8px', color: statusColors[diff.status], fontWeight: 600, textTransform: 'uppercase', fontSize: '0.75rem' }}>
                {diff.status}
              </td>
              <td style={{ padding: '6px 8px', maxWidth: '400px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {diff.url}
              </td>
              <td style={{ padding: '6px 8px' }}>
                {diff.changes.map((c, j) => (
                  <div key={j} style={{ fontSize: '0.75rem' }}>
                    <strong>{c.field}:</strong>{' '}
                    <span style={{ color: statusColors.removed, textDecoration: 'line-through' }}>{String(c.oldValue ?? '(empty)')}</span>
                    {' → '}
                    <span style={{ color: statusColors.added }}>{String(c.newValue ?? '(empty)')}</span>
                  </div>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {counts.unchanged > 0 && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '1rem' }}>
          {counts.unchanged} unchanged pages hidden
        </p>
      )}
    </div>
  );
}
