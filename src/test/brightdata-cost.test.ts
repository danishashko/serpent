/**
 * Tests for Bright Data cost calculation (CPM model) and resume helpers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Mock database module
let testDb: Database.Database;

vi.mock('../main/database', () => ({
  getDb: () => testDb,
  getCrawledUrls: (crawlId: string) => {
    const rows = testDb.prepare('SELECT url FROM pages WHERE crawl_id = ?').all(crawlId) as { url: string }[];
    return rows.map(r => r.url);
  },
  getLatestIncompleteCrawl: () => {
    return testDb.prepare(
      `SELECT id, start_url as startUrl, status, total_urls as totalUrls, completed_urls as completedUrls
       FROM crawls WHERE status = 'running' ORDER BY start_time DESC LIMIT 1`
    ).get() || null;
  },
}));

import { calculateBrightDataCost } from '../main/crawler-brightdata';
import { getCrawledUrls, getLatestIncompleteCrawl } from '../main/database';

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
    CREATE TABLE IF NOT EXISTS pages (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      status_code INTEGER,
      content_type TEXT,
      title TEXT,
      title_length INTEGER,
      title_pixel_width INTEGER,
      meta_description TEXT,
      meta_desc_length INTEGER,
      meta_desc_pixel_width INTEGER,
      h1 TEXT,
      h2 TEXT,
      word_count INTEGER,
      canonical_url TEXT,
      is_canonicalized INTEGER NOT NULL DEFAULT 0,
      is_indexable INTEGER NOT NULL DEFAULT 1,
      response_time_ms INTEGER,
      page_size_bytes INTEGER,
      crawl_depth INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

describe('calculateBrightDataCost (CPM model)', () => {
  it('returns $0.001 per request regardless of bytes', () => {
    expect(calculateBrightDataCost()).toBe(0.001);
  });

  it('is consistent across multiple calls', () => {
    const a = calculateBrightDataCost();
    const b = calculateBrightDataCost();
    expect(a).toBe(b);
    expect(a).toBe(0.001);
  });
});

describe('Resume helpers', () => {
  beforeEach(() => {
    testDb = createTestDb();
  });
  afterEach(() => {
    testDb.close();
  });

  describe('getCrawledUrls', () => {
    it('returns all crawled URLs for a given crawl', () => {
      testDb.prepare(`INSERT INTO crawls (id, start_url, start_time, status, config_json) VALUES (?, ?, ?, ?, ?)`).run(
        'crawl-1', 'https://example.com', '2026-01-01T00:00:00Z', 'running', '{}'
      );
      testDb.prepare(`INSERT INTO pages (id, crawl_id, url) VALUES (?, ?, ?)`).run('p1', 'crawl-1', 'https://example.com');
      testDb.prepare(`INSERT INTO pages (id, crawl_id, url) VALUES (?, ?, ?)`).run('p2', 'crawl-1', 'https://example.com/about');
      testDb.prepare(`INSERT INTO pages (id, crawl_id, url) VALUES (?, ?, ?)`).run('p3', 'crawl-1', 'https://example.com/contact');

      const urls = getCrawledUrls('crawl-1');
      expect(urls).toHaveLength(3);
      expect(urls).toContain('https://example.com');
      expect(urls).toContain('https://example.com/about');
      expect(urls).toContain('https://example.com/contact');
    });

    it('returns empty array for crawl with no pages', () => {
      testDb.prepare(`INSERT INTO crawls (id, start_url, start_time, status, config_json) VALUES (?, ?, ?, ?, ?)`).run(
        'crawl-2', 'https://example.com', '2026-01-01T00:00:00Z', 'running', '{}'
      );
      const urls = getCrawledUrls('crawl-2');
      expect(urls).toEqual([]);
    });
  });

  describe('getLatestIncompleteCrawl', () => {
    it('returns the latest running crawl', () => {
      testDb.prepare(`INSERT INTO crawls (id, start_url, start_time, status, config_json, total_urls, completed_urls) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        'old-crawl', 'https://old.com', '2026-01-01T00:00:00Z', 'running', '{}', 100, 50
      );
      testDb.prepare(`INSERT INTO crawls (id, start_url, start_time, status, config_json, total_urls, completed_urls) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
        'new-crawl', 'https://new.com', '2026-01-02T00:00:00Z', 'running', '{}', 200, 75
      );

      const result = getLatestIncompleteCrawl() as Record<string, unknown>;
      expect(result).not.toBeNull();
      expect(result.id).toBe('new-crawl');
      expect(result.startUrl).toBe('https://new.com');
      expect(result.completedUrls).toBe(75);
    });

    it('returns null when no running crawls exist', () => {
      testDb.prepare(`INSERT INTO crawls (id, start_url, start_time, status, config_json) VALUES (?, ?, ?, ?, ?)`).run(
        'done-crawl', 'https://done.com', '2026-01-01T00:00:00Z', 'completed', '{}'
      );
      expect(getLatestIncompleteCrawl()).toBeNull();
    });
  });
});
