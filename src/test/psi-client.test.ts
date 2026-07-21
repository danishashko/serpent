import { describe, it, expect } from 'vitest';
import { parsePsiResponse, isPsiReachable } from '../main/psi-client';

const FULL_RESPONSE = {
  lighthouseResult: {
    categories: { performance: { score: 0.93 } },
    audits: {
      'largest-contentful-paint': { numericValue: 1840.5 },
      'cumulative-layout-shift': { numericValue: 0.012 },
      'total-blocking-time': { numericValue: 150 },
      'first-contentful-paint': { numericValue: 902.3 },
      'speed-index': { numericValue: 2100 },
    },
  },
  loadingExperience: {
    metrics: {
      LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2200 },
      INTERACTION_TO_NEXT_PAINT: { percentile: 180 },
      CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 5 },
    },
    overall_category: 'FAST',
  },
};

describe('parsePsiResponse', () => {
  it('extracts lab + field metrics from a full response', () => {
    const s = parsePsiResponse(FULL_RESPONSE, 'p1', 'c1', 'https://x.com/', 'mobile');
    expect(s.performanceScore).toBe(93);
    expect(s.lcpMs).toBe(1840.5);
    expect(s.clsValue).toBe(0.012);
    expect(s.tbtMs).toBe(150);
    expect(s.fcpMs).toBe(902.3);
    expect(s.speedIndexMs).toBe(2100);
    expect(s.fieldLcpMs).toBe(2200);
    expect(s.fieldInpMs).toBe(180);
    expect(s.fieldCls).toBe(0.05); // CrUX reports CLS ×100
    expect(s.fieldOverallCategory).toBe('FAST');
    expect(s.strategy).toBe('mobile');
  });

  it('handles missing field data (low-traffic URL) gracefully', () => {
    const s = parsePsiResponse({ lighthouseResult: FULL_RESPONSE.lighthouseResult }, 'p1', 'c1', 'https://x.com/', 'desktop');
    expect(s.performanceScore).toBe(93);
    expect(s.fieldLcpMs).toBeNull();
    expect(s.fieldInpMs).toBeNull();
    expect(s.fieldCls).toBeNull();
    expect(s.fieldOverallCategory).toBeNull();
  });

  it('ignores origin-fallback field data (not URL-level)', () => {
    const s = parsePsiResponse(
      { ...FULL_RESPONSE, loadingExperience: { ...FULL_RESPONSE.loadingExperience, origin_fallback: true } },
      'p1', 'c1', 'https://x.com/', 'mobile'
    );
    expect(s.fieldLcpMs).toBeNull();
    expect(s.fieldOverallCategory).toBeNull();
  });

  it('handles a fully empty response without throwing', () => {
    const s = parsePsiResponse({}, 'p1', 'c1', 'https://x.com/', 'mobile');
    expect(s.performanceScore).toBeNull();
    expect(s.lcpMs).toBeNull();
  });
});

describe('isPsiReachable', () => {
  it('accepts public http/https URLs only', () => {
    expect(isPsiReachable('https://example.com/page')).toBe(true);
    expect(isPsiReachable('http://127.0.0.1:8099/')).toBe(false);
    expect(isPsiReachable('http://localhost/')).toBe(false);
    expect(isPsiReachable('http://192.168.1.5/')).toBe(false);
    expect(isPsiReachable('http://10.0.0.1/')).toBe(false);
    expect(isPsiReachable('http://172.20.1.1/')).toBe(false);
    expect(isPsiReachable('ftp://example.com/')).toBe(false);
    expect(isPsiReachable('not a url')).toBe(false);
  });
});
