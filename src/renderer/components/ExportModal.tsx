import { useState } from 'react';
import { BulkExportCategory, ExportFormat } from '../../types/index';

interface Props {
  crawlId: string;
  onClose: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

interface CategoryGroup {
  label: string;
  items: { key: BulkExportCategory; label: string }[];
}

const GROUPS: CategoryGroup[] = [
  {
    label: 'Links',
    items: [
      { key: 'all_inlinks', label: 'All Inlinks' },
      { key: 'all_outlinks', label: 'All Outlinks' },
      { key: 'internal_links', label: 'Internal Links' },
      { key: 'external_links', label: 'External Links' },
    ],
  },
  {
    label: 'Links by Status',
    items: [
      { key: 'inlinks_to_3xx', label: 'Inlinks to 3xx' },
      { key: 'inlinks_to_4xx', label: 'Inlinks to 4xx' },
      { key: 'inlinks_to_5xx', label: 'Inlinks to 5xx' },
    ],
  },
  {
    label: 'Pages',
    items: [
      { key: 'all_pages_full', label: 'All Pages (Full)' },
      { key: 'pages_2xx', label: '2xx Pages' },
      { key: 'pages_3xx', label: '3xx Pages' },
      { key: 'pages_4xx', label: '4xx Pages' },
      { key: 'pages_5xx', label: '5xx Pages' },
      { key: 'non_indexable_pages', label: 'Non-Indexable Pages' },
    ],
  },
  {
    label: 'Images',
    items: [
      { key: 'all_images', label: 'All Images' },
      { key: 'images_missing_alt', label: 'Images Missing Alt' },
    ],
  },
  {
    label: 'Scores',
    items: [
      { key: 'geo_scores', label: 'GEO/AEO Scores' },
      { key: 'perf_scores', label: 'Performance Scores' },
    ],
  },
  {
    label: 'Other',
    items: [
      { key: 'redirects', label: 'Redirects' },
      { key: 'hreflang', label: 'Hreflang' },
      { key: 'duplicates', label: 'Duplicates' },
      { key: 'custom_extractions', label: 'Custom Extractions' },
    ],
  },
];

export default function ExportModal({ crawlId, onClose, showToast }: Props) {
  const [selected, setSelected] = useState<Set<BulkExportCategory>>(new Set());
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [exporting, setExporting] = useState(false);

  const toggle = (key: BulkExportCategory) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (group: CategoryGroup) => {
    const allSelected = group.items.every(i => selected.has(i.key));
    setSelected(prev => {
      const next = new Set(prev);
      group.items.forEach(i => allSelected ? next.delete(i.key) : next.add(i.key));
      return next;
    });
  };

  const selectAll = () => {
    const allKeys = GROUPS.flatMap(g => g.items.map(i => i.key));
    const allSelected = allKeys.every(k => selected.has(k));
    setSelected(allSelected ? new Set() : new Set(allKeys));
  };

  const handleExport = async () => {
    if (selected.size === 0) return;
    setExporting(true);
    try {
      const result = await (window as any).api.exportBulk({
        crawlId,
        categories: Array.from(selected),
        format,
      });
      if (result.success) {
        const msg = result.totalFiles
          ? `Exported ${result.totalFiles} files (${result.totalRows} rows) to ${result.filePath}`
          : `Exported ${result.totalRows} rows to ${result.filePath}`;
        showToast(msg, 'success');
        onClose();
      } else if (result.cancelled) {
        // user cancelled dialog, do nothing
      } else {
        showToast(result.error || 'Export failed', 'error');
      }
    } catch (err) {
      showToast(String(err), 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', padding: 24, width: 520, maxHeight: '80vh',
        overflowY: 'auto', boxShadow: 'var(--shadow)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontSize: 16, color: 'var(--text-primary)' }}>Bulk Export</h3>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: 16, padding: '2px 8px' }}>✕</button>
        </div>

        {/* Format selector + select all */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
            <input type="radio" name="fmt" checked={format === 'csv'} onChange={() => setFormat('csv')} /> CSV
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>
            <input type="radio" name="fmt" checked={format === 'json'} onChange={() => setFormat('json')} /> JSON
          </label>
          <div style={{ flex: 1 }} />
          <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 8px' }} onClick={selectAll}>
            {GROUPS.flatMap(g => g.items.map(i => i.key)).every(k => selected.has(k)) ? 'Deselect All' : 'Select All'}
          </button>
        </div>

        {/* Category groups */}
        {GROUPS.map(group => (
          <div key={group.label} style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: 'var(--text-muted)', marginBottom: 4, cursor: 'pointer', userSelect: 'none',
              }}
              onClick={() => toggleGroup(group)}
            >
              {group.label}
              <span style={{ fontWeight: 400, marginLeft: 6, color: 'var(--text-secondary)' }}>
                ({group.items.filter(i => selected.has(i.key)).length}/{group.items.length})
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
              {group.items.map(item => (
                <label
                  key={item.key}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
                    color: selected.has(item.key) ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: 12, cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggle(item.key)} />
                  {item.label}
                </label>
              ))}
            </div>
          </div>
        ))}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <button className="btn-ghost" onClick={onClose} style={{ fontSize: 12, padding: '5px 14px' }}>Cancel</button>
          <button
            className="btn-primary"
            disabled={selected.size === 0 || exporting}
            onClick={handleExport}
            style={{ fontSize: 12, padding: '5px 14px' }}
          >
            {exporting ? 'Exporting…' : `Export ${selected.size} ${selected.size === 1 ? 'category' : 'categories'}`}
          </button>
        </div>
      </div>
    </div>
  );
}
