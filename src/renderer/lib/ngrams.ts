/**
 * N-gram phrase analysis: which words and phrases a site actually uses in its
 * titles, headings, meta descriptions, internal anchor text and body copy.
 * Pure functions, shared by the Phrases tab and its tests.
 */
import type { LinkData, PageData } from '../../types/index';
import { isHtmlPage } from '../../types/index';

export type PhraseSource = 'title' | 'h1' | 'h2' | 'meta' | 'anchor' | 'body';

export const PHRASE_SOURCES: { key: PhraseSource; label: string }[] = [
  { key: 'title', label: 'Page titles' },
  { key: 'h1', label: 'H1' },
  { key: 'h2', label: 'First H2' },
  { key: 'meta', label: 'Meta descriptions' },
  { key: 'anchor', label: 'Internal anchor text' },
  { key: 'body', label: 'Body text' },
];

export interface PhraseText {
  /** URL of the page the text belongs to (the linking page for anchor text). */
  page: string;
  text: string;
}

export interface PhraseRow {
  phrase: string;
  /** Total occurrences across all texts. */
  count: number;
  /** Distinct pages the phrase appears on. */
  pages: number;
}

export interface PhraseResult {
  rows: PhraseRow[];
  /** Distinct pages that contributed at least one token. */
  pagesAnalyzed: number;
  /** Distinct phrases found before the minCount filter and the row limit. */
  distinct: number;
  /** True when the token budget ran out before every text was read. */
  truncated: boolean;
}

export interface PhraseOptions {
  /** Words per phrase, 1 to 5. */
  n: number;
  /** Drop phrases seen fewer times than this. Default 2. */
  minCount?: number;
  /** Maximum rows returned. Default 500. */
  limit?: number;
  /** Drop stopword-only noise: single stopwords, and phrases that start or end with one. Default true. */
  dropStopwords?: boolean;
  /** Stop reading after this many tokens so a huge crawl cannot exhaust memory. Default 1.5 million. */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 1_500_000;

// English function words. A phrase may contain them ("history of art"), but
// one that starts or ends with them ("of the", "art of") is a fragment.
export const STOPWORDS: ReadonlySet<string> = new Set(
  (
    'a about above after again against all also am an and any are as at be because been before being below between both ' +
    'but by can cannot could did do does doing down during each few for from further had has have having he her here hers ' +
    'herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once ' +
    'only or other our ours ourselves out over own s same she should so some such t than that the their theirs them ' +
    'themselves then there these they this those through to too under until up us very was we were what when where which ' +
    'while who whom why will with would you your yours yourself yourselves via vs per amp nbsp'
  ).split(' '),
);

// A word: letters or digits, optionally joined by an inner apostrophe or hyphen ("don't", "e-commerce").
const WORD_RE = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
// Phrases never span these: sentence ends, separators titles use, brackets, quotes, line breaks.
const BOUNDARY_RE = /[.!?;:|•·–—()[\]{}"“”<>\r\n\t/\\]+|\s-\s/;

/** Split text into segments of lower-cased words; a phrase is only ever built inside one segment. */
export function tokenizeSegments(text: string): string[][] {
  const out: string[][] = [];
  for (const segment of text.toLowerCase().split(BOUNDARY_RE)) {
    const words = segment.match(WORD_RE);
    if (words && words.length > 0) out.push(words.map(w => w.replace(/’/g, "'")));
  }
  return out;
}

function isNoise(word: string): boolean {
  return word.length < 2 || /^\d+$/.test(word);
}

/** Count n-word phrases across texts. Rows are sorted by count, then pages, then alphabetically. */
export function computePhrases(texts: PhraseText[], opts: PhraseOptions): PhraseResult {
  const n = Math.min(5, Math.max(1, Math.floor(opts.n)));
  const minCount = opts.minCount ?? 2;
  const limit = opts.limit ?? 500;
  const dropStopwords = opts.dropStopwords ?? true;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

  const counts = new Map<string, { count: number; pages: number; lastPage: number }>();
  const pageIds = new Map<string, number>();
  const contributed = new Set<number>();
  let tokens = 0;
  let truncated = false;

  for (const t of texts) {
    if (!t.text) continue;
    if (tokens >= maxTokens) { truncated = true; break; }
    let pageId = pageIds.get(t.page);
    if (pageId === undefined) { pageId = pageIds.size + 1; pageIds.set(t.page, pageId); }

    for (const words of tokenizeSegments(t.text)) {
      tokens += words.length;
      if (words.length > 0) contributed.add(pageId);
      for (let i = 0; i + n <= words.length; i++) {
        const first = words[i];
        const last = words[i + n - 1];
        if (dropStopwords && (STOPWORDS.has(first) || STOPWORDS.has(last))) continue;
        if (n === 1 && isNoise(first)) continue;
        const phrase = n === 1 ? first : words.slice(i, i + n).join(' ');
        const entry = counts.get(phrase);
        if (entry) {
          entry.count++;
          // Distinct pages without a Set per phrase: all texts of one page arrive
          // together (see phraseTexts), so a new page id means a new page.
          if (entry.lastPage !== pageId) { entry.pages++; entry.lastPage = pageId; }
        } else {
          counts.set(phrase, { count: 1, pages: 1, lastPage: pageId });
        }
      }
    }
  }

  const rows: PhraseRow[] = [];
  for (const [phrase, e] of counts) {
    if (e.count >= minCount) rows.push({ phrase, count: e.count, pages: e.pages });
  }
  rows.sort((a, b) => b.count - a.count || b.pages - a.pages || (a.phrase < b.phrase ? -1 : a.phrase > b.phrase ? 1 : 0));
  return { rows: rows.slice(0, limit), pagesAnalyzed: contributed.size, distinct: counts.size, truncated };
}

/**
 * The texts one source contributes, grouped so that all texts of a page are
 * contiguous (computePhrases relies on that to count distinct pages cheaply).
 * Only successful HTML pages count; anchor text comes from internal links.
 */
export function phraseTexts(source: PhraseSource, pages: PageData[], links: LinkData[] = []): PhraseText[] {
  if (source === 'anchor') {
    return links
      .filter(l => l.isInternal && !!l.anchorText && l.anchorText.trim() !== '')
      .map(l => ({ page: l.sourceUrl, text: l.anchorText as string }))
      .sort((a, b) => (a.page < b.page ? -1 : a.page > b.page ? 1 : 0));
  }
  const out: PhraseText[] = [];
  for (const p of pages) {
    const status = p.statusCode ?? 0;
    if (status < 200 || status >= 300 || !isHtmlPage(p)) continue;
    const text =
      source === 'title' ? p.title
      : source === 'h1' ? p.h1
      : source === 'h2' ? p.h2
      : source === 'meta' ? p.metaDescription
      : p.bodyText;
    if (text) out.push({ page: p.url, text });
  }
  return out;
}

/** Whether a crawl stored page text, which the body source needs (the "Store page text" crawl option). */
export function hasBodyText(pages: PageData[]): boolean {
  return pages.some(p => !!p.bodyText);
}
