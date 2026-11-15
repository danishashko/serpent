import { describe, it, expect } from 'vitest';
import { computePhrases, hasBodyText, phraseTexts, tokenizeSegments } from '../renderer/lib/ngrams';
import type { LinkData, PageData } from '../types/index';

const SITE = 'https://shop.test';

function page(url: string, over: Partial<PageData> = {}): PageData {
  return { url, statusCode: 200, contentType: 'text/html', title: null, h1: null, h2: null, metaDescription: null, ...over } as PageData;
}

function link(sourceUrl: string, anchorText: string | null, isInternal = true): LinkData {
  return { id: sourceUrl + anchorText, crawlId: 'c', sourceUrl, targetUrl: `${SITE}/x`, isInternal, anchorText, relAttr: null };
}

describe('tokenizeSegments', () => {
  it('lower-cases, keeps inner apostrophes and hyphens, and splits on punctuation', () => {
    expect(tokenizeSegments("Don't Panic: E-commerce SEO | Shop.test")).toEqual([
      ["don't", 'panic'],
      ['e-commerce', 'seo'],
      ['shop'],
      ['test'],
    ]);
  });

  it('treats a spaced hyphen and a dash as a boundary and handles non-Latin letters', () => {
    expect(tokenizeSegments('Blue Shoes - Zapatos Azules — Über Größe')).toEqual([
      ['blue', 'shoes'],
      ['zapatos', 'azules'],
      ['über', 'größe'],
    ]);
  });

  it('returns nothing for text without words', () => {
    expect(tokenizeSegments(' — | ... ')).toEqual([]);
  });
});

describe('computePhrases', () => {
  const texts = [
    { page: 'a', text: 'Running shoes for men | Shop' },
    { page: 'b', text: 'Running shoes for women | Shop' },
    { page: 'c', text: 'Trail running shoes. Running shoes sale' },
  ];

  it('counts occurrences and distinct pages', () => {
    const r = computePhrases(texts, { n: 2, minCount: 1 });
    expect(r.rows[0]).toEqual({ phrase: 'running shoes', count: 4, pages: 3 });
    expect(r.pagesAnalyzed).toBe(3);
  });

  it('never builds a phrase across a boundary', () => {
    const phrases = computePhrases(texts, { n: 2, minCount: 1 }).rows.map(r => r.phrase);
    expect(phrases).not.toContain('men shop');
    expect(phrases).not.toContain('shoes running');
  });

  it('drops phrases that start or end with a stopword but keeps inner ones', () => {
    const three = computePhrases(texts, { n: 3, minCount: 1 }).rows.map(r => r.phrase);
    expect(three).toContain('shoes for men');
    expect(three).not.toContain('running shoes for');
    const withStop = computePhrases(texts, { n: 3, minCount: 1, dropStopwords: false }).rows.map(r => r.phrase);
    expect(withStop).toContain('running shoes for');
  });

  it('skips stopwords, single characters and bare numbers as single words', () => {
    const r = computePhrases([{ page: 'a', text: 'The 10 best shoes of 2026 x' }], { n: 1, minCount: 1 });
    expect(r.rows.map(x => x.phrase).sort()).toEqual(['best', 'shoes']);
  });

  it('applies minCount, the row limit and a stable order', () => {
    expect(computePhrases(texts, { n: 2, minCount: 2 }).rows.map(r => r.phrase)).toEqual(['running shoes']);
    const limited = computePhrases(texts, { n: 1, minCount: 1, limit: 2 });
    expect(limited.rows.map(r => r.phrase)).toEqual(['running', 'shoes']);
    expect(limited.distinct).toBeGreaterThan(2);
  });

  it('stops at the token budget and says so', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ page: `p${i}`, text: 'alpha beta gamma delta' }));
    const r = computePhrases(many, { n: 1, minCount: 1, maxTokens: 40 });
    expect(r.truncated).toBe(true);
    expect(r.pagesAnalyzed).toBe(10);
    expect(computePhrases(many, { n: 1, minCount: 1 }).truncated).toBe(false);
  });
});

describe('phraseTexts', () => {
  const pages = [
    page(`${SITE}/`, { title: 'Home', h1: 'Welcome', bodyText: 'Body copy here' }),
    page(`${SITE}/gone`, { statusCode: 404, title: 'Not Found' }),
    page(`${SITE}/file.pdf`, { contentType: 'application/pdf', title: 'A PDF' }),
    page(`${SITE}/untitled`),
  ];

  it('uses only successful HTML pages that have the field', () => {
    expect(phraseTexts('title', pages)).toEqual([{ page: `${SITE}/`, text: 'Home' }]);
    expect(phraseTexts('h1', pages)).toEqual([{ page: `${SITE}/`, text: 'Welcome' }]);
    expect(phraseTexts('body', pages)).toEqual([{ page: `${SITE}/`, text: 'Body copy here' }]);
  });

  it('takes anchor text from internal links only, grouped by linking page', () => {
    const links = [
      link(`${SITE}/b`, 'Read more'),
      link(`${SITE}/a`, 'Pricing'),
      link(`${SITE}/b`, 'Pricing'),
      link(`${SITE}/a`, 'External', false),
      link(`${SITE}/a`, '   '),
      link(`${SITE}/a`, null),
    ];
    expect(phraseTexts('anchor', pages, links)).toEqual([
      { page: `${SITE}/a`, text: 'Pricing' },
      { page: `${SITE}/b`, text: 'Read more' },
      { page: `${SITE}/b`, text: 'Pricing' },
    ]);
    const r = computePhrases(phraseTexts('anchor', pages, links), { n: 1, minCount: 1 });
    expect(r.rows[0]).toEqual({ phrase: 'pricing', count: 2, pages: 2 });
  });

  it('reports whether body text was stored', () => {
    expect(hasBodyText(pages)).toBe(true);
    expect(hasBodyText([page(`${SITE}/x`)])).toBe(false);
  });
});
