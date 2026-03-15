/**
 * Tests for serp-client.ts — SERP API client
 *
 * Mocks axios so we never hit the network.
 * Uses a real in-memory SQLite database for storage tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import axios from 'axios';

let testDb: Database.Database;

vi.mock('axios');
const axiosPost = vi.mocked(axios.post);

vi.mock('../main/database', () => ({
  getDb: () => testDb,
}));

// Must import AFTER mocks
import {
  querySerpSingle,
  querySerpBatch,
  storeSerpResults,
  getSerpResults,
  calculateSerpCost,
  SerpQuery,
} from '../main/serp-client';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // serp_results table is created by storeSerpResults via CREATE TABLE IF NOT EXISTS
  return db;
}

function makeSerpResponse(organic: { rank: number; url: string; title: string; snippet: string }[]) {
  return {
    data: {
      organic: organic.map(o => ({
        rank: o.rank,
        url: o.url,
        title: o.title,
        snippet: o.snippet,
      })),
    },
  };
}

describe('serp-client', () => {
  beforeEach(() => {
    testDb = createTestDb();
    vi.clearAllMocks();
  });
  afterEach(() => {
    testDb.close();
  });

  describe('querySerpSingle', () => {
    it('returns parsed organic results on success', async () => {
      axiosPost.mockResolvedValueOnce(makeSerpResponse([
        { rank: 1, url: 'https://example.com', title: 'Example', snippet: 'An example site' },
        { rank: 2, url: 'https://other.com', title: 'Other', snippet: 'Another site' },
      ]) as never);

      const result = await querySerpSingle('test keyword', 'api-key', 'serp_zone');
      expect(result.keyword).toBe('test keyword');
      expect(result.location).toBe('United States');
      expect(result.device).toBe('desktop');
      expect(result.costUsd).toBe(0.003);
      expect(result.results).toHaveLength(2);
      expect(result.results![0]).toMatchObject({
        position: 1,
        url: 'https://example.com',
        title: 'Example',
      });
    });

    it('returns empty results on API error', async () => {
      axiosPost.mockRejectedValueOnce(new Error('Network error'));

      const result = await querySerpSingle('fail keyword', 'api-key', 'serp_zone');
      expect(result.keyword).toBe('fail keyword');
      expect(result.results).toEqual([]);
      expect(result.costUsd).toBe(0.003);
    });

    it('passes correct request params', async () => {
      axiosPost.mockResolvedValueOnce(makeSerpResponse([]) as never);

      await querySerpSingle('seo tools', 'my-key', 'my-zone', 'Canada', 'mobile');

      expect(axiosPost).toHaveBeenCalledWith(
        'https://api.brightdata.com/serp',
        expect.objectContaining({
          zone: 'my-zone',
          query: 'seo tools',
          device: 'mobile',
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer my-key',
          }),
        }),
      );
    });
  });

  describe('querySerpBatch', () => {
    it('processes keywords in batches of 5', async () => {
      // 7 keywords → 2 batches (5 + 2)
      for (let i = 0; i < 7; i++) {
        axiosPost.mockResolvedValueOnce(makeSerpResponse([
          { rank: 1, url: `https://r${i}.com`, title: `R${i}`, snippet: '' },
        ]) as never);
      }

      const keywords = Array.from({ length: 7 }, (_, i) => `kw-${i}`);
      const results = await querySerpBatch(keywords, 'key', 'zone');
      expect(results).toHaveLength(7);
      expect(axiosPost).toHaveBeenCalledTimes(7);
    });

    it('returns results for each keyword', async () => {
      axiosPost.mockResolvedValue(makeSerpResponse([
        { rank: 1, url: 'https://a.com', title: 'A', snippet: '' },
      ]) as never);

      const results = await querySerpBatch(['alpha', 'beta'], 'key', 'zone');
      expect(results[0].keyword).toBe('alpha');
      expect(results[1].keyword).toBe('beta');
    });
  });

  describe('storeSerpResults', () => {
    it('creates the serp_results table and stores data', () => {
      const queries: SerpQuery[] = [
        {
          keyword: 'best seo tool',
          location: 'United States',
          device: 'desktop',
          results: [
            { position: 1, url: 'https://a.com', title: 'A', description: 'Desc A', features: ['featured_snippet'] },
            { position: 2, url: 'https://b.com', title: 'B', description: 'Desc B', features: [] },
          ],
          costUsd: 0.003,
        },
      ];

      storeSerpResults('crawl-1', queries);

      const rows = testDb.prepare('SELECT * FROM serp_results').all() as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(rows[0].keyword).toBe('best seo tool');
      expect(rows[0].position).toBe(1);
      expect(rows[0].url).toBe('https://a.com');
      expect(rows[1].position).toBe(2);
    });

    it('stores features as JSON', () => {
      storeSerpResults('crawl-1', [{
        keyword: 'test',
        results: [{ position: 1, url: 'https://x.com', title: 'X', description: '', features: ['people_also_ask', 'local_pack'] }],
        costUsd: 0.003,
      }]);

      const rows = testDb.prepare('SELECT features_json FROM serp_results').all() as Record<string, string>[];
      expect(JSON.parse(rows[0].features_json)).toEqual(['people_also_ask', 'local_pack']);
    });
  });

  describe('getSerpResults', () => {
    it('returns results with camelCase keys', () => {
      // Manually insert a row
      storeSerpResults('crawl-x', [{
        keyword: 'my keyword',
        location: 'US',
        device: 'desktop',
        results: [{ position: 3, url: 'https://z.com', title: 'Z', description: 'Zzz', features: [] }],
        costUsd: 0.003,
      }]);

      const results = getSerpResults('crawl-x') as Record<string, unknown>[];
      expect(results).toHaveLength(1);
      expect(results[0].crawlId).toBe('crawl-x');
      expect(results[0].featuresJson).toBeDefined();
      expect(results[0].costUsd).toBe(0.003);
      expect(results[0].createdAt).toBeDefined();
      // No snake_case keys
      expect(results[0]).not.toHaveProperty('crawl_id');
      expect(results[0]).not.toHaveProperty('features_json');
      expect(results[0]).not.toHaveProperty('cost_usd');
    });

    it('returns empty array for non-existent crawl', () => {
      // serp_results table not created yet — getSerpResults handles the error
      const results = getSerpResults('nonexistent');
      expect(results).toEqual([]);
    });
  });

  describe('calculateSerpCost', () => {
    it('returns $0.003 per query', () => {
      expect(calculateSerpCost(1)).toBe(0.003);
      expect(calculateSerpCost(100)).toBeCloseTo(0.3, 6);
      expect(calculateSerpCost(0)).toBe(0);
    });
  });
});
