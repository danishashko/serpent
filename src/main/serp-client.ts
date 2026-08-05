import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './database';

const BD_SERP_ENDPOINT = 'https://api.brightdata.com/serp';

// Bright Data SERP API: $0.003 per query
const COST_PER_QUERY_USD = 0.003;

export interface SerpResult {
  position: number;
  url: string;
  title: string;
  description: string;
  features: string[]; // featured snippets, PAA, etc.
}

export interface SerpQuery {
  keyword: string;
  location?: string; // e.g. 'United States'
  device?: 'desktop' | 'mobile';
  results?: SerpResult[];
  costUsd?: number;
  /** Set when the query failed. `results` is then empty and nothing was billed. */
  error?: string;
}

/**
 * Pull a human-readable message out of an error response body.
 */
function describeBody(data: unknown): string {
  if (typeof data === 'string' && data.trim()) return `: ${data.trim().slice(0, 200)}`;
  if (data && typeof data === 'object') {
    const message = (data as Record<string, unknown>).error ?? (data as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return `: ${message.trim().slice(0, 200)}`;
  }
  return '';
}

/**
 * Query Bright Data SERP API for a single keyword.
 */
export async function querySerpSingle(
  keyword: string,
  apiKey: string,
  zone: string,
  location = 'United States',
  device: 'desktop' | 'mobile' = 'desktop'
): Promise<SerpQuery> {
  // A failed query returns no results and costs nothing, so it must not report
  // the per-query price either.
  const failed = (error: string): SerpQuery => ({ keyword, location, device, results: [], costUsd: 0, error });

  try {
    const response = await axios.post(
      BD_SERP_ENDPOINT,
      {
        zone,
        query: keyword,
        country: 'us',
        search_engine: 'google',
        format: 'json',
        device,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 30000,
        validateStatus: () => true,
      }
    );

    if (response.status < 200 || response.status >= 300) {
      return failed(`Bright Data returned HTTP ${response.status}${describeBody(response.data)}`);
    }

    const data = response.data;

    // A Web Unlocker zone answers this endpoint but never returns `organic`,
    // which used to make an unusable zone look exactly like a keyword that
    // genuinely ranks nothing. Only a present `organic` array is a real answer.
    if (!data || !Array.isArray(data.organic)) {
      return failed(
        `No organic results in the response — zone "${zone}" is probably not a SERP API zone${describeBody(data)}`
      );
    }

    const results: SerpResult[] = [];
    for (const item of data.organic) {
      results.push({
        position: item.rank || item.position || 0,
        url: item.url || item.link || '',
        title: item.title || '',
        description: item.description || item.snippet || '',
        features: extractFeatures(data, item),
      });
    }

    return {
      keyword,
      location,
      device,
      results,
      costUsd: COST_PER_QUERY_USD,
    };
  } catch (err) {
    return failed(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Batch query multiple keywords.
 */
export async function querySerpBatch(
  keywords: string[],
  apiKey: string,
  zone: string,
  location = 'United States',
  device: 'desktop' | 'mobile' = 'desktop'
): Promise<SerpQuery[]> {
  const results: SerpQuery[] = [];

  // Process 5 at a time to avoid rate limits
  const batchSize = 5;
  for (let i = 0; i < keywords.length; i += batchSize) {
    const batch = keywords.slice(i, i + batchSize);
    const promises = batch.map(kw => querySerpSingle(kw, apiKey, zone, location, device));
    const batchResults = await Promise.all(promises);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Store SERP results in the database.
 */
export function storeSerpResults(crawlId: string, queries: SerpQuery[]): void {
  const db = getDb();

  // Ensure serp_results table exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS serp_results (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL,
      keyword TEXT NOT NULL,
      location TEXT,
      device TEXT,
      position INTEGER,
      url TEXT,
      title TEXT,
      description TEXT,
      features_json TEXT,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_serp_crawl_id ON serp_results(crawl_id);
    CREATE INDEX IF NOT EXISTS idx_serp_keyword ON serp_results(keyword);
  `);

  const insert = db.prepare(
    `INSERT INTO serp_results (id, crawl_id, keyword, location, device, position, url, title, description, features_json, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((queries: SerpQuery[]) => {
    for (const q of queries) {
      if (q.results) {
        for (const r of q.results) {
          insert.run(
            uuidv4(), crawlId, q.keyword, q.location, q.device,
            r.position, r.url, r.title, r.description,
            JSON.stringify(r.features), q.costUsd || 0
          );
        }
      }
    }
  });

  insertMany(queries);
}

/**
 * Get SERP results for a crawl.
 */
export function getSerpResults(crawlId: string): unknown[] {
  const db = getDb();
  try {
    return db.prepare(
      `SELECT id, crawl_id AS crawlId, keyword, location, device, position, url, title, description, features_json AS featuresJson, cost_usd AS costUsd, created_at AS createdAt
       FROM serp_results WHERE crawl_id = ? ORDER BY keyword, position`
    ).all(crawlId);
  } catch {
    return [];
  }
}

function extractFeatures(data: Record<string, unknown>, _item: Record<string, unknown>): string[] {
  const features: string[] = [];
  if (data.featured_snippet) features.push('featured_snippet');
  if (data.people_also_ask && Array.isArray(data.people_also_ask) && data.people_also_ask.length > 0) {
    features.push('people_also_ask');
  }
  if (data.knowledge_graph) features.push('knowledge_graph');
  if (data.local_pack) features.push('local_pack');
  return features;
}

export function calculateSerpCost(queryCount: number): number {
  return queryCount * COST_PER_QUERY_USD;
}
