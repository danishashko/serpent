import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { PageData, LinkData, ImageData, CrawlRecord, AIAnalysis, UsageLog } from '../types/index';

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

export function initDatabase(dataPath?: string): Database.Database {
  const dbPath = dataPath || path.join(app.getPath('userData'), 'ghostfrog.db');
  db = new Database(dbPath);

  // Enable WAL mode for concurrent reads + faster writes
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  createTables();
  return db;
}

function createTables(): void {
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

    CREATE INDEX IF NOT EXISTS idx_pages_crawl_id ON pages(crawl_id);
    CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
    CREATE INDEX IF NOT EXISTS idx_pages_status_code ON pages(status_code);

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      is_internal INTEGER NOT NULL DEFAULT 1,
      anchor_text TEXT,
      rel_attr TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_links_crawl_id ON links(crawl_id);
    CREATE INDEX IF NOT EXISTS idx_links_source_url ON links(source_url);

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      image_url TEXT NOT NULL,
      alt_text TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_images_crawl_id ON images(crawl_id);

    CREATE TABLE IF NOT EXISTS ai_analysis (
      page_id TEXT NOT NULL,
      analysis_type TEXT NOT NULL,
      score REAL,
      insights_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (page_id, analysis_type)
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      engine_type TEXT NOT NULL,
      urls_crawled INTEGER NOT NULL DEFAULT 0,
      bytes_downloaded INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

// ----- Crawl operations -----

export function insertCrawl(crawl: CrawlRecord): void {
  const stmt = db.prepare(`
    INSERT INTO crawls (id, mode, start_url, start_time, end_time, status, config_json, total_urls, completed_urls, total_spend_usd)
    VALUES (@id, @mode, @startUrl, @startTime, @endTime, @status, @configJson, @totalUrls, @completedUrls, @totalSpendUsd)
  `);
  stmt.run({
    id: crawl.id,
    mode: crawl.mode,
    startUrl: crawl.startUrl,
    startTime: crawl.startTime,
    endTime: crawl.endTime ?? null,
    status: crawl.status,
    configJson: crawl.configJson,
    totalUrls: crawl.totalUrls,
    completedUrls: crawl.completedUrls,
    totalSpendUsd: crawl.totalSpendUsd,
  });
}

export function updateCrawlStatus(
  id: string,
  status: string,
  totalUrls: number,
  completedUrls: number,
  totalSpendUsd: number,
  endTime?: string
): void {
  db.prepare(`
    UPDATE crawls SET status = ?, total_urls = ?, completed_urls = ?, total_spend_usd = ?, end_time = ?
    WHERE id = ?
  `).run(status, totalUrls, completedUrls, totalSpendUsd, endTime ?? null, id);
}

const CRAWL_SELECT = `
  SELECT id, mode, start_url as startUrl, start_time as startTime, end_time as endTime,
    status, config_json as configJson, total_urls as totalUrls,
    completed_urls as completedUrls, total_spend_usd as totalSpendUsd
  FROM crawls`;

export function getAllCrawls(): CrawlRecord[] {
  return db.prepare(CRAWL_SELECT + ' ORDER BY start_time DESC').all() as CrawlRecord[];
}

export function getLatestIncompleteCrawl(): CrawlRecord | undefined {
  return db.prepare(
    CRAWL_SELECT + " WHERE status IN ('running', 'paused') ORDER BY start_time DESC LIMIT 1"
  ).get() as CrawlRecord | undefined;
}

// ----- Page operations -----

export function insertPage(page: PageData): void {
  db.prepare(`
    INSERT OR REPLACE INTO pages (
      id, crawl_id, url, status_code, content_type,
      title, title_length, title_pixel_width,
      meta_description, meta_desc_length, meta_desc_pixel_width,
      h1, h2, word_count, canonical_url, is_canonicalized, is_indexable,
      response_time_ms, page_size_bytes, crawl_depth, cost_usd, created_at
    ) VALUES (
      @id, @crawlId, @url, @statusCode, @contentType,
      @title, @titleLength, @titlePixelWidth,
      @metaDescription, @metaDescLength, @metaDescPixelWidth,
      @h1, @h2, @wordCount, @canonicalUrl, @isCanonicalized, @isIndexable,
      @responseTimeMs, @pageSizeBytes, @crawlDepth, @costUsd, @createdAt
    )
  `).run({
    id: page.id,
    crawlId: page.crawlId,
    url: page.url,
    statusCode: page.statusCode,
    contentType: page.contentType,
    title: page.title,
    titleLength: page.titleLength,
    titlePixelWidth: page.titlePixelWidth,
    metaDescription: page.metaDescription,
    metaDescLength: page.metaDescLength,
    metaDescPixelWidth: page.metaDescPixelWidth,
    h1: page.h1,
    h2: page.h2,
    wordCount: page.wordCount,
    canonicalUrl: page.canonicalUrl,
    isCanonicalized: page.isCanonicalized ? 1 : 0,
    isIndexable: page.isIndexable ? 1 : 0,
    responseTimeMs: page.responseTimeMs,
    pageSizeBytes: page.pageSizeBytes,
    crawlDepth: page.crawlDepth,
    costUsd: page.costUsd,
    createdAt: page.createdAt,
  });
}

export function pageExists(crawlId: string, url: string): boolean {
  const row = db.prepare('SELECT 1 FROM pages WHERE crawl_id = ? AND url = ?').get(crawlId, url);
  return !!row;
}

export function getCrawledUrls(crawlId: string): string[] {
  const rows = db.prepare('SELECT url FROM pages WHERE crawl_id = ?').all(crawlId) as { url: string }[];
  return rows.map(r => r.url);
}

export function getPagesByCrawl(crawlId: string): PageData[] {
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
  `).all(crawlId) as PageData[];
}

export function getPageCount(crawlId: string): number {
  const result = db.prepare('SELECT COUNT(*) as count FROM pages WHERE crawl_id = ?').get(crawlId) as { count: number };
  return result.count;
}

// ----- Link operations -----

export function insertLinks(links: LinkData[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO links (id, crawl_id, source_url, target_url, is_internal, anchor_text, rel_attr)
    VALUES (@id, @crawlId, @sourceUrl, @targetUrl, @isInternal, @anchorText, @relAttr)
  `);
  const insertMany = db.transaction((rows: LinkData[]) => {
    for (const row of rows) {
      stmt.run({
        id: row.id,
        crawlId: row.crawlId,
        sourceUrl: row.sourceUrl,
        targetUrl: row.targetUrl,
        isInternal: row.isInternal ? 1 : 0,
        anchorText: row.anchorText,
        relAttr: row.relAttr,
      });
    }
  });
  insertMany(links);
}

export function getLinksByCrawl(crawlId: string): LinkData[] {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      is_internal as isInternal, anchor_text as anchorText, rel_attr as relAttr
    FROM links WHERE crawl_id = ?
  `).all(crawlId) as LinkData[];
}

// ----- Image operations -----

export function insertImages(images: ImageData[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO images (id, crawl_id, page_url, image_url, alt_text)
    VALUES (@id, @crawlId, @pageUrl, @imageUrl, @altText)
  `);
  const insertMany = db.transaction((rows: ImageData[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(images);
}

export function getImagesByCrawl(crawlId: string): ImageData[] {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, image_url as imageUrl,
      alt_text as altText
    FROM images WHERE crawl_id = ?
  `).all(crawlId) as ImageData[];
}

// ----- AI Analysis -----

export function upsertAIAnalysis(analysis: AIAnalysis): void {
  db.prepare(`
    INSERT OR REPLACE INTO ai_analysis (page_id, analysis_type, score, insights_json, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(analysis.pageId, analysis.analysisType, analysis.score, analysis.insightsJson, analysis.createdAt);
}

export function getAIAnalysisByPage(pageId: string): AIAnalysis[] {
  return db.prepare('SELECT * FROM ai_analysis WHERE page_id = ?').all(pageId) as AIAnalysis[];
}

// ----- Usage Logs -----

export function insertUsageLog(log: UsageLog): void {
  db.prepare(`
    INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(log.id, log.timestamp, log.engineType, log.urlsCrawled, log.bytesDownloaded, log.costUsd);
}

export function getUsageLogs(): UsageLog[] {
  return db.prepare('SELECT * FROM usage_logs ORDER BY timestamp DESC').all() as UsageLog[];
}

export function getUsageStats(): { totalSpend: number; todaySpend: number; dailyHistory: { date: string; cost: number; requests: number }[]; crawlHistory: { crawlId: string; startUrl: string; cost: number; date: string }[] } {
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

// ----- App Config -----

export function getConfig(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO app_config (key, value) VALUES (?, ?)').run(key, value);
}

export function closeDatabase(): void {
  if (db) db.close();
}
