/**
 * Tests for cost-tracker.ts — CostTracker class
 *
 * Uses a real in-memory SQLite database to verify cost tracking logic.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock the database module so CostTracker uses our test DB
let testDb: Database.Database;

vi.mock('../main/database', () => ({
  getDb: () => testDb,
}));

// Must import AFTER mock
import { CostTracker } from '../main/cost-tracker';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      engine_type TEXT NOT NULL,
      urls_crawled INTEGER NOT NULL DEFAULT 0,
      bytes_downloaded INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );
  `);
  return db;
}

describe('CostTracker', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });
  afterEach(() => {
    testDb.close();
  });

  describe('costPerRequest', () => {
    it('returns $0.001 (CPM model)', () => {
      expect(CostTracker.costPerRequest()).toBe(0.001);
    });
  });

  describe('recordRequest', () => {
    it('increments crawl spend by $0.001 per request', () => {
      const tracker = new CostTracker('crawl-1', 10, 50);
      expect(tracker.getCrawlSpend()).toBe(0);

      tracker.recordRequest(5000);
      expect(tracker.getCrawlSpend()).toBeCloseTo(0.001, 6);

      tracker.recordRequest(10000);
      expect(tracker.getCrawlSpend()).toBeCloseTo(0.002, 6);
    });

    it('inserts a row into usage_logs', () => {
      const tracker = new CostTracker('crawl-1', 10, 50);
      tracker.recordRequest(12000);

      const rows = testDb.prepare('SELECT * FROM usage_logs').all() as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0].engine_type).toBe('brightdata');
      expect(rows[0].bytes_downloaded).toBe(12000);
      expect(rows[0].cost_usd).toBe(0.001);
    });

    it('returns the cost of the request', () => {
      const tracker = new CostTracker('crawl-1', 10, 50);
      const cost = tracker.recordRequest(5000);
      expect(cost).toBe(0.001);
    });
  });

  describe('shouldPause', () => {
    it('does not pause when under the crawl limit', () => {
      const tracker = new CostTracker('crawl-1', 1.0, 50);
      // Record 100 requests = $0.10 (10% of $1 limit, well under 95%)
      for (let i = 0; i < 100; i++) tracker.recordRequest(1000);
      expect(tracker.shouldPause().pause).toBe(false);
    });

    it('pauses when crawl spend hits 95% of crawl limit', () => {
      const tracker = new CostTracker('crawl-1', 0.01, 50);
      // $0.01 limit, 95% = $0.0095 → need 10 requests ($0.01)
      for (let i = 0; i < 10; i++) tracker.recordRequest(1000);
      const result = tracker.shouldPause();
      expect(result.pause).toBe(true);
      expect(result.reason).toContain('Crawl spend');
    });

    it('pauses when daily spend hits 95% of daily limit', () => {
      const tracker = new CostTracker('crawl-1', 100, 0.01);
      // $0.01 daily limit, 95% = $0.0095 → need 10 requests ($0.01)
      for (let i = 0; i < 10; i++) tracker.recordRequest(1000);
      const result = tracker.shouldPause();
      expect(result.pause).toBe(true);
      expect(result.reason).toContain('Daily spend');
    });
  });

  describe('getDailySpend', () => {
    it('returns 0 with no usage logged', () => {
      const tracker = new CostTracker('crawl-1', 10, 50);
      expect(tracker.getDailySpend()).toBe(0);
    });

    it('sums all brightdata usage for today', () => {
      const tracker = new CostTracker('crawl-1', 10, 50);
      tracker.recordRequest(5000);
      tracker.recordRequest(5000);
      tracker.recordRequest(5000);
      expect(tracker.getDailySpend()).toBeCloseTo(0.003, 6);
    });
  });

  describe('setCrawlSpend / getCrawlSpend', () => {
    it('allows setting spend for resume', () => {
      const tracker = new CostTracker('crawl-1', 10, 50);
      tracker.setCrawlSpend(0.5);
      expect(tracker.getCrawlSpend()).toBe(0.5);
    });
  });
});
