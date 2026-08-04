// Vector embeddings for semantic analysis.
//
// Embeddings capture meaning rather than wording, so they catch things exact
// and near-duplicate hashing cannot: two pages that cover the same subject in
// completely different words (cannibalisation), and pages that sit far from the
// rest of the site's subject matter (low-relevance outliers).
//
// Every vector is L2-normalised before it is stored, which makes cosine
// similarity a plain dot product and keeps Google's guidance for reduced-
// dimensionality Gemini embeddings satisfied at the same time.

import axios from 'axios';
import { EmbeddingProvider, EmbeddingTarget, PageData } from '../types/index';

/** Reduced from Gemini's 3072 default: far smaller to store, negligible quality cost. */
export const EMBEDDING_DIMENSIONS = 768;

/** Embedding models cap out well before this; more text is wasted tokens. */
export const MAX_EMBED_CHARS = 8000;

/**
 * Pages at or above this cosine similarity are reported as semantically similar.
 *
 * Screaming Frog uses 0.95, but that number belongs to their embedding model.
 * Measured against Gemini 768-dim on a real 39-page site, closest-match scores
 * ran 0.74–0.98 with a mean of 0.88, so 0.95 surfaced almost nothing. 0.92 sits
 * roughly a standard deviation above that mean, which is where genuinely
 * overlapping pages actually land.
 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.92;

/**
 * Fallback floor for low-relevance outliers. Only used when the crawl is too
 * small to derive a threshold from its own distribution — see
 * `suggestRelevanceThreshold`, which is what normally decides this.
 */
export const DEFAULT_RELEVANCE_THRESHOLD = 0.7;

/** Below this many pages, the spread isn't meaningful enough to derive a threshold. */
const MIN_PAGES_FOR_ADAPTIVE_THRESHOLD = 5;

export interface RelevanceStats {
  mean: number;
  stdDev: number;
  min: number;
  max: number;
}

export function relevanceStats(scores: number[]): RelevanceStats {
  if (scores.length === 0) return { mean: 0, stdDev: 0, min: 0, max: 0 };
  const mean = scores.reduce((s, v) => s + v, 0) / scores.length;
  const variance = scores.reduce((s, v) => s + (v - mean) ** 2, 0) / scores.length;
  return { mean, stdDev: Math.sqrt(variance), min: Math.min(...scores), max: Math.max(...scores) };
}

/**
 * "Off-topic" only means anything relative to the rest of the site. An absolute
 * cutoff is model-dependent and site-dependent: on a tightly focused site every
 * page scores high against the centroid, so a fixed 0.7 flags nothing at all.
 * One standard deviation below the mean picks out the actual tail instead.
 */
export function suggestRelevanceThreshold(scores: number[]): number {
  if (scores.length < MIN_PAGES_FOR_ADAPTIVE_THRESHOLD) return DEFAULT_RELEVANCE_THRESHOLD;
  const { mean, stdDev } = relevanceStats(scores);
  return Math.max(0, Math.min(1, mean - stdDev));
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string;
  ollamaUrl?: string;
}

export const DEFAULT_EMBEDDING_MODELS: Record<EmbeddingProvider, string> = {
  gemini: 'gemini-embedding-001',
  openai: 'text-embedding-3-small',
  ollama: 'nomic-embed-text',
};

// ─── Vector maths ──────────────────────────────────────────────────────────────

/** L2-normalise in place-safe fashion. A zero vector is returned unchanged. */
export function normalize(vec: number[]): number[] {
  let sum = 0;
  for (const v of vec) sum += v * v;
  const mag = Math.sqrt(sum);
  if (mag === 0) return vec.slice();
  return vec.map(v => v / mag);
}

/**
 * Cosine similarity. Both inputs are assumed normalised (everything this module
 * stores is), so this is a dot product; mismatched lengths return 0 rather than
 * throwing, so one bad row cannot abort a whole analysis.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Guard against float drift pushing us marginally outside [-1, 1].
  return Math.max(-1, Math.min(1, dot));
}

/** Mean vector of a set, normalised. Represents the site's overall subject matter. */
export function centroid(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const sum = new Array<number>(dims).fill(0);
  for (const vec of vectors) {
    if (vec.length !== dims) continue;
    for (let i = 0; i < dims; i++) sum[i] += vec[i];
  }
  return normalize(sum.map(v => v / vectors.length));
}

// ─── Storage encoding ──────────────────────────────────────────────────────────
// Float32 blobs rather than JSON: ~3 KB per 768-dim vector instead of ~15 KB.

export function encodeVector(vec: number[]): Buffer {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

export function decodeVector(buf: Buffer): number[] {
  const f32 = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  return Array.from(f32);
}

// ─── Text selection ────────────────────────────────────────────────────────────

/**
 * The text an embedding is built from. 'text' needs a crawl that stored body
 * text; 'title' works on any crawl and is the fallback we can always offer.
 */
export function textForPage(page: PageData, target: EmbeddingTarget): string {
  if (target === 'title') {
    return [page.title, page.metaDescription].filter(Boolean).join(' — ').trim();
  }
  const body = (page.bodyText ?? '').trim();
  if (body) return body.slice(0, MAX_EMBED_CHARS);
  // No stored body text — fall back to whatever this page does have rather
  // than silently dropping the page out of the analysis.
  return [page.title, page.metaDescription, page.h1, page.h2].filter(Boolean).join(' — ').trim();
}

// ─── Providers ─────────────────────────────────────────────────────────────────

/**
 * Per-request batch size. Small on purpose: free Gemini keys rate-limit on
 * requests-per-minute, and a smaller batch loses less work when one fails.
 */
const BATCH_SIZE = 10;
const REQUEST_TIMEOUT_MS = 60_000;

/** Retry budget for rate limits and transient provider errors. */
const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 2000;

function statusOf(err: unknown): number | undefined {
  return (err as { response?: { status?: number } })?.response?.status;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Run an embedding request, backing off on 429 (rate limit) and 5xx. Free-tier
 * keys hit 429 routinely, and failing the whole run for it would make the
 * feature unusable for exactly the users most likely to rely on it.
 */
async function withRetry<T>(fn: () => Promise<T>, onRetry?: (attempt: number, waitMs: number) => void): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = statusOf(err);
      const retryable = status === 429 || status === 503 || status === 500 || status === undefined;
      if (!retryable || attempt === MAX_RETRIES) throw err;
      const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt);
      onRetry?.(attempt + 1, backoff);
      await wait(backoff);
    }
  }
  throw lastErr;
}

async function embedGemini(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const model = config.model || DEFAULT_EMBEDDING_MODELS.gemini;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${config.apiKey}`;
  const res = await axios.post(
    url,
    {
      requests: texts.map(text => ({
        model: `models/${model}`,
        content: { parts: [{ text }] },
        outputDimensionality: EMBEDDING_DIMENSIONS,
      })),
    },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  const embeddings = (res.data?.embeddings ?? []) as { values: number[] }[];
  return embeddings.map(e => normalize(e.values ?? []));
}

async function embedOpenAI(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const res = await axios.post(
    'https://api.openai.com/v1/embeddings',
    {
      model: config.model || DEFAULT_EMBEDDING_MODELS.openai,
      input: texts,
      dimensions: EMBEDDING_DIMENSIONS,
    },
    { headers: { Authorization: `Bearer ${config.apiKey}` }, timeout: REQUEST_TIMEOUT_MS },
  );
  const data = (res.data?.data ?? []) as { embedding: number[]; index: number }[];
  // OpenAI documents index ordering but does not promise array order.
  const sorted = [...data].sort((a, b) => a.index - b.index);
  return sorted.map(d => normalize(d.embedding ?? []));
}

async function embedOllama(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  const base = (config.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
  const res = await axios.post(
    `${base}/api/embed`,
    { model: config.model || DEFAULT_EMBEDDING_MODELS.ollama, input: texts },
    { timeout: REQUEST_TIMEOUT_MS },
  );
  const embeddings = (res.data?.embeddings ?? []) as number[][];
  return embeddings.map(e => normalize(e ?? []));
}

/**
 * Embed a batch of texts. Throws on provider/network failure so the caller can
 * report it — partial silent failure would produce a misleading analysis.
 */
export async function embedBatch(texts: string[], config: EmbeddingConfig): Promise<number[][]> {
  if (texts.length === 0) return [];
  return withRetry(
    () => {
      switch (config.provider) {
        case 'gemini': return embedGemini(texts, config);
        case 'openai': return embedOpenAI(texts, config);
        case 'ollama': return embedOllama(texts, config);
      }
    },
    (attempt, waitMs) => console.warn(`[EMBEDDINGS] ${config.provider} rate-limited, retry ${attempt} in ${waitMs}ms`),
  );
}

/**
 * Embed many texts, in batches, reporting progress. Empty strings are skipped
 * and come back as null so the caller can keep index alignment with its pages.
 */
export async function embedAll(
  texts: string[],
  config: EmbeddingConfig,
  onProgress?: (done: number, total: number) => void,
): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = new Array(texts.length).fill(null);
  const jobs = texts
    .map((text, index) => ({ text, index }))
    .filter(j => j.text.trim().length > 0);

  for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
    const slice = jobs.slice(i, i + BATCH_SIZE);
    const vectors = await embedBatch(slice.map(j => j.text), config);
    slice.forEach((job, k) => {
      const vec = vectors[k];
      if (vec && vec.length > 0) out[job.index] = vec;
    });
    onProgress?.(Math.min(i + BATCH_SIZE, jobs.length), jobs.length);
  }
  return out;
}

// ─── Analysis ──────────────────────────────────────────────────────────────────

export interface EmbeddedPage {
  url: string;
  vector: number[];
}

export interface SemanticNeighbour {
  url: string;
  score: number;
}

export interface SemanticPageResult {
  url: string;
  /** Closest other page, or null when there is nothing to compare against. */
  closestUrl: string | null;
  closestScore: number;
  /** How many other pages meet the similarity threshold. */
  similarCount: number;
  /** Similarity to the site centroid — low means off-topic for this site. */
  relevanceScore: number;
  neighbours: SemanticNeighbour[];
}

/** Neighbours retained per page. Enough to act on, small enough to send over IPC. */
const MAX_NEIGHBOURS = 5;

/**
 * Pairwise similarity across every embedded page, plus each page's distance
 * from the site centroid.
 */
export function analyzeSemantics(
  pages: EmbeddedPage[],
  similarityThreshold: number = DEFAULT_SIMILARITY_THRESHOLD,
): SemanticPageResult[] {
  const site = centroid(pages.map(p => p.vector));

  return pages.map((page, i) => {
    const neighbours: SemanticNeighbour[] = [];
    let similarCount = 0;

    for (let j = 0; j < pages.length; j++) {
      if (i === j) continue;
      const score = cosineSimilarity(page.vector, pages[j].vector);
      if (score >= similarityThreshold) similarCount++;
      neighbours.push({ url: pages[j].url, score });
    }

    neighbours.sort((a, b) => b.score - a.score);
    const top = neighbours.slice(0, MAX_NEIGHBOURS);

    return {
      url: page.url,
      closestUrl: top[0]?.url ?? null,
      closestScore: top[0]?.score ?? 0,
      similarCount,
      relevanceScore: site.length > 0 ? cosineSimilarity(page.vector, site) : 0,
      neighbours: top,
    };
  });
}

/** Rank pages against a query vector — the crawl's own semantic search. */
export function rankByQuery(queryVector: number[], pages: EmbeddedPage[], limit = 50): SemanticNeighbour[] {
  return pages
    .map(p => ({ url: p.url, score: cosineSimilarity(queryVector, p.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The page closest to the site centroid — the most representative page. */
export function mostRepresentative(pages: EmbeddedPage[]): SemanticNeighbour | null {
  if (pages.length === 0) return null;
  const site = centroid(pages.map(p => p.vector));
  return rankByQuery(site, pages, 1)[0] ?? null;
}
