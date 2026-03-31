import { useMemo, useCallback } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { PageData } from '../../types';

interface SiteMapProps {
  pages: PageData[];
  onPageSelect?: (url: string) => void;
}

interface TreeNode {
  name: string;
  size: number;
  url: string;
  color: string;
  issues: number;
  children?: TreeNode[];
  [key: string]: unknown;
}

function getPageColor(page: PageData): string {
  let critical = 0;
  let warning = 0;

  if ((page.statusCode ?? 0) >= 400) critical++;
  if (!page.title) critical++;
  if (!page.metaDescription) warning++;
  if (!page.h1) warning++;
  if ((page.titleLength ?? 0) > 60) warning++;
  if (!page.hasStructuredData) warning++;
  if (!page.hasHSTS) warning++;

  if (critical > 0) return '#ef4444';
  if (warning > 2) return '#f97316';
  if (warning > 0) return '#f59e0b';
  return '#22c55e';
}

function getIssueCount(page: PageData): number {
  let count = 0;
  if ((page.statusCode ?? 0) >= 400) count++;
  if (!page.title) count++;
  if (!page.metaDescription) count++;
  if (!page.h1) count++;
  if ((page.titleLength ?? 0) > 60) count++;
  if (!page.hasStructuredData) count++;
  if (!page.canonicalUrl && page.statusCode === 200) count++;
  return count;
}

function buildTree(pages: PageData[]): TreeNode[] {
  const pathGroups = new Map<string, PageData[]>();

  for (const page of pages) {
    try {
      const u = new URL(page.url);
      const segments = u.pathname.split('/').filter(Boolean);
      const group = segments.length > 0 ? '/' + segments[0] : '/';
      if (!pathGroups.has(group)) pathGroups.set(group, []);
      pathGroups.get(group)!.push(page);
    } catch {
      if (!pathGroups.has('/')) pathGroups.set('/', []);
      pathGroups.get('/')!.push(page);
    }
  }

  const tree: TreeNode[] = [];
  for (const [group, groupPages] of pathGroups) {
    if (groupPages.length === 1) {
      const p = groupPages[0];
      tree.push({
        name: p.url,
        size: Math.max(p.linkScore || 1, 1),
        url: p.url,
        color: getPageColor(p),
        issues: getIssueCount(p),
      });
    } else {
      tree.push({
        name: group,
        size: 0,
        url: '',
        color: '#666',
        issues: 0,
        children: groupPages.map(p => ({
          name: p.url,
          size: Math.max(p.linkScore || 1, 1),
          url: p.url,
          color: getPageColor(p),
          issues: getIssueCount(p),
        })),
      });
    }
  }

  return tree;
}

interface CustomContentProps {
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  color: string;
  url: string;
  issues: number;
}

function CustomTreemapContent(props: CustomContentProps) {
  const { x, y, width, height, name, color } = props;
  if (width < 4 || height < 4) return null;

  let label = '';
  try {
    const u = new URL(name);
    label = u.pathname === '/' ? u.hostname : u.pathname;
  } catch {
    label = name;
  }

  const maxChars = Math.floor(width / 7);
  if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…';

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        style={{
          fill: color,
          stroke: '#1a1a2e',
          strokeWidth: 2,
          opacity: 0.85,
          cursor: 'pointer',
        }}
      />
      {width > 40 && height > 20 && (
        <text
          x={x + width / 2}
          y={y + height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          style={{
            fontSize: Math.min(12, Math.max(8, width / 12)),
            fill: '#fff',
            pointerEvents: 'none',
            fontWeight: 500,
          }}
        >
          {label}
        </text>
      )}
    </g>
  );
}

interface TooltipPayloadItem {
  payload: {
    name: string;
    size: number;
    issues: number;
    color: string;
  };
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayloadItem[] }) {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0].payload;
  return (
    <div style={{
      background: 'var(--bg-elevated, #1e1e2e)',
      border: '1px solid var(--border, #333)',
      padding: '8px 12px',
      borderRadius: '6px',
      fontSize: '0.8rem',
    }}>
      <div style={{ fontWeight: 600, marginBottom: 4, maxWidth: 300, wordBreak: 'break-all' }}>{data.name}</div>
      <div>Score: {data.size}</div>
      <div>Issues: {data.issues}</div>
    </div>
  );
}

export default function SiteMap({ pages, onPageSelect }: SiteMapProps) {
  const treeData = useMemo(() => buildTree(pages), [pages]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = useCallback((node: any) => {
    if (node?.url && onPageSelect) onPageSelect(node.url);
  }, [onPageSelect]);

  if (pages.length === 0) {
    return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted, #888)' }}>No pages to visualize</div>;
  }

  const summary = {
    healthy: pages.filter(p => getIssueCount(p) === 0).length,
    withIssues: pages.filter(p => getIssueCount(p) > 0).length,
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '1rem', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#22c55e', marginRight: 4 }} />Healthy: {summary.healthy}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: '#f59e0b', marginRight: 4 }} />With issues: {summary.withIssues}</span>
        <span style={{ color: 'var(--text-muted, #888)' }}>Size = Link Score</span>
      </div>
      <div style={{ flex: 1, minHeight: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treeData}
            dataKey="size"
            stroke="#1a1a2e"
            content={<CustomTreemapContent x={0} y={0} width={0} height={0} name="" color="" url="" issues={0} />}
            onClick={handleClick}
            isAnimationActive={false}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
