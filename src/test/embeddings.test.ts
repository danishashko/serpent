import { describe, it, expect } from 'vitest';
import {
  normalize,
  cosineSimilarity,
  centroid,
  encodeVector,
  decodeVector,
  textForPage,
  analyzeSemantics,
  rankByQuery,
  mostRepresentative,
  MAX_EMBED_CHARS,
} from '../main/embeddings';
import type { PageData } from '../types/index';

function page(over: Partial<PageData>): PageData {
  return {
    id: 'p', crawlId: 'c', url: 'https://example.com/', statusCode: 200, contentType: 'text/html',
    title: null, titleLength: null, titlePixelWidth: null, metaDescription: null,
    metaDescLength: null, metaDescPixelWidth: null, h1: null, h2: null, wordCount: null,
    canonicalUrl: null, isCanonicalized: false, isIndexable: true, responseTimeMs: null,
    pageSizeBytes: null, crawlDepth: 0, costUsd: 0, createdAt: '', contentHash: null,
    h1Length: null, h2Length: null, h1Count: 0, h2Count: 0, robotsDirectives: null,
    metaKeywords: null, textRatio: null, ogTitle: null, ogDescription: null, ogImage: null,
    ogType: null, twitterCard: null, twitterTitle: null, twitterDescription: null,
    twitterImage: null, schemaTypes: null, schemaJson: null, schemaErrors: null,
    hasStructuredData: false, hasHSTS: false, hasCSP: false, xFrameOptions: null,
    xContentTypeOptions: null, imageCount: 0, linkScore: 0, simhash: null,
    uncrawlableOutlinks: 0, bodyText: null,
    ...over,
  };
}

describe('vector maths', () => {
  it('normalises to unit length', () => {
    const n = normalize([3, 4]);
    expect(n[0]).toBeCloseTo(0.6, 10);
    expect(n[1]).toBeCloseTo(0.8, 10);
    expect(Math.hypot(...n)).toBeCloseTo(1, 10);
  });

  it('leaves a zero vector alone instead of producing NaN', () => {
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it('scores identical vectors as 1 and opposite as -1', () => {
    const a = normalize([1, 2, 3]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 10);
    expect(cosineSimilarity(a, a.map(v => -v))).toBeCloseTo(-1, 10);
  });

  it('scores orthogonal vectors as 0', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('returns 0 rather than throwing on mismatched or empty vectors', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0])).toBe(0);
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('never returns a value outside [-1, 1]', () => {
    const a = normalize([1, 1, 1]);
    expect(cosineSimilarity(a, a)).toBeLessThanOrEqual(1);
    expect(cosineSimilarity(a, a.map(v => -v))).toBeGreaterThanOrEqual(-1);
  });

  it('averages to a centroid and normalises it', () => {
    const c = centroid([normalize([1, 0]), normalize([0, 1])]);
    expect(Math.hypot(...c)).toBeCloseTo(1, 10);
    expect(c[0]).toBeCloseTo(c[1], 10);
  });

  it('returns an empty centroid for no vectors', () => {
    expect(centroid([])).toEqual([]);
  });
});

describe('vector storage encoding', () => {
  it('round-trips through a Float32 blob', () => {
    const vec = normalize([0.1, -0.5, 0.9, 0.25]);
    const back = decodeVector(encodeVector(vec));
    expect(back).toHaveLength(vec.length);
    back.forEach((v, i) => expect(v).toBeCloseTo(vec[i], 6));
  });

  it('uses 4 bytes per dimension', () => {
    expect(encodeVector(new Array(768).fill(0)).byteLength).toBe(768 * 4);
  });

  it('round-trips correctly when several vectors share a backing buffer', () => {
    // Buffer.from on a pooled allocation can hand back a view into a larger
    // ArrayBuffer; decode must respect byteOffset or vectors bleed into each other.
    const a = encodeVector(normalize([1, 0, 0]));
    const b = encodeVector(normalize([0, 1, 0]));
    expect(decodeVector(a)[0]).toBeCloseTo(1, 6);
    expect(decodeVector(b)[1]).toBeCloseTo(1, 6);
  });
});

describe('textForPage', () => {
  it('uses body text when the target is text', () => {
    const p = page({ bodyText: 'the actual body copy', title: 'T' });
    expect(textForPage(p, 'text')).toBe('the actual body copy');
  });

  it('caps body text at the embedding limit', () => {
    const p = page({ bodyText: 'x'.repeat(MAX_EMBED_CHARS + 5000) });
    expect(textForPage(p, 'text')).toHaveLength(MAX_EMBED_CHARS);
  });

  it('falls back to metadata when no body text was stored', () => {
    const p = page({ bodyText: null, title: 'Title', metaDescription: 'Meta', h1: 'H1' });
    expect(textForPage(p, 'text')).toBe('Title — Meta — H1');
  });

  it('uses only title and meta for the title target', () => {
    const p = page({ bodyText: 'long body', title: 'Title', metaDescription: 'Meta', h1: 'H1' });
    expect(textForPage(p, 'title')).toBe('Title — Meta');
  });

  it('returns an empty string when a page has nothing to embed', () => {
    expect(textForPage(page({}), 'title')).toBe('');
  });
});

describe('analyzeSemantics', () => {
  const A = { url: 'https://example.com/a', vector: normalize([1, 0, 0]) };
  const ANear = { url: 'https://example.com/a2', vector: normalize([0.99, 0.01, 0]) };
  const B = { url: 'https://example.com/b', vector: normalize([0, 1, 0]) };

  it('finds the closest match for each page', () => {
    const res = analyzeSemantics([A, ANear, B], 0.95);
    const a = res.find(r => r.url === A.url)!;
    expect(a.closestUrl).toBe(ANear.url);
    expect(a.closestScore).toBeGreaterThan(0.99);
  });

  it('counts only pages above the threshold as similar', () => {
    const res = analyzeSemantics([A, ANear, B], 0.95);
    expect(res.find(r => r.url === A.url)!.similarCount).toBe(1);
    expect(res.find(r => r.url === B.url)!.similarCount).toBe(0);
  });

  it('raising the threshold reduces matches', () => {
    // B is orthogonal to A (cosine 0), so it only counts once the threshold
    // drops to 0 — 0.5 still excludes it.
    const countAt = (t: number) =>
      analyzeSemantics([A, ANear, B], t).find(r => r.url === A.url)!.similarCount;
    expect(countAt(0)).toBe(2);
    expect(countAt(0.5)).toBe(1);
    expect(countAt(0.999999)).toBe(0);
  });

  it('never reports a page as similar to itself', () => {
    const res = analyzeSemantics([A, A], 0.95);
    expect(res[0].neighbours.every(n => n !== undefined)).toBe(true);
    expect(res[0].similarCount).toBe(1); // the other copy, not itself
  });

  it('handles a single page with nothing to compare against', () => {
    const res = analyzeSemantics([A], 0.95);
    expect(res[0].closestUrl).toBeNull();
    expect(res[0].similarCount).toBe(0);
    expect(res[0].closestScore).toBe(0);
  });

  it('handles an empty crawl', () => {
    expect(analyzeSemantics([], 0.95)).toEqual([]);
  });

  it('scores an outlier lower on relevance than a cluster member', () => {
    // Three pages about one thing, one page about something else.
    const cluster = [
      { url: 'c1', vector: normalize([1, 0, 0]) },
      { url: 'c2', vector: normalize([0.98, 0.02, 0]) },
      { url: 'c3', vector: normalize([0.97, 0.03, 0]) },
    ];
    const outlier = { url: 'out', vector: normalize([0, 0, 1]) };
    const res = analyzeSemantics([...cluster, outlier], 0.95);
    const outRelevance = res.find(r => r.url === 'out')!.relevanceScore;
    const inRelevance = res.find(r => r.url === 'c1')!.relevanceScore;
    expect(outRelevance).toBeLessThan(inRelevance);
  });

  it('caps stored neighbours so large crawls stay sendable over IPC', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      url: `u${i}`,
      vector: normalize([1, i / 1000, 0]),
    }));
    const res = analyzeSemantics(many, 0.95);
    expect(res[0].neighbours.length).toBeLessThanOrEqual(5);
  });
});

describe('rankByQuery / mostRepresentative', () => {
  const pages = [
    { url: 'a', vector: normalize([1, 0, 0]) },
    { url: 'b', vector: normalize([0, 1, 0]) },
    { url: 'c', vector: normalize([0.9, 0.1, 0]) },
  ];

  it('ranks by similarity, best first', () => {
    const ranked = rankByQuery(normalize([1, 0, 0]), pages);
    expect(ranked[0].url).toBe('a');
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('respects the limit', () => {
    expect(rankByQuery(normalize([1, 0, 0]), pages, 2)).toHaveLength(2);
  });

  it('picks the page closest to the site centroid', () => {
    expect(mostRepresentative(pages)?.url).toBe('c');
  });

  it('returns null when there is nothing to pick from', () => {
    expect(mostRepresentative([])).toBeNull();
  });
});
