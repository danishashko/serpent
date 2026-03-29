/**
 * Tests for database.ts
 *
 * Uses a real better-sqlite3 in-memory database so we prove the SQL works
 * end-to-end, including the snake_case→camelCase column alias mappings
 * that were the root cause of the 4 display bugs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

// ── Inline the DB bootstrap so we don't need to import electron (app.getPath) ──
function buildTestDb() {
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      content_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 1,
      anchor_text TEXT,
      rel_attr TEXT
    );
    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      image_url TEXT NOT NULL,
      alt_text TEXT
    );

    CREATE TABLE IF NOT EXISTS redirects (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      hop_number INTEGER NOT NULL,
      final_url TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hreflang (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      hreflang TEXT NOT NULL,
      href TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS custom_extractions (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      selector TEXT NOT NULL,
      value TEXT
    );
  `);
  return db;
}

// ── Re-implement the SELECT queries from database.ts so we test the exact SQL ──

const CRAWL_SELECT = `
  SELECT id, mode, start_url as startUrl, start_time as startTime, end_time as endTime,
    status, config_json as configJson, total_urls as totalUrls,
    completed_urls as completedUrls, total_spend_usd as totalSpendUsd
  FROM crawls`;

function getAllCrawls(db: Database.Database) {
  return db.prepare(CRAWL_SELECT + ' ORDER BY start_time DESC').all();
}

function getPagesByCrawl(db: Database.Database, crawlId: string) {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, url, status_code as statusCode, content_type as contentType,
      title, title_length as titleLength, title_pixel_width as titlePixelWidth,
      meta_description as metaDescription, meta_desc_length as metaDescLength,
      meta_desc_pixel_width as metaDescPixelWidth, h1, h2,
      word_count as wordCount, canonical_url as canonicalUrl,
      is_canonicalized as isCanonicalized, is_indexable as isIndexable,
      response_time_ms as responseTimeMs, page_size_bytes as pageSizeBytes,
      crawl_depth as crawlDepth, cost_usd as costUsd, created_at as createdAt
    FROM pages WHERE crawl_id = ? ORDER BY created_at ASC
  `).all(crawlId);
}

function getLinksByCrawl(db: Database.Database, crawlId: string) {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      is_internal as isInternal, anchor_text as anchorText, rel_attr as relAttr
    FROM links WHERE crawl_id = ?
  `).all(crawlId);
}

function getImagesByCrawl(db: Database.Database, crawlId: string) {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, image_url as imageUrl,
      alt_text as altText
    FROM images WHERE crawl_id = ?
  `).all(crawlId);
}

// ── Test helpers ──

function seedCrawl(db: Database.Database, id = 'crawl-1') {
  db.prepare(`
    INSERT INTO crawls (id, mode, start_url, start_time, status, config_json, total_urls, completed_urls, total_spend_usd)
    VALUES (?, 'local', 'https://example.com', '2026-01-01T00:00:00Z', 'completed', '{}', 10, 10, 0)
  `).run(id);
}

// ── Tests ──

describe('database column mapping', () => {
  let db: Database.Database;

  beforeEach(() => { db = buildTestDb(); seedCrawl(db); });
  afterEach(() => { db.close(); });

  // ── Crawls ──

  describe('getAllCrawls', () => {
    it('returns camelCase field names', () => {
      const [row] = getAllCrawls(db) as Record<string, unknown>[];
      expect(row).toHaveProperty('startUrl', 'https://example.com');
      expect(row).toHaveProperty('startTime');
      expect(row).toHaveProperty('configJson', '{}');
      expect(row).toHaveProperty('totalUrls', 10);
      expect(row).toHaveProperty('completedUrls', 10);
      expect(row).toHaveProperty('totalSpendUsd', 0);
      // Must NOT contain raw snake_case keys
      expect(row).not.toHaveProperty('start_url');
      expect(row).not.toHaveProperty('config_json');
    });
  });

  // ── Pages ──

  describe('getPagesByCrawl', () => {
    beforeEach(() => {
      db.prepare(`
        INSERT INTO pages (
          id, crawl_id, url, status_code, content_type,
          title, title_length, title_pixel_width,
          meta_description, meta_desc_length, meta_desc_pixel_width,
          h1, h2, word_count, canonical_url, is_canonicalized, is_indexable,
          response_time_ms, page_size_bytes, crawl_depth, cost_usd, created_at
        ) VALUES (
          'page-1', 'crawl-1', 'https://example.com', 200, 'text/html',
          'Home page', 9, 65,
          'A great site', 13, 94,
          'Welcome', NULL, 400, NULL, 0, 1,
          320, 12000, 0, 0, '2026-01-01T00:00:01Z'
        )
      `).run();
    });

    it('maps all snake_case columns to camelCase', () => {
      const [p] = getPagesByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(p.crawlId).toBe('crawl-1');
      expect(p.statusCode).toBe(200);
      expect(p.contentType).toBe('text/html');
      expect(p.titleLength).toBe(9);
      expect(p.titlePixelWidth).toBe(65);
      expect(p.metaDescription).toBe('A great site');
      expect(p.metaDescLength).toBe(13);
      expect(p.metaDescPixelWidth).toBe(94);
      expect(p.wordCount).toBe(400);
      expect(p.canonicalUrl).toBeNull();
      expect(p.isCanonicalized).toBe(0); // SQLite INTEGER
      expect(p.isIndexable).toBe(1);
      expect(p.responseTimeMs).toBe(320);
      expect(p.pageSizeBytes).toBe(12000);
      expect(p.crawlDepth).toBe(0);
      expect(p.costUsd).toBe(0);
      expect(p.createdAt).toBe('2026-01-01T00:00:01Z');
    });

    it('does not expose raw snake_case keys', () => {
      const [p] = getPagesByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(p).not.toHaveProperty('status_code');
      expect(p).not.toHaveProperty('response_time_ms');
      expect(p).not.toHaveProperty('meta_description');
      expect(p).not.toHaveProperty('is_indexable');
    });
  });

  // ── Links ──

  describe('getLinksByCrawl', () => {
    it('maps is_internal → isInternal (internal link)', () => {
      db.prepare(`
        INSERT INTO links (id, crawl_id, source_url, target_url, is_internal, anchor_text, rel_attr)
        VALUES ('link-1', 'crawl-1', 'https://example.com', 'https://example.com/about', 1, 'About us', NULL)
      `).run();

      const [l] = getLinksByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(l.crawlId).toBe('crawl-1');
      expect(l.sourceUrl).toBe('https://example.com');
      expect(l.targetUrl).toBe('https://example.com/about');
      expect(l.isInternal).toBe(1);      // truthy — renders as Internal
      expect(l.anchorText).toBe('About us');
      expect(l.relAttr).toBeNull();
    });

    it('maps is_internal → isInternal (external link)', () => {
      db.prepare(`
        INSERT INTO links (id, crawl_id, source_url, target_url, is_internal, anchor_text, rel_attr)
        VALUES ('link-2', 'crawl-1', 'https://example.com', 'https://other.com', 0, 'Other', 'nofollow')
      `).run();

      const [l] = getLinksByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(l.isInternal).toBe(0);      // falsy — renders as External
      expect(l.anchorText).toBe('Other');
      expect(l.relAttr).toBe('nofollow');
    });

    it('does not expose raw snake_case keys', () => {
      db.prepare(`
        INSERT INTO links (id, crawl_id, source_url, target_url, is_internal)
        VALUES ('link-3', 'crawl-1', 'https://example.com', 'https://example.com/p', 1)
      `).run();
      const [l] = getLinksByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(l).not.toHaveProperty('source_url');
      expect(l).not.toHaveProperty('is_internal');
      expect(l).not.toHaveProperty('anchor_text');
    });
  });

  // ── Images ──

  describe('getImagesByCrawl', () => {
    it('maps page_url, image_url, alt_text to camelCase', () => {
      db.prepare(`
        INSERT INTO images (id, crawl_id, page_url, image_url, alt_text)
        VALUES ('img-1', 'crawl-1', 'https://example.com', 'https://example.com/logo.png', 'Company logo')
      `).run();

      const [img] = getImagesByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(img.crawlId).toBe('crawl-1');
      expect(img.pageUrl).toBe('https://example.com');
      expect(img.imageUrl).toBe('https://example.com/logo.png');
      expect(img.altText).toBe('Company logo');
    });

    it('returns null altText for images without alt attribute', () => {
      db.prepare(`
        INSERT INTO images (id, crawl_id, page_url, image_url, alt_text)
        VALUES ('img-2', 'crawl-1', 'https://example.com', 'https://example.com/bg.jpg', NULL)
      `).run();

      const [img] = getImagesByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(img.altText).toBeNull();
    });

    it('does not expose raw snake_case keys', () => {
      db.prepare(`
        INSERT INTO images (id, crawl_id, page_url, image_url)
        VALUES ('img-3', 'crawl-1', 'https://example.com', 'https://example.com/x.png')
      `).run();
      const [img] = getImagesByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(img).not.toHaveProperty('page_url');
      expect(img).not.toHaveProperty('image_url');
      expect(img).not.toHaveProperty('alt_text');
    });
  });

  // ── Cascade delete ──

  it('deletes pages/links/images when crawl is deleted', () => {
    db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at)
      VALUES ('p1', 'crawl-1', 'https://example.com', 0, 1, 0, 0, '2026-01-01T00:00:00Z')`).run();
    db.prepare(`INSERT INTO links (id, crawl_id, source_url, target_url, is_internal)
      VALUES ('l1', 'crawl-1', 'https://example.com', 'https://example.com/a', 1)`).run();
    db.prepare(`INSERT INTO images (id, crawl_id, page_url, image_url)
      VALUES ('i1', 'crawl-1', 'https://example.com', 'https://example.com/x.png')`).run();

    db.prepare('DELETE FROM crawls WHERE id = ?').run('crawl-1');

    expect(getPagesByCrawl(db, 'crawl-1')).toHaveLength(0);
    expect(getLinksByCrawl(db, 'crawl-1')).toHaveLength(0);
    expect(getImagesByCrawl(db, 'crawl-1')).toHaveLength(0);
  });

  // ── Redirects ──

  describe('redirects table', () => {
    function getRedirectsByCrawl(db: Database.Database, crawlId: string) {
      return db.prepare(`
        SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
          status_code as statusCode, hop_number as hopNumber, final_url as finalUrl
        FROM redirects WHERE crawl_id = ? ORDER BY source_url, hop_number
      `).all(crawlId);
    }

    it('stores and retrieves redirect chains with camelCase mapping', () => {
      db.prepare(`
        INSERT INTO redirects (id, crawl_id, source_url, target_url, status_code, hop_number, final_url)
        VALUES ('r1', 'crawl-1', 'https://example.com/old', 'https://example.com/new', 301, 0, 'https://example.com/final')
      `).run();
      db.prepare(`
        INSERT INTO redirects (id, crawl_id, source_url, target_url, status_code, hop_number, final_url)
        VALUES ('r2', 'crawl-1', 'https://example.com/new', 'https://example.com/final', 200, 1, 'https://example.com/final')
      `).run();

      const rows = getRedirectsByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(rows[0].sourceUrl).toBe('https://example.com/new');
      expect(rows[0].statusCode).toBe(200);
      expect(rows[0].hopNumber).toBe(1);
      expect(rows[0].finalUrl).toBe('https://example.com/final');
    });

    it('does not expose raw snake_case keys', () => {
      db.prepare(`
        INSERT INTO redirects (id, crawl_id, source_url, target_url, status_code, hop_number, final_url)
        VALUES ('r3', 'crawl-1', 'https://example.com/a', 'https://example.com/b', 301, 0, 'https://example.com/b')
      `).run();
      const [r] = getRedirectsByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(r).not.toHaveProperty('source_url');
      expect(r).not.toHaveProperty('target_url');
      expect(r).not.toHaveProperty('status_code');
      expect(r).not.toHaveProperty('hop_number');
      expect(r).not.toHaveProperty('final_url');
    });

    it('cascade deletes redirects when crawl is deleted', () => {
      db.prepare(`
        INSERT INTO redirects (id, crawl_id, source_url, target_url, status_code, hop_number, final_url)
        VALUES ('r4', 'crawl-1', 'https://example.com/x', 'https://example.com/y', 301, 0, 'https://example.com/y')
      `).run();
      db.prepare('DELETE FROM crawls WHERE id = ?').run('crawl-1');
      expect(getRedirectsByCrawl(db, 'crawl-1')).toHaveLength(0);
    });
  });

  // ── Hreflang ──

  describe('hreflang table', () => {
    function getHreflangByCrawl(db: Database.Database, crawlId: string) {
      return db.prepare(`
        SELECT id, crawl_id as crawlId, page_url as pageUrl, hreflang, href
        FROM hreflang WHERE crawl_id = ? ORDER BY page_url, hreflang
      `).all(crawlId);
    }

    it('stores and retrieves hreflang entries with camelCase mapping', () => {
      db.prepare(`
        INSERT INTO hreflang (id, crawl_id, page_url, hreflang, href)
        VALUES ('h1', 'crawl-1', 'https://example.com/', 'en', 'https://example.com/en/')
      `).run();
      db.prepare(`
        INSERT INTO hreflang (id, crawl_id, page_url, hreflang, href)
        VALUES ('h2', 'crawl-1', 'https://example.com/', 'es', 'https://example.com/es/')
      `).run();

      const rows = getHreflangByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(rows).toHaveLength(2);
      expect(rows[0].pageUrl).toBe('https://example.com/');
      expect(rows[0].hreflang).toBe('en');
      expect(rows[0].href).toBe('https://example.com/en/');
      expect(rows[1].hreflang).toBe('es');
    });

    it('does not expose raw snake_case keys', () => {
      db.prepare(`
        INSERT INTO hreflang (id, crawl_id, page_url, hreflang, href)
        VALUES ('h3', 'crawl-1', 'https://example.com/', 'de', 'https://example.com/de/')
      `).run();
      const [h] = getHreflangByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(h).not.toHaveProperty('page_url');
      expect(h).not.toHaveProperty('crawl_id');
    });

    it('cascade deletes hreflang when crawl is deleted', () => {
      db.prepare(`
        INSERT INTO hreflang (id, crawl_id, page_url, hreflang, href)
        VALUES ('h4', 'crawl-1', 'https://example.com/', 'fr', 'https://example.com/fr/')
      `).run();
      db.prepare('DELETE FROM crawls WHERE id = ?').run('crawl-1');
      expect(getHreflangByCrawl(db, 'crawl-1')).toHaveLength(0);
    });
  });

  // ── Custom extractions ──

  describe('custom_extractions table', () => {
    function getCustomExtractionsByCrawl(db: Database.Database, crawlId: string) {
      return db.prepare(`
        SELECT id, crawl_id as crawlId, page_url as pageUrl, rule_name as ruleName, selector, value
        FROM custom_extractions WHERE crawl_id = ? ORDER BY page_url, rule_name
      `).all(crawlId);
    }

    it('stores and retrieves custom extractions with camelCase mapping', () => {
      db.prepare(`
        INSERT INTO custom_extractions (id, crawl_id, page_url, rule_name, selector, value)
        VALUES ('ce1', 'crawl-1', 'https://example.com/product', 'Price', '.price', '$29.99')
      `).run();

      const rows = getCustomExtractionsByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(rows).toHaveLength(1);
      expect(rows[0].pageUrl).toBe('https://example.com/product');
      expect(rows[0].ruleName).toBe('Price');
      expect(rows[0].selector).toBe('.price');
      expect(rows[0].value).toBe('$29.99');
    });

    it('stores null value when selector matched nothing', () => {
      db.prepare(`
        INSERT INTO custom_extractions (id, crawl_id, page_url, rule_name, selector, value)
        VALUES ('ce2', 'crawl-1', 'https://example.com/page', 'SKU', '.sku', NULL)
      `).run();

      const [ce] = getCustomExtractionsByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(ce.value).toBeNull();
    });

    it('does not expose raw snake_case keys', () => {
      db.prepare(`
        INSERT INTO custom_extractions (id, crawl_id, page_url, rule_name, selector, value)
        VALUES ('ce3', 'crawl-1', 'https://example.com/page', 'Title', 'h1', 'Hello')
      `).run();
      const [ce] = getCustomExtractionsByCrawl(db, 'crawl-1') as Record<string, unknown>[];
      expect(ce).not.toHaveProperty('page_url');
      expect(ce).not.toHaveProperty('rule_name');
      expect(ce).not.toHaveProperty('crawl_id');
    });

    it('cascade deletes custom extractions when crawl is deleted', () => {
      db.prepare(`
        INSERT INTO custom_extractions (id, crawl_id, page_url, rule_name, selector, value)
        VALUES ('ce4', 'crawl-1', 'https://example.com/page', 'Test', 'div', 'val')
      `).run();
      db.prepare('DELETE FROM crawls WHERE id = ?').run('crawl-1');
      expect(getCustomExtractionsByCrawl(db, 'crawl-1')).toHaveLength(0);
    });
  });

  // ── Duplicate content detection (getDuplicatesByCrawl) ──

  describe('duplicate content detection', () => {
    function getDuplicatesByCrawl(db: Database.Database, crawlId: string) {
      const rows = db.prepare(`
        SELECT content_hash as contentHash, GROUP_CONCAT(url) as urls
        FROM pages
        WHERE crawl_id = ? AND content_hash IS NOT NULL
        GROUP BY content_hash
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC
      `).all(crawlId) as { contentHash: string; urls: string }[];
      return rows.map(r => ({ contentHash: r.contentHash, urls: r.urls.split(',') }));
    }

    it('detects pages with identical content hashes', () => {
      // Two pages with the same hash
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p1', 'crawl-1', 'https://example.com/a', 0, 1, 0, 0, '2026-01-01T00:00:01Z', 'abc123')`).run();
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p2', 'crawl-1', 'https://example.com/b', 0, 1, 0, 0, '2026-01-01T00:00:02Z', 'abc123')`).run();
      // One page with a different hash (should NOT appear)
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p3', 'crawl-1', 'https://example.com/c', 0, 1, 0, 0, '2026-01-01T00:00:03Z', 'unique456')`).run();

      const dupes = getDuplicatesByCrawl(db, 'crawl-1');
      expect(dupes).toHaveLength(1);
      expect(dupes[0].contentHash).toBe('abc123');
      expect(dupes[0].urls).toContain('https://example.com/a');
      expect(dupes[0].urls).toContain('https://example.com/b');
      expect(dupes[0].urls).toHaveLength(2);
    });

    it('returns empty when no duplicates exist', () => {
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p4', 'crawl-1', 'https://example.com/unique', 0, 1, 0, 0, '2026-01-01T00:00:01Z', 'hash1')`).run();
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p5', 'crawl-1', 'https://example.com/other', 0, 1, 0, 0, '2026-01-01T00:00:02Z', 'hash2')`).run();

      const dupes = getDuplicatesByCrawl(db, 'crawl-1');
      expect(dupes).toHaveLength(0);
    });

    it('ignores pages with null content hash', () => {
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p6', 'crawl-1', 'https://example.com/nohtml1', 0, 1, 0, 0, '2026-01-01T00:00:01Z', NULL)`).run();
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p7', 'crawl-1', 'https://example.com/nohtml2', 0, 1, 0, 0, '2026-01-01T00:00:02Z', NULL)`).run();

      const dupes = getDuplicatesByCrawl(db, 'crawl-1');
      expect(dupes).toHaveLength(0);
    });

    it('detects multiple duplicate groups', () => {
      // Group 1: hash "aaa"
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p8', 'crawl-1', 'https://example.com/d1', 0, 1, 0, 0, '2026-01-01T00:00:01Z', 'aaa')`).run();
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p9', 'crawl-1', 'https://example.com/d2', 0, 1, 0, 0, '2026-01-01T00:00:02Z', 'aaa')`).run();
      // Group 2: hash "bbb"
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p10', 'crawl-1', 'https://example.com/e1', 0, 1, 0, 0, '2026-01-01T00:00:03Z', 'bbb')`).run();
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p11', 'crawl-1', 'https://example.com/e2', 0, 1, 0, 0, '2026-01-01T00:00:04Z', 'bbb')`).run();
      db.prepare(`INSERT INTO pages (id, crawl_id, url, is_canonicalized, is_indexable, crawl_depth, cost_usd, created_at, content_hash)
        VALUES ('p12', 'crawl-1', 'https://example.com/e3', 0, 1, 0, 0, '2026-01-01T00:00:05Z', 'bbb')`).run();

      const dupes = getDuplicatesByCrawl(db, 'crawl-1');
      expect(dupes).toHaveLength(2);
      // Ordered by COUNT(*) DESC, so bbb (3) comes first
      expect(dupes[0].contentHash).toBe('bbb');
      expect(dupes[0].urls).toHaveLength(3);
      expect(dupes[1].contentHash).toBe('aaa');
      expect(dupes[1].urls).toHaveLength(2);
    });
  });
});
