import React, { useState } from 'react';

const FREE_TIER_LIMIT = 1000;

interface Props {
  mode: 'warn' | 'hard';
  totalCrawled: number;
  onClose?: () => void;
  onActivated: () => void;
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function LicenseGate({ mode, totalCrawled, onClose, onActivated, showToast }: Props): React.ReactElement {
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);

  const pct = Math.min(100, Math.round((totalCrawled / FREE_TIER_LIMIT) * 100));

  const handleActivate = async () => {
    if (!licenseKey.trim()) {
      showToast('Please enter your license key.', 'error');
      return;
    }
    setActivating(true);
    try {
      const result = await window.api.licenseActivate(licenseKey.trim());
      if (result.success) {
        showToast('License activated — you now have unlimited crawls!', 'success');
        onActivated();
      } else {
        showToast(result.error ?? 'Activation failed.', 'error');
      }
    } catch (e) {
      showToast(String(e), 'error');
    } finally {
      setActivating(false);
    }
  };

  const isHard = mode === 'hard';

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.72)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '28px 32px',
        width: 420,
        maxWidth: '90vw',
      }}>
        {/* Header */}
        <div style={{ marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: isHard ? 'var(--red)' : 'var(--accent-yellow, #e5a700)' }}>
            {isHard ? '🚫 Free Tier Limit Reached' : '⚠️ Approaching Free Tier Limit'}
          </h2>
          <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>
            {isHard
              ? 'You have used all 1,000 free URLs. Activate a Pro license to keep crawling.'
              : 'You are approaching your 1,000-URL free tier limit. Upgrade now for unlimited crawls.'}
          </p>
        </div>

        {/* Usage bar */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            <span>{totalCrawled.toLocaleString()} URLs used</span>
            <span>{FREE_TIER_LIMIT.toLocaleString()} limit</span>
          </div>
          <div style={{ height: 8, background: 'var(--bg-tertiary, #2a2a2a)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: isHard ? 'var(--red, #e05252)' : 'var(--accent-yellow, #e5a700)',
              borderRadius: 4,
              transition: 'width 0.3s',
            }} />
          </div>
        </div>

        {/* License key input */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
            License Key
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={licenseKey}
              onChange={e => setLicenseKey(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleActivate(); }}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              style={{
                flex: 1, padding: '7px 10px', borderRadius: 6,
                background: 'var(--bg-primary)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', fontSize: 13, fontFamily: 'monospace',
              }}
              autoFocus
            />
            <button
              className="btn-primary"
              onClick={handleActivate}
              disabled={activating}
              style={{ whiteSpace: 'nowrap' }}
            >
              {activating ? 'Activating…' : 'Activate'}
            </button>
          </div>
        </div>

        {/* CTA */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <a
            href="https://serpent.app/pricing"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block', padding: '8px 18px', borderRadius: 6,
              background: 'var(--accent-green)', color: '#000',
              fontWeight: 700, fontSize: 13, textDecoration: 'none',
            }}
          >
            Get Pro — $4.99/mo →
          </a>
          {!isHard && onClose && (
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              Remind me later
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
