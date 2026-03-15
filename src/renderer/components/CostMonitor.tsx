import React, { useState, useEffect } from 'react';
import { CrawlProgress, UsageStats } from '../../types/index';

interface Props {
  progress: CrawlProgress;
}

export default function CostMonitor({ progress }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<UsageStats | null>(null);

  useEffect(() => {
    if (expanded && !stats) {
      window.api.getUsageStats().then(setStats).catch(() => {});
    }
  }, [expanded, stats]);

  const pct = progress.costLimitUsd > 0
    ? Math.min(1, progress.totalSpendUsd / progress.costLimitUsd)
    : 0;

  const barColor = pct > 0.9 ? 'var(--accent-red)' : pct > 0.7 ? 'var(--accent-orange)' : 'var(--accent-green)';

  const maxDailyCost = stats ? Math.max(...stats.dailyHistory.map(d => d.cost), 0.001) : 1;

  return (
    <div style={{
      padding: '10px 12px',
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
      flexShrink: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11 }}>
        <span
          style={{ color: 'var(--text-secondary)', fontWeight: 600, cursor: 'pointer' }}
          onClick={() => setExpanded(e => !e)}
        >
          ☁️ Bright Data Cost {expanded ? '▾' : '▸'}
        </span>
        <span style={{ color: barColor, fontVariantNumeric: 'tabular-nums' }}>
          ${progress.totalSpendUsd.toFixed(4)} / ${progress.costLimitUsd.toFixed(2)}
        </span>
      </div>
      <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct * 100}%`, background: barColor, borderRadius: 3, transition: 'width 0.3s ease' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: 'var(--text-muted)' }}>
        <span>{(pct * 100).toFixed(1)}% used</span>
        <span>${(progress.costLimitUsd - progress.totalSpendUsd).toFixed(4)} remaining</span>
      </div>

      {expanded && stats && (
        <div style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
          {/* Summary row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <span>Today: <strong>${stats.todaySpend.toFixed(4)}</strong></span>
            <span>All time: <strong>${stats.totalSpend.toFixed(4)}</strong></span>
          </div>

          {/* Daily history mini bar chart */}
          {stats.dailyHistory.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>Daily Spend (last 30d)</div>
              <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end', height: 40 }}>
                {stats.dailyHistory.slice(0, 14).reverse().map(d => (
                  <div
                    key={d.date}
                    title={`${d.date}: $${d.cost.toFixed(4)} (${d.requests} req)`}
                    style={{
                      flex: 1,
                      minWidth: 4,
                      height: `${Math.max(2, (d.cost / maxDailyCost) * 100)}%`,
                      background: 'var(--accent-blue)',
                      borderRadius: '2px 2px 0 0',
                      opacity: 0.7,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Recent crawl costs */}
          {stats.crawlHistory.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4, fontWeight: 600 }}>Cost per Crawl</div>
              {stats.crawlHistory.slice(0, 5).map(c => (
                <div key={c.crawlId} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-secondary)', padding: '1px 0' }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                    {c.startUrl}
                  </span>
                  <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent-orange)' }}>
                    ${c.cost.toFixed(4)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
