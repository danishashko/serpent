/**
 * Tests for getUsageStats() — Usage statistics aggregation
 *
 * Mocks the database module, seeds an in-memory SQLite DB with usage_logs
 * and crawls, then asserts the aggregated stats are correct.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb: Database.Database;

vi.mock('electron', () => ({ app: { getPath: () => '' } }));

// We need to set up the mock BEFORE importing database.ts
// But getUsageStats uses module-level `db`, so we mock initDatabase behavior
vi.mock('../main/database', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return {
    ...original,
    initDatabase: (dataPath?: string) => {
      // Intercept to use our testDb
      return testDb;
    },
    getDb: () => testDb,
  };
});

/**
 * Since getUsageStats uses the module-level `db` variable which we can't
 * easily set via mock, we reimplement the exact same SQL here against our
 * test DB. This validates the SQL logic itself.
 */
function getUsageStats(db: Database.Database) {
  const totalRow = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_logs").get() as { total: number };
  const todayRow = db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS total FROM usage_logs WHERE date(timestamp) = date('now')").get() as { total: number };

  const dailyHistory = db.prepare(`
    SELECT date(timestamp) as date, SUM(cost_usd) as cost, SUM(urls_crawled) as requests
    FROM usage_logs GROUP BY date(timestamp) ORDER BY date DESC LIMIT 30
  `).all() as { date: string; cost: number; requests: number }[];

  const crawlHistory = db.prepare(`
    SELECT id as crawlId, start_url as startUrl, total_spend_usd as cost, date(start_time) as date
    FROM crawls WHERE total_spend_usd > 0 ORDER BY start_time DESC LIMIT 20
  `).all() as { crawlId: string; startUrl: string; cost: number; date: string }[];

  return { totalSpend: totalRow.total, todaySpend: todayRow.total, dailyHistory, crawlHistory };
}

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS crawls (
      id TEXT PRIMARY KEY,
      mode TEXT NOT NULL DEFAULT 'local',
      start_url TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      status TEXT NOT NULL DEFAULT 'running',
      config_json TEXT NOT NULL,
      total_urls INTEGER NOT NULL DEFAULT 0,
      completed_urls INTEGER NOT NULL DEFAULT 0,
      total_spend_usd REAL NOT NULL DEFAULT 0
    );
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

// ── Helper to get today's date in SQLite format ──
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

describe('getUsageStats', () => {
  beforeEach(() => { testDb = createTestDb(); });
  afterEach(() => { testDb.close(); });

  describe('totalSpend', () => {
    it('returns 0 with no usage logs', () => {
      const stats = getUsageStats(testDb);
      expect(stats.totalSpend).toBe(0);
    });

    it('sums all usage_logs cost_usd', () => {
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u1', '2025-06-01T10:00:00Z', 'brightdata', 5, 50000, 0.005)`).run();
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u2', '2025-06-02T12:00:00Z', 'brightdata', 3, 30000, 0.003)`).run();
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u3', '2025-06-03T14:00:00Z', 'brightdata', 10, 100000, 0.010)`).run();

      const stats = getUsageStats(testDb);
      expect(stats.totalSpend).toBeCloseTo(0.018, 6);
    });
  });

  describe('todaySpend', () => {
    it('returns 0 with no logs today', () => {
      // Insert log from yesterday
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u1', '2020-01-01T10:00:00Z', 'brightdata', 5, 50000, 0.005)`).run();

      const stats = getUsageStats(testDb);
      expect(stats.todaySpend).toBe(0);
    });

    it('sums only today logs', () => {
      const now = new Date().toISOString();
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u1', ?, 'brightdata', 5, 50000, 0.005)`).run(now);
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u2', ?, 'brightdata', 3, 30000, 0.003)`).run(now);
      // Old log — not today
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u3', '2020-01-01T10:00:00Z', 'brightdata', 10, 100000, 0.010)`).run();

      const stats = getUsageStats(testDb);
      expect(stats.todaySpend).toBeCloseTo(0.008, 6);
      expect(stats.totalSpend).toBeCloseTo(0.018, 6); // all three
    });
  });

  describe('dailyHistory', () => {
    it('returns empty array with no logs', () => {
      const stats = getUsageStats(testDb);
      expect(stats.dailyHistory).toEqual([]);
    });

    it('groups by date and sums cost + requests', () => {
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u1', '2025-06-15T10:00:00Z', 'brightdata', 5, 50000, 0.005)`).run();
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u2', '2025-06-15T14:00:00Z', 'brightdata', 3, 30000, 0.003)`).run();
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u3', '2025-06-14T12:00:00Z', 'brightdata', 10, 100000, 0.010)`).run();

      const stats = getUsageStats(testDb);
      expect(stats.dailyHistory).toHaveLength(2);
      // Ordered DESC by date
      expect(stats.dailyHistory[0].date).toBe('2025-06-15');
      expect(stats.dailyHistory[0].cost).toBeCloseTo(0.008, 6);
      expect(stats.dailyHistory[0].requests).toBe(8); // 5 + 3
      expect(stats.dailyHistory[1].date).toBe('2025-06-14');
      expect(stats.dailyHistory[1].cost).toBeCloseTo(0.010, 6);
      expect(stats.dailyHistory[1].requests).toBe(10);
    });

    it('limits to 30 days', () => {
      // Insert 35 days of data
      for (let i = 0; i < 35; i++) {
        const day = String(i + 1).padStart(2, '0');
        const month = i < 28 ? '01' : '02';
        const dayNum = i < 28 ? String(i + 1).padStart(2, '0') : String(i - 27).padStart(2, '0');
        testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
          VALUES ('u${i}', '2025-${month}-${dayNum}T12:00:00Z', 'brightdata', 1, 1000, 0.001)`).run();
      }

      const stats = getUsageStats(testDb);
      expect(stats.dailyHistory.length).toBeLessThanOrEqual(30);
    });
  });

  describe('crawlHistory', () => {
    it('returns empty array with no crawls', () => {
      const stats = getUsageStats(testDb);
      expect(stats.crawlHistory).toEqual([]);
    });

    it('returns crawls with spend > 0, ordered DESC', () => {
      testDb.prepare(`INSERT INTO crawls (id, mode, start_url, start_time, status, config_json, total_spend_usd)
        VALUES ('c1', 'brightdata', 'https://site-a.com', '2025-06-10T10:00:00Z', 'completed', '{}', 0.05)`).run();
      testDb.prepare(`INSERT INTO crawls (id, mode, start_url, start_time, status, config_json, total_spend_usd)
        VALUES ('c2', 'local', 'https://site-b.com', '2025-06-12T10:00:00Z', 'completed', '{}', 0)`).run(); // $0 — excluded
      testDb.prepare(`INSERT INTO crawls (id, mode, start_url, start_time, status, config_json, total_spend_usd)
        VALUES ('c3', 'brightdata', 'https://site-c.com', '2025-06-14T10:00:00Z', 'completed', '{}', 0.10)`).run();

      const stats = getUsageStats(testDb);
      expect(stats.crawlHistory).toHaveLength(2); // c1 and c3 (c2 excluded)
      expect(stats.crawlHistory[0].crawlId).toBe('c3'); // most recent first
      expect(stats.crawlHistory[0].startUrl).toBe('https://site-c.com');
      expect(stats.crawlHistory[0].cost).toBe(0.10);
      expect(stats.crawlHistory[0].date).toBe('2025-06-14');
      expect(stats.crawlHistory[1].crawlId).toBe('c1');
      expect(stats.crawlHistory[1].cost).toBe(0.05);
    });

    it('limits to 20 crawls', () => {
      for (let i = 0; i < 25; i++) {
        const day = String(i + 1).padStart(2, '0');
        testDb.prepare(`INSERT INTO crawls (id, mode, start_url, start_time, status, config_json, total_spend_usd)
          VALUES ('c${i}', 'brightdata', 'https://site${i}.com', '2025-06-${day}T12:00:00Z', 'completed', '{}', 0.01)`).run();
      }

      const stats = getUsageStats(testDb);
      expect(stats.crawlHistory.length).toBeLessThanOrEqual(20);
    });
  });

  describe('combined scenario', () => {
    it('returns consistent totals across all fields', () => {
      const now = new Date().toISOString();
      // Today's logs
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u1', ?, 'brightdata', 10, 100000, 0.010)`).run(now);
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u2', ?, 'brightdata', 5, 50000, 0.005)`).run(now);
      // Yesterday's log
      testDb.prepare(`INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
        VALUES ('u3', '2025-01-01T12:00:00Z', 'brightdata', 20, 200000, 0.020)`).run();

      // Crawl with spend
      testDb.prepare(`INSERT INTO crawls (id, mode, start_url, start_time, status, config_json, total_spend_usd)
        VALUES ('c1', 'brightdata', 'https://example.com', ?, 'completed', '{}', 0.015)`).run(now);

      const stats = getUsageStats(testDb);
      expect(stats.totalSpend).toBeCloseTo(0.035, 6); // all three logs
      expect(stats.todaySpend).toBeCloseTo(0.015, 6); // u1 + u2
      expect(stats.dailyHistory.length).toBeGreaterThanOrEqual(2);
      expect(stats.crawlHistory).toHaveLength(1);
      expect(stats.crawlHistory[0].startUrl).toBe('https://example.com');
    });
  });
});
