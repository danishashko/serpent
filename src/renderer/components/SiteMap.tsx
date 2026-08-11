import { useMemo, useCallback } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { PageData } from '../../types';
import { computeIssues } from '../lib/issues-detector';

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

export interface PageHealth {
  critical: number;
  warning: number;
  total: number;
}

const EMPTY_HEALTH: PageHealth = { critical: 0, warning: 0, total: 0 };

/**
 * Health is derived from issues-detector, the same source the Issues tab uses,
 * rather than a second hardcoded rule set that could disagree with it.
 *
 * Only critical and warning count against a page. Treating every finding as a
 * problem meant a missing JSON-LD block or Open Graph tag marked a page
 * unhealthy, and since almost no page on almost any site has all of those, the
 * legend read "Healthy: 0" and the map rendered as one flat colour everywhere.
 */
export function buildHealth(pages: PageData[]): Map<string, PageHealth> {
  const health = new Map<string, PageHealth>();
  for (const p of pages) health.set(p.url, { critical: 0, warning: 0, total: 0 });

  for (const issue of computeIssues(pages)) {
    for (const url of issue.affectedUrls) {
      const h = health.get(url);
      if (!h) continue;
      h.total++;
      if (issue.severity === 'critical') h.critical++;
      else if (issue.severity === 'warning') h.warning++;
    }
  }
  return health;
}

function getPageColor(h: PageHealth): string {
  if (h.critical > 0) return 'var(--map-bad)';
  if (h.warning > 2) return 'var(--map-alert)';
  if (h.warning > 0) return 'var(--map-warn)';
  return 'var(--map-ok)';
}

function buildTree(pages: PageData[], health: Map<string, PageHealth>): TreeNode[] {
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
    const node = (p: PageData) => {
      const h = health.get(p.url) ?? EMPTY_HEALTH;
      return {
        name: p.url,
        size: Math.max(p.linkScore || 1, 1),
        url: p.url,
        color: getPageColor(h),
        issues: h.total,
      };
    };

    if (groupPages.length === 1) {
      tree.push(node(groupPages[0]));
    } else {
      tree.push({
        name: group,
        size: 0,
        url: '',
        color: 'var(--map-group)',
        issues: 0,
        children: groupPages.map(node),
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
          stroke: 'var(--map-stroke)',
          strokeWidth: 2,
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
            fill: 'var(--map-label)',
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
      background: 'var(--bg-secondary)',
      border: '1px solid var(--border)',
      color: 'var(--text-primary)',
      boxShadow: 'var(--shadow)',
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
  const health = useMemo(() => buildHealth(pages), [pages]);
  const treeData = useMemo(() => buildTree(pages, health), [pages, health]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = useCallback((node: any) => {
    if (node?.url && onPageSelect) onPageSelect(node.url);
  }, [onPageSelect]);

  if (pages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-icon">🗺</div>
        <div className="empty-title">Nothing to map yet</div>
        <div className="empty-hint">Run a crawl and every page shows up here sized by link score.</div>
      </div>
    );
  }

  const isHealthy = (p: PageData) => {
    const h = health.get(p.url) ?? EMPTY_HEALTH;
    return h.critical === 0 && h.warning === 0;
  };
  const summary = {
    healthy: pages.filter(isHealthy).length,
    withIssues: pages.filter(p => !isHealthy(p)).length,
  };

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: '1rem', padding: '0.5rem 1rem', fontSize: '0.8rem' }}>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--map-ok)', marginRight: 4 }} />Healthy: {summary.healthy}</span>
        <span><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: 'var(--map-warn)', marginRight: 4 }} />With issues: {summary.withIssues}</span>
        <span style={{ color: 'var(--text-muted)' }}>Size = Link Score</span>
      </div>
      <div style={{ flex: 1, minHeight: 400 }}>
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treeData}
            dataKey="size"
            stroke="var(--map-stroke)"
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
