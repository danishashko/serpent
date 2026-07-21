import { describe, it, expect } from 'vitest';
import { simhash64, hammingDistanceHex, NEAR_DUPLICATE_MAX_DISTANCE, SIMHASH_MIN_WORDS } from '../main/simhash';

const BASE_TEXT =
  'The quick brown fox jumps over the lazy dog while the sun sets behind the mountains. ' +
  'Search engine optimization requires careful attention to page titles meta descriptions and heading structure. ' +
  'Crawlers discover links follow redirects and record status codes for every page they visit. ' +
  'Duplicate content confuses ranking systems because they cannot decide which version deserves to appear in results. ' +
  'A good site architecture keeps important pages within three clicks of the home page and avoids orphans entirely.';

describe('simhash64', () => {
  it('is deterministic and 16 hex chars', () => {
    const a = simhash64(BASE_TEXT);
    const b = simhash64(BASE_TEXT);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('returns null below the minimum word count', () => {
    expect(simhash64('too few words here')).toBeNull();
    expect(simhash64(Array(SIMHASH_MIN_WORDS - 1).fill('word').join(' '))).toBeNull();
  });

  it('near-identical texts land within the near-duplicate threshold', () => {
    const edited = BASE_TEXT.replace('lazy dog', 'sleepy cat').replace('three clicks', 'four clicks');
    const d = hammingDistanceHex(simhash64(BASE_TEXT)!, simhash64(edited)!);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThanOrEqual(NEAR_DUPLICATE_MAX_DISTANCE);
  });

  it('unrelated texts land far outside the threshold', () => {
    const other =
      'Quarterly financial statements show revenue growth across all regional markets this fiscal year. ' +
      'The board approved a new dividend policy and repurchase program after reviewing cash flow projections. ' +
      'Analysts expect margin expansion as supply chain costs normalize and pricing actions take hold. ' +
      'Management guided toward double digit earnings growth citing strong demand in enterprise segments. ' +
      'Currency headwinds partially offset gains from the newly acquired subsidiary in the European region.';
    const d = hammingDistanceHex(simhash64(BASE_TEXT)!, simhash64(other)!);
    expect(d).toBeGreaterThan(NEAR_DUPLICATE_MAX_DISTANCE);
  });
});

describe('hammingDistanceHex', () => {
  it('computes exact bit distances', () => {
    expect(hammingDistanceHex('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistanceHex('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistanceHex('0000000000000000', '0000000000000001')).toBe(1);
    expect(hammingDistanceHex('8000000000000000', '0000000000000000')).toBe(1);
    expect(hammingDistanceHex('00000000000000ff', '0000000000000000')).toBe(8);
  });
});
