// Google PageSpeed Insights v5 client — real Lighthouse lab metrics plus CrUX
// field data (Core Web Vitals) per URL. Works keyless at very low volume; a
// free API key raises the quota to 25k/day.

import axios from 'axios';
import { PageData, PsiScore, PsiStrategy } from '../types/index';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Keyless quota is tiny — keep the batch small unless a key is configured. */
export const PSI_MAX_URLS_KEYLESS = 5;
export const PSI_MAX_URLS_KEYED = 100;

// Spacing between requests: PSI is slow anyway (~10-25 s per URL), this only
// guards against burst throttling.
const REQUEST_SPACING_MS = 1000;

/** PSI runs from Google's infrastructure — it can only reach public URLs. */
export function isPsiReachable(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return !/^(localhost|0\.0\.0\.0|::1|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  } catch {
    return false;
  }
}

type PsiApiResponse = {
  lighthouseResult?: {
    categories?: { performance?: { score?: number | null } };
    audits?: Record<string, { numericValue?: number | null }>;
  };
  loadingExperience?: {
    metrics?: Record<string, { percentile?: number | null }>;
    overall_category?: string;
    origin_fallback?: boolean;
  };
};

function audit(data: PsiApiResponse, id: string): number | null {
  const v = data.lighthouseResult?.audits?.[id]?.numericValue;
  return typeof v === 'number' ? Math.round(v * 1000) / 1000 : null;
}

function fieldMetric(data: PsiApiResponse, id: string): number | null {
  // Ignore origin-level fallback — we want URL-level field data or nothing.
  if (data.loadingExperience?.origin_fallback) return null;
  const v = data.loadingExperience?.metrics?.[id]?.percentile;
  return typeof v === 'number' ? v : null;
}

export function parsePsiResponse(
  data: PsiApiResponse,
  pageId: string,
  crawlId: string,
  url: string,
  strategy: PsiStrategy
): PsiScore {
  const rawScore = data.lighthouseResult?.categories?.performance?.score;
  const fieldCls = fieldMetric(data, 'CUMULATIVE_LAYOUT_SHIFT_SCORE');
  return {
    pageId,
    crawlId,
    url,
    strategy,
    performanceScore: typeof rawScore === 'number' ? Math.round(rawScore * 100) : null,
    lcpMs: audit(data, 'largest-contentful-paint'),
    clsValue: audit(data, 'cumulative-layout-shift'),
    tbtMs: audit(data, 'total-blocking-time'),
    fcpMs: audit(data, 'first-contentful-paint'),
    speedIndexMs: audit(data, 'speed-index'),
    fieldLcpMs: fieldMetric(data, 'LARGEST_CONTENTFUL_PAINT_MS'),
    fieldInpMs: fieldMetric(data, 'INTERACTION_TO_NEXT_PAINT'),
    // CrUX reports CLS multiplied by 100
    fieldCls: fieldCls !== null ? fieldCls / 100 : null,
    fieldOverallCategory: data.loadingExperience?.origin_fallback
      ? null
      : data.loadingExperience?.overall_category ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchPsiScore(
  page: Pick<PageData, 'id' | 'crawlId' | 'url'>,
  strategy: PsiStrategy,
  apiKey: string | null
): Promise<PsiScore> {
  const params: Record<string, string> = {
    url: page.url,
    strategy,
    category: 'performance',
  };
  if (apiKey) params.key = apiKey;
  const response = await axios.get(PSI_ENDPOINT, { params, timeout: 60000 });
  return parsePsiResponse(response.data as PsiApiResponse, page.id, page.crawlId, page.url, strategy);
}

export interface PsiBatchResult {
  scores: PsiScore[];
  errors: { url: string; error: string }[];
  skippedUnreachable: number;
}

export async function analyzePsiBatch(
  pages: PageData[],
  strategy: PsiStrategy,
  apiKey: string | null,
  onProgress?: (done: number, total: number, url: string) => void
): Promise<PsiBatchResult> {
  const reachable = pages.filter(p => isPsiReachable(p.url));
  const skippedUnreachable = pages.length - reachable.length;
  const cap = apiKey ? PSI_MAX_URLS_KEYED : PSI_MAX_URLS_KEYLESS;
  const targets = reachable.slice(0, cap);

  const scores: PsiScore[] = [];
  const errors: { url: string; error: string }[] = [];
  for (let i = 0; i < targets.length; i++) {
    const page = targets[i];
    onProgress?.(i, targets.length, page.url);
    try {
      scores.push(await fetchPsiScore(page, strategy, apiKey));
    } catch (err) {
      const axErr = err as { response?: { status?: number }; message?: string };
      const status = axErr.response?.status;
      errors.push({ url: page.url, error: status ? `HTTP ${status}` : (axErr.message ?? String(err)) });
      // Quota exhausted — no point hammering the rest of the batch.
      if (status === 429) break;
    }
    if (i < targets.length - 1) await new Promise(r => setTimeout(r, REQUEST_SPACING_MS));
  }
  onProgress?.(targets.length, targets.length, '');
  return { scores, errors, skippedUnreachable };
}
