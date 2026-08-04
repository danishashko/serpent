import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { PageData, LinkData, ImageData, RedirectData, HreflangData, CustomExtractionResult, CrawlRecord, AIAnalysis, IssueRecommendation, UsageLog, CrawlDiff, CrawlDiffChange, GEOScore, PerformanceScore, CrawlSchedule, PsiScore } from '../types/index';

let db: Database.Database;

export function getDb(): Database.Database {
  return db;
}

export function initDatabase(dataPath?: string): Database.Database {
  const dbPath = dataPath || path.join(app.getPath('userData'), 'serpent.db');
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

    CREATE TABLE IF NOT EXISTS redirects (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      source_url TEXT NOT NULL,
      target_url TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      hop_number INTEGER NOT NULL,
      final_url TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_redirects_crawl_id ON redirects(crawl_id);
    CREATE INDEX IF NOT EXISTS idx_redirects_source_url ON redirects(source_url);

    CREATE TABLE IF NOT EXISTS hreflang (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      hreflang TEXT NOT NULL,
      href TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_hreflang_crawl_id ON hreflang(crawl_id);

    CREATE TABLE IF NOT EXISTS custom_extractions (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      page_url TEXT NOT NULL,
      rule_name TEXT NOT NULL,
      selector TEXT NOT NULL,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_custom_extractions_crawl_id ON custom_extractions(crawl_id);

    CREATE TABLE IF NOT EXISTS issue_recommendations (
      crawl_id TEXT NOT NULL,
      issue_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      explanation TEXT NOT NULL,
      fix_suggestions_json TEXT NOT NULL,
      affected_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (crawl_id, issue_type)
    );

    CREATE INDEX IF NOT EXISTS idx_issue_recs_crawl_id ON issue_recommendations(crawl_id);

    CREATE TABLE IF NOT EXISTS geo_scores (
      page_id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      overall_score REAL NOT NULL DEFAULT 0,
      entity_clarity REAL NOT NULL DEFAULT 0,
      answer_readiness REAL NOT NULL DEFAULT 0,
      citation_signals REAL NOT NULL DEFAULT 0,
      structured_data_completeness REAL NOT NULL DEFAULT 0,
      issues_json TEXT,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_geo_scores_crawl_id ON geo_scores(crawl_id);

    CREATE TABLE IF NOT EXISTS performance_scores (
      page_id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      overall_score REAL NOT NULL DEFAULT 0,
      ttfb_score REAL NOT NULL DEFAULT 0,
      page_size_score REAL NOT NULL DEFAULT 0,
      image_opt_score REAL NOT NULL DEFAULT 0,
      content_efficiency REAL NOT NULL DEFAULT 0,
      ttfb_ms REAL NOT NULL DEFAULT 0,
      total_bytes INTEGER NOT NULL DEFAULT 0,
      image_bytes INTEGER NOT NULL DEFAULT 0,
      issues_json TEXT,
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_perf_scores_crawl_id ON performance_scores(crawl_id);

    CREATE TABLE IF NOT EXISTS discover_results (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      search_type TEXT NOT NULL,
      link TEXT NOT NULL,
      title TEXT,
      description TEXT,
      relevance_score REAL NOT NULL DEFAULT 0,
      content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_discover_results_crawl_id ON discover_results(crawl_id);

    CREATE TABLE IF NOT EXISTS content_gaps (
      id TEXT PRIMARY KEY,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      topic TEXT NOT NULL,
      has_own_content INTEGER NOT NULL DEFAULT 0,
      own_content_count INTEGER NOT NULL DEFAULT 0,
      competitor_count INTEGER NOT NULL DEFAULT 0,
      competitor_domains_json TEXT,
      top_competitor_urls_json TEXT,
      avg_relevance_score REAL NOT NULL DEFAULT 0,
      gap_severity TEXT NOT NULL DEFAULT 'none',
      analyzed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_content_gaps_crawl_id ON content_gaps(crawl_id);
  `);

  // Add content_hash column if it doesn't exist (migration for existing DBs)
  try {
    db.exec('ALTER TABLE pages ADD COLUMN content_hash TEXT');
  } catch {
    // Column already exists — ignore
  }

  // SF-parity columns — migration for existing DBs
  const newColumns = [
    'ALTER TABLE pages ADD COLUMN h1_length INTEGER',
    'ALTER TABLE pages ADD COLUMN h2_length INTEGER',
    'ALTER TABLE pages ADD COLUMN h1_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pages ADD COLUMN h2_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pages ADD COLUMN robots_directives TEXT',
    'ALTER TABLE pages ADD COLUMN meta_keywords TEXT',
    'ALTER TABLE pages ADD COLUMN text_ratio REAL',
    // OG / Twitter Card
    'ALTER TABLE pages ADD COLUMN og_title TEXT',
    'ALTER TABLE pages ADD COLUMN og_description TEXT',
    'ALTER TABLE pages ADD COLUMN og_image TEXT',
    'ALTER TABLE pages ADD COLUMN og_type TEXT',
    'ALTER TABLE pages ADD COLUMN twitter_card TEXT',
    'ALTER TABLE pages ADD COLUMN twitter_title TEXT',
    'ALTER TABLE pages ADD COLUMN twitter_description TEXT',
    'ALTER TABLE pages ADD COLUMN twitter_image TEXT',
    // Structured Data
    'ALTER TABLE pages ADD COLUMN schema_types TEXT',
    'ALTER TABLE pages ADD COLUMN schema_json TEXT',
    'ALTER TABLE pages ADD COLUMN schema_errors TEXT',
    'ALTER TABLE pages ADD COLUMN has_structured_data INTEGER NOT NULL DEFAULT 0',
    // Security headers
    'ALTER TABLE pages ADD COLUMN has_hsts INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pages ADD COLUMN has_csp INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pages ADD COLUMN x_frame_options TEXT',
    'ALTER TABLE pages ADD COLUMN x_content_type_options TEXT',
    // Image optimization audit
    'ALTER TABLE images ADD COLUMN format TEXT',
    'ALTER TABLE images ADD COLUMN has_width INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE images ADD COLUMN has_height INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE images ADD COLUMN is_lazy INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pages ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE pages ADD COLUMN link_score REAL NOT NULL DEFAULT 0',
  ];
  for (const ddl of newColumns) {
    try { db.exec(ddl); } catch { /* already exists */ }
  }

  // External link status code — migration for existing DBs
  try { db.exec('ALTER TABLE links ADD COLUMN status_code INTEGER'); } catch { /* already exists */ }

  // Simhash fingerprint for near-duplicate detection — migration for existing DBs
  try { db.exec('ALTER TABLE pages ADD COLUMN simhash TEXT'); } catch { /* already exists */ }

  // Crawl retention lock — migration for existing DBs
  try { db.exec('ALTER TABLE crawls ADD COLUMN locked INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }

  // Auto-compare for scheduled crawls — migration for existing DBs.
  // The `schedules` half runs after that table is created, further down.
  try { db.exec('ALTER TABLE crawls ADD COLUMN schedule_id TEXT'); } catch { /* already exists */ }

  // Link crawlability (Google crawlable-link guidance) — migration for existing DBs
  try { db.exec("ALTER TABLE links ADD COLUMN crawlability TEXT NOT NULL DEFAULT 'crawlable'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE links ADD COLUMN uncrawlable_reason TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE pages ADD COLUMN uncrawlable_outlinks INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }

  // PageSpeed Insights / CWV scores
  db.exec(`
    CREATE TABLE IF NOT EXISTS psi_scores (
      page_id TEXT NOT NULL,
      crawl_id TEXT NOT NULL REFERENCES crawls(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      strategy TEXT NOT NULL DEFAULT 'mobile',
      performance_score REAL,
      lcp_ms REAL,
      cls_value REAL,
      tbt_ms REAL,
      fcp_ms REAL,
      speed_index_ms REAL,
      field_lcp_ms REAL,
      field_inp_ms REAL,
      field_cls REAL,
      field_overall_category TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (page_id, strategy)
    );
    CREATE INDEX IF NOT EXISTS idx_psi_scores_crawl_id ON psi_scores(crawl_id);
  `);

  // Scheduled crawls
  db.exec(`
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      start_url TEXT NOT NULL,
      interval_hours REAL NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run TEXT,
      next_run TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Schedule columns — must come after the CREATE above, or the ALTER silently
  // fails on a fresh database and the column is never added.
  try { db.exec('ALTER TABLE schedules ADD COLUMN auto_compare INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE schedules ADD COLUMN last_diff_json TEXT'); } catch { /* already exists */ }
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
    completed_urls as completedUrls, total_spend_usd as totalSpendUsd, locked,
    schedule_id as scheduleId
  FROM crawls`;

function toCrawlRecord(row: Record<string, unknown>): CrawlRecord {
  return { ...(row as unknown as CrawlRecord), locked: !!row.locked };
}

export function getAllCrawls(): CrawlRecord[] {
  const rows = db.prepare(CRAWL_SELECT + ' ORDER BY start_time DESC').all() as Record<string, unknown>[];
  return rows.map(toCrawlRecord);
}

export function getCrawlById(id: string): CrawlRecord | undefined {
  const row = db.prepare(CRAWL_SELECT + ' WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toCrawlRecord(row) : undefined;
}

// ----- Crawl retention -----

/** Lock a crawl so the retention policy never deletes it. */
export function setCrawlLocked(crawlId: string, locked: boolean): void {
  db.prepare('UPDATE crawls SET locked = ? WHERE id = ?').run(locked ? 1 : 0, crawlId);
}

/** Delete a crawl and everything hanging off it (pages/links/images cascade). */
export function deleteCrawl(crawlId: string): void {
  db.prepare('DELETE FROM crawls WHERE id = ?').run(crawlId);
}

/**
 * Delete completed crawls older than `days`, skipping locked ones. Returns the
 * ids that were removed. A `days` of 0 or less means "never delete" and is a
 * no-op — retention has to be opted into.
 */
export function purgeCrawlsOlderThan(days: number, nowMs: number): string[] {
  if (!Number.isFinite(days) || days <= 0) return [];
  const cutoff = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
  // Never touch a crawl that is still running or paused — only settled ones.
  const rows = db.prepare(`
    SELECT id FROM crawls
    WHERE locked = 0
      AND start_time < ?
      AND status NOT IN ('running', 'paused')
  `).all(cutoff) as { id: string }[];
  const purge = db.transaction((ids: string[]) => {
    const stmt = db.prepare('DELETE FROM crawls WHERE id = ?');
    for (const id of ids) stmt.run(id);
  });
  const ids = rows.map(r => r.id);
  if (ids.length > 0) purge(ids);
  return ids;
}

export function getLatestIncompleteCrawl(): CrawlRecord | undefined {
  // Only treat *intentionally paused* crawls as resumable. A crawl with status='running'
  // at app start means the previous session crashed/was killed — those are marked
  // 'interrupted' by markRunningCrawlsAsInterrupted() during startup and won't appear here.
  const row = db.prepare(
    CRAWL_SELECT + " WHERE status IN ('paused', 'interrupted') ORDER BY start_time DESC LIMIT 1"
  ).get() as Record<string, unknown> | undefined;
  return row ? toCrawlRecord(row) : undefined;
}

/** Called once on app startup. Any crawl still marked 'running' in the DB belongs to
 *  a previous session that didn't shut down cleanly. Mark them as 'interrupted' so
 *  they don't pop up the resume prompt on every launch. */
export function markRunningCrawlsAsInterrupted(): number {
  const result = db.prepare(
    "UPDATE crawls SET status = 'interrupted', end_time = COALESCE(end_time, ?) WHERE status = 'running'"
  ).run(new Date().toISOString());
  return result.changes;
}

// ----- Page operations -----

export function insertPage(page: PageData): void {
  db.prepare(`
    INSERT OR REPLACE INTO pages (
      id, crawl_id, url, status_code, content_type,
      title, title_length, title_pixel_width,
      meta_description, meta_desc_length, meta_desc_pixel_width,
      h1, h2, word_count, canonical_url, is_canonicalized, is_indexable,
      response_time_ms, page_size_bytes, crawl_depth, cost_usd, created_at, content_hash,
      h1_length, h2_length, h1_count, h2_count, robots_directives, meta_keywords, text_ratio,
      og_title, og_description, og_image, og_type,
      twitter_card, twitter_title, twitter_description, twitter_image,
      schema_types, schema_json, schema_errors, has_structured_data,
      has_hsts, has_csp, x_frame_options, x_content_type_options, image_count, link_score, simhash,
      uncrawlable_outlinks
    ) VALUES (
      @id, @crawlId, @url, @statusCode, @contentType,
      @title, @titleLength, @titlePixelWidth,
      @metaDescription, @metaDescLength, @metaDescPixelWidth,
      @h1, @h2, @wordCount, @canonicalUrl, @isCanonicalized, @isIndexable,
      @responseTimeMs, @pageSizeBytes, @crawlDepth, @costUsd, @createdAt, @contentHash,
      @h1Length, @h2Length, @h1Count, @h2Count, @robotsDirectives, @metaKeywords, @textRatio,
      @ogTitle, @ogDescription, @ogImage, @ogType,
      @twitterCard, @twitterTitle, @twitterDescription, @twitterImage,
      @schemaTypes, @schemaJson, @schemaErrors, @hasStructuredData,
      @hasHSTS, @hasCSP, @xFrameOptions, @xContentTypeOptions, @imageCount, @linkScore, @simhash,
      @uncrawlableOutlinks
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
    contentHash: page.contentHash,
    h1Length: page.h1Length,
    h2Length: page.h2Length,
    h1Count: page.h1Count,
    h2Count: page.h2Count,
    robotsDirectives: page.robotsDirectives,
    metaKeywords: page.metaKeywords,
    textRatio: page.textRatio,
    ogTitle: page.ogTitle,
    ogDescription: page.ogDescription,
    ogImage: page.ogImage,
    ogType: page.ogType,
    twitterCard: page.twitterCard,
    twitterTitle: page.twitterTitle,
    twitterDescription: page.twitterDescription,
    twitterImage: page.twitterImage,
    schemaTypes: page.schemaTypes,
    schemaJson: page.schemaJson,
    schemaErrors: page.schemaErrors,
    hasStructuredData: page.hasStructuredData ? 1 : 0,
    hasHSTS: page.hasHSTS ? 1 : 0,
    hasCSP: page.hasCSP ? 1 : 0,
    xFrameOptions: page.xFrameOptions,
    xContentTypeOptions: page.xContentTypeOptions,
    imageCount: page.imageCount,
    linkScore: page.linkScore,
    simhash: page.simhash,
    uncrawlableOutlinks: page.uncrawlableOutlinks ?? 0,
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

/**
 * Frontier for resuming an interrupted crawl: internal link targets that were
 * discovered but never crawled, each with the depth it would have been
 * enqueued at (min source depth + 1).
 */
export function getUncrawledLinkTargets(crawlId: string): { url: string; depth: number }[] {
  const rows = db.prepare(`
    SELECT l.target_url as url, COALESCE(MIN(p.crawl_depth), 0) + 1 as depth
    FROM links l
    JOIN pages p ON p.crawl_id = l.crawl_id AND p.url = l.source_url
    WHERE l.crawl_id = ? AND l.is_internal = 1 AND l.crawlability = 'crawlable'
      AND l.target_url NOT IN (SELECT url FROM pages WHERE crawl_id = ?)
    GROUP BY l.target_url
  `).all(crawlId, crawlId) as { url: string; depth: number }[];
  return rows;
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
      crawl_depth as crawlDepth, cost_usd as costUsd, created_at as createdAt,
      content_hash as contentHash,
      h1_length as h1Length, h2_length as h2Length,
      h1_count as h1Count, h2_count as h2Count,
      robots_directives as robotsDirectives, meta_keywords as metaKeywords,
      text_ratio as textRatio,
      og_title as ogTitle, og_description as ogDescription,
      og_image as ogImage, og_type as ogType,
      twitter_card as twitterCard, twitter_title as twitterTitle,
      twitter_description as twitterDescription, twitter_image as twitterImage,
      schema_types as schemaTypes, schema_json as schemaJson,
      schema_errors as schemaErrors, has_structured_data as hasStructuredData,
      has_hsts as hasHSTS, has_csp as hasCSP,
      x_frame_options as xFrameOptions, x_content_type_options as xContentTypeOptions,
      image_count as imageCount, link_score as linkScore, simhash,
      uncrawlable_outlinks as uncrawlableOutlinks
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
    INSERT OR IGNORE INTO links (id, crawl_id, source_url, target_url, is_internal, anchor_text, rel_attr, crawlability, uncrawlable_reason)
    VALUES (@id, @crawlId, @sourceUrl, @targetUrl, @isInternal, @anchorText, @relAttr, @crawlability, @uncrawlableReason)
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
        crawlability: row.crawlability ?? 'crawlable',
        uncrawlableReason: row.uncrawlableReason ?? null,
      });
    }
  });
  insertMany(links);
}

export function getLinksByCrawl(crawlId: string): LinkData[] {
  // Internal link targets were crawled, so backfill their status from the
  // pages table — otherwise broken internal links show no status in the UI
  // (links.status_code is only populated by the external-link checker).
  return db.prepare(`
    SELECT l.id, l.crawl_id as crawlId, l.source_url as sourceUrl, l.target_url as targetUrl,
      l.is_internal as isInternal, l.anchor_text as anchorText, l.rel_attr as relAttr,
      COALESCE(l.status_code, p.status_code) as statusCode,
      l.crawlability, l.uncrawlable_reason as uncrawlableReason
    FROM links l
    LEFT JOIN pages p ON p.crawl_id = l.crawl_id AND p.url = l.target_url
    WHERE l.crawl_id = ?
  `).all(crawlId) as LinkData[];
}

export function updateLinkStatusCodes(crawlId: string, statusMap: Map<string, number>): void {
  const stmt = db.prepare('UPDATE links SET status_code = ? WHERE crawl_id = ? AND target_url = ?');
  const updateMany = db.transaction(() => {
    for (const [url, status] of statusMap) {
      stmt.run(status, crawlId, url);
    }
  });
  updateMany();
}

// ----- Image operations -----

export function insertImages(images: ImageData[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO images (id, crawl_id, page_url, image_url, alt_text, format, has_width, has_height, is_lazy)
    VALUES (@id, @crawlId, @pageUrl, @imageUrl, @altText, @format, @hasWidth, @hasHeight, @isLazy)
  `);
  const insertMany = db.transaction((rows: ImageData[]) => {
    for (const row of rows) {
      stmt.run({
        ...row,
        hasWidth: row.hasWidth ? 1 : 0,
        hasHeight: row.hasHeight ? 1 : 0,
        isLazy: row.isLazy ? 1 : 0,
      });
    }
  });
  insertMany(images);
}

export function getImagesByCrawl(crawlId: string): ImageData[] {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, image_url as imageUrl,
      alt_text as altText, format, has_width as hasWidth, has_height as hasHeight,
      is_lazy as isLazy
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

// ----- Issue Recommendations -----

export function upsertIssueRecommendation(rec: IssueRecommendation): void {
  db.prepare(`
    INSERT OR REPLACE INTO issue_recommendations (crawl_id, issue_type, severity, explanation, fix_suggestions_json, affected_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(rec.crawlId, rec.issueType, rec.severity, rec.explanation, JSON.stringify(rec.fixSuggestions), rec.affectedCount, rec.createdAt);
}

export function getIssueRecommendationsByCrawl(crawlId: string): IssueRecommendation[] {
  const rows = db.prepare(`
    SELECT crawl_id as crawlId, issue_type as issueType, severity, explanation,
      fix_suggestions_json as fixSuggestionsJson, affected_count as affectedCount, created_at as createdAt
    FROM issue_recommendations WHERE crawl_id = ? ORDER BY created_at DESC
  `).all(crawlId) as (Omit<IssueRecommendation, 'fixSuggestions'> & { fixSuggestionsJson: string })[];
  return rows.map(r => ({
    crawlId: r.crawlId,
    issueType: r.issueType,
    severity: r.severity as IssueRecommendation['severity'],
    explanation: r.explanation,
    fixSuggestions: JSON.parse(r.fixSuggestionsJson) as string[],
    affectedCount: r.affectedCount,
    createdAt: r.createdAt,
  }));
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

// ----- Redirect operations -----

export function insertRedirects(redirects: RedirectData[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO redirects (id, crawl_id, source_url, target_url, status_code, hop_number, final_url)
    VALUES (@id, @crawlId, @sourceUrl, @targetUrl, @statusCode, @hopNumber, @finalUrl)
  `);
  const insertMany = db.transaction((rows: RedirectData[]) => {
    for (const row of rows) {
      stmt.run({
        id: row.id,
        crawlId: row.crawlId,
        sourceUrl: row.sourceUrl,
        targetUrl: row.targetUrl,
        statusCode: row.statusCode,
        hopNumber: row.hopNumber,
        finalUrl: row.finalUrl,
      });
    }
  });
  insertMany(redirects);
}

export function getRedirectsByCrawl(crawlId: string): RedirectData[] {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      status_code as statusCode, hop_number as hopNumber, final_url as finalUrl
    FROM redirects WHERE crawl_id = ? ORDER BY source_url, hop_number
  `).all(crawlId) as RedirectData[];
}

// ----- Hreflang operations -----

export function insertHreflang(entries: HreflangData[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO hreflang (id, crawl_id, page_url, hreflang, href)
    VALUES (@id, @crawlId, @pageUrl, @hreflang, @href)
  `);
  const insertMany = db.transaction((rows: HreflangData[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(entries);
}

export function getHreflangByCrawl(crawlId: string): HreflangData[] {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, hreflang, href
    FROM hreflang WHERE crawl_id = ? ORDER BY page_url, hreflang
  `).all(crawlId) as HreflangData[];
}

// ----- Custom extraction operations -----

export function insertCustomExtractions(extractions: CustomExtractionResult[]): void {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO custom_extractions (id, crawl_id, page_url, rule_name, selector, value)
    VALUES (@id, @crawlId, @pageUrl, @ruleName, @selector, @value)
  `);
  const insertMany = db.transaction((rows: CustomExtractionResult[]) => {
    for (const row of rows) {
      stmt.run(row);
    }
  });
  insertMany(extractions);
}

export function getCustomExtractionsByCrawl(crawlId: string): CustomExtractionResult[] {
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, rule_name as ruleName, selector, value
    FROM custom_extractions WHERE crawl_id = ? ORDER BY page_url, rule_name
  `).all(crawlId) as CustomExtractionResult[];
}

// ----- Duplicate content detection -----

export function getDuplicatesByCrawl(crawlId: string): { contentHash: string; urls: string[] }[] {
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

export function calculateLinkScores(crawlId: string): void {
  if (!db) throw new Error('Database not initialised');

  const pages = db.prepare('SELECT url FROM pages WHERE crawl_id = ?').all(crawlId) as { url: string }[];
  if (pages.length === 0) return;

  const pageUrls = new Set(pages.map(p => p.url));

  // Uncrawlable links are excluded: they are not guaranteed to be followed or
  // to pass link signals, so counting them would inflate the target's equity.
  const links = db.prepare(
    "SELECT source_url, target_url FROM links WHERE crawl_id = ? AND is_internal = 1 AND crawlability = 'crawlable'"
  ).all(crawlId) as { source_url: string; target_url: string }[];

  const outlinks = new Map<string, string[]>();
  for (const link of links) {
    if (!pageUrls.has(link.source_url) || !pageUrls.has(link.target_url)) continue;
    if (!outlinks.has(link.source_url)) outlinks.set(link.source_url, []);
    outlinks.get(link.source_url)!.push(link.target_url);
  }

  const d = 0.85;
  const n = pageUrls.size;
  let scores = new Map<string, number>();

  for (const url of pageUrls) scores.set(url, 1 / n);

  for (let iter = 0; iter < 3; iter++) {
    const newScores = new Map<string, number>();
    for (const url of pageUrls) newScores.set(url, (1 - d) / n);

    for (const [sourceUrl, targets] of outlinks) {
      const sourceScore = scores.get(sourceUrl) ?? 0;
      const share = sourceScore / targets.length;
      for (const target of targets) {
        newScores.set(target, (newScores.get(target) ?? 0) + d * share);
      }
    }
    scores = newScores;
  }

  const maxScore = Math.max(...scores.values(), 0.0001);

  const updateStmt = db.prepare('UPDATE pages SET link_score = ? WHERE crawl_id = ? AND url = ?');
  const transaction = db.transaction(() => {
    for (const [url, score] of scores) {
      updateStmt.run(Math.round((score / maxScore) * 100 * 100) / 100, crawlId, url);
    }
  });
  transaction();
}

export function compareCrawls(crawlIdA: string, crawlIdB: string): CrawlDiff[] {
  if (!db) throw new Error('Database not initialised');

  const pagesA = db.prepare('SELECT url, status_code, title, meta_description FROM pages WHERE crawl_id = ?').all(crawlIdA) as { url: string; status_code: number; title: string | null; meta_description: string | null }[];
  const pagesB = db.prepare('SELECT url, status_code, title, meta_description FROM pages WHERE crawl_id = ?').all(crawlIdB) as { url: string; status_code: number; title: string | null; meta_description: string | null }[];

  const mapA = new Map(pagesA.map(p => [p.url, p]));
  const mapB = new Map(pagesB.map(p => [p.url, p]));
  const allUrls = new Set([...mapA.keys(), ...mapB.keys()]);

  const diffs: CrawlDiff[] = [];
  for (const url of allUrls) {
    const a = mapA.get(url);
    const b = mapB.get(url);

    if (!a && b) {
      diffs.push({ url, status: 'added', changes: [] });
    } else if (a && !b) {
      diffs.push({ url, status: 'removed', changes: [] });
    } else if (a && b) {
      const changes: CrawlDiffChange[] = [];
      if (a.status_code !== b.status_code) changes.push({ field: 'statusCode', oldValue: a.status_code, newValue: b.status_code });
      if (a.title !== b.title) changes.push({ field: 'title', oldValue: a.title, newValue: b.title });
      if (a.meta_description !== b.meta_description) changes.push({ field: 'metaDescription', oldValue: a.meta_description, newValue: b.meta_description });
      diffs.push({ url, status: changes.length > 0 ? 'changed' : 'unchanged', changes });
    }
  }
  return diffs;
}

export function upsertGEOScore(score: GEOScore): void {
  if (!db) throw new Error('Database not initialised');
  db.prepare(`
    INSERT INTO geo_scores (page_id, crawl_id, url, overall_score, entity_clarity, answer_readiness, citation_signals, structured_data_completeness, issues_json, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET
      overall_score = excluded.overall_score,
      entity_clarity = excluded.entity_clarity,
      answer_readiness = excluded.answer_readiness,
      citation_signals = excluded.citation_signals,
      structured_data_completeness = excluded.structured_data_completeness,
      issues_json = excluded.issues_json,
      analyzed_at = excluded.analyzed_at
  `).run(
    score.pageId, score.crawlId, score.url,
    score.overallScore, score.entityClarity, score.answerReadiness,
    score.citationSignals, score.structuredDataCompleteness,
    JSON.stringify(score.issues), score.analyzedAt
  );
}

export function upsertGEOScoresBatch(scores: GEOScore[]): void {
  if (!db) throw new Error('Database not initialised');
  const insertMany = db.transaction((rows: GEOScore[]) => {
    for (const score of rows) {
      upsertGEOScore(score);
    }
  });
  insertMany(scores);
}

export function getGEOScoresByCrawl(crawlId: string): GEOScore[] {
  if (!db) throw new Error('Database not initialised');
  const rows = db.prepare('SELECT * FROM geo_scores WHERE crawl_id = ?').all(crawlId) as Record<string, unknown>[];
  return rows.map(r => ({
    pageId: r.page_id as string,
    crawlId: r.crawl_id as string,
    url: r.url as string,
    overallScore: r.overall_score as number,
    entityClarity: r.entity_clarity as number,
    answerReadiness: r.answer_readiness as number,
    citationSignals: r.citation_signals as number,
    structuredDataCompleteness: r.structured_data_completeness as number,
    issues: JSON.parse((r.issues_json as string) || '[]'),
    analyzedAt: r.analyzed_at as string,
  }));
}

export function upsertPerformanceScore(score: PerformanceScore): void {
  if (!db) throw new Error('Database not initialised');
  db.prepare(`
    INSERT INTO performance_scores (page_id, crawl_id, url, overall_score, ttfb_score, page_size_score, image_opt_score, content_efficiency, ttfb_ms, total_bytes, image_bytes, issues_json, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET
      overall_score = excluded.overall_score,
      ttfb_score = excluded.ttfb_score,
      page_size_score = excluded.page_size_score,
      image_opt_score = excluded.image_opt_score,
      content_efficiency = excluded.content_efficiency,
      ttfb_ms = excluded.ttfb_ms,
      total_bytes = excluded.total_bytes,
      image_bytes = excluded.image_bytes,
      issues_json = excluded.issues_json,
      analyzed_at = excluded.analyzed_at
  `).run(
    score.pageId, score.crawlId, score.url,
    score.overallScore, score.ttfbScore, score.pageSizeScore,
    score.imageOptScore, score.contentEfficiency,
    score.ttfbMs, score.totalBytes, score.imageBytes,
    JSON.stringify(score.issues), score.analyzedAt
  );
}

export function upsertPerformanceScoresBatch(scores: PerformanceScore[]): void {
  if (!db) throw new Error('Database not initialised');
  const insertMany = db.transaction((rows: PerformanceScore[]) => {
    for (const score of rows) {
      upsertPerformanceScore(score);
    }
  });
  insertMany(scores);
}

export function getPerformanceScoresByCrawl(crawlId: string): PerformanceScore[] {
  if (!db) throw new Error('Database not initialised');
  const rows = db.prepare('SELECT * FROM performance_scores WHERE crawl_id = ?').all(crawlId) as Record<string, unknown>[];
  return rows.map(r => ({
    pageId: r.page_id as string,
    crawlId: r.crawl_id as string,
    url: r.url as string,
    overallScore: r.overall_score as number,
    ttfbScore: r.ttfb_score as number,
    pageSizeScore: r.page_size_score as number,
    imageOptScore: r.image_opt_score as number,
    contentEfficiency: r.content_efficiency as number,
    ttfbMs: r.ttfb_ms as number,
    totalBytes: r.total_bytes as number,
    imageBytes: r.image_bytes as number,
    issues: JSON.parse((r.issues_json as string) || '[]'),
    analyzedAt: r.analyzed_at as string,
  }));
}

// ── Targeted export queries ──

export function getInlinksForUrls(crawlId: string, targetUrls: string[]): LinkData[] {
  if (!db || targetUrls.length === 0) return [];
  const placeholders = targetUrls.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      is_internal as isInternal, anchor_text as anchorText, rel_attr as relAttr
    FROM links WHERE crawl_id = ? AND target_url IN (${placeholders})
  `).all(crawlId, ...targetUrls) as LinkData[];
}

export function getOutlinksForUrls(crawlId: string, sourceUrls: string[]): LinkData[] {
  if (!db || sourceUrls.length === 0) return [];
  const placeholders = sourceUrls.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      is_internal as isInternal, anchor_text as anchorText, rel_attr as relAttr
    FROM links WHERE crawl_id = ? AND source_url IN (${placeholders})
  `).all(crawlId, ...sourceUrls) as LinkData[];
}

export function getImagesForUrls(crawlId: string, pageUrls: string[]): ImageData[] {
  if (!db || pageUrls.length === 0) return [];
  const placeholders = pageUrls.map(() => '?').join(',');
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, image_url as imageUrl,
      alt_text as altText, format, has_width as hasWidth, has_height as hasHeight,
      is_lazy as isLazy
    FROM images WHERE crawl_id = ? AND page_url IN (${placeholders})
  `).all(crawlId, ...pageUrls) as ImageData[];
}

export function getInlinksToStatusCode(crawlId: string, statusMin: number, statusMax: number): LinkData[] {
  if (!db) return [];
  return db.prepare(`
    SELECT l.id, l.crawl_id as crawlId, l.source_url as sourceUrl, l.target_url as targetUrl,
      l.is_internal as isInternal, l.anchor_text as anchorText, l.rel_attr as relAttr
    FROM links l
    INNER JOIN pages p ON l.crawl_id = p.crawl_id AND l.target_url = p.url
    WHERE l.crawl_id = ? AND p.status_code >= ? AND p.status_code < ?
  `).all(crawlId, statusMin, statusMax) as LinkData[];
}

export function getPagesByStatusRange(crawlId: string, statusMin: number, statusMax: number): PageData[] {
  if (!db) return [];
  return db.prepare(`
    SELECT id, crawl_id as crawlId, url, status_code as statusCode, content_type as contentType,
      title, title_length as titleLength, title_pixel_width as titlePixelWidth,
      meta_description as metaDescription, meta_desc_length as metaDescLength,
      meta_desc_pixel_width as metaDescPixelWidth, h1, h2,
      word_count as wordCount, canonical_url as canonicalUrl,
      is_canonicalized as isCanonicalized, is_indexable as isIndexable,
      response_time_ms as responseTimeMs, page_size_bytes as pageSizeBytes,
      crawl_depth as crawlDepth, cost_usd as costUsd, created_at as createdAt,
      content_hash as contentHash,
      h1_length as h1Length, h2_length as h2Length,
      h1_count as h1Count, h2_count as h2Count,
      robots_directives as robotsDirectives, meta_keywords as metaKeywords,
      text_ratio as textRatio,
      og_title as ogTitle, og_description as ogDescription,
      og_image as ogImage, og_type as ogType,
      twitter_card as twitterCard, twitter_title as twitterTitle,
      twitter_description as twitterDescription, twitter_image as twitterImage,
      schema_types as schemaTypes, schema_json as schemaJson,
      schema_errors as schemaErrors, has_structured_data as hasStructuredData,
      has_hsts as hasHSTS, has_csp as hasCSP,
      x_frame_options as xFrameOptions, x_content_type_options as xContentTypeOptions,
      image_count as imageCount, link_score as linkScore, simhash
    FROM pages WHERE crawl_id = ? AND status_code >= ? AND status_code < ?
    ORDER BY created_at ASC
  `).all(crawlId, statusMin, statusMax) as PageData[];
}

export function getNonIndexablePages(crawlId: string): PageData[] {
  if (!db) return [];
  return db.prepare(`
    SELECT id, crawl_id as crawlId, url, status_code as statusCode, content_type as contentType,
      title, title_length as titleLength, title_pixel_width as titlePixelWidth,
      meta_description as metaDescription, meta_desc_length as metaDescLength,
      meta_desc_pixel_width as metaDescPixelWidth, h1, h2,
      word_count as wordCount, canonical_url as canonicalUrl,
      is_canonicalized as isCanonicalized, is_indexable as isIndexable,
      response_time_ms as responseTimeMs, page_size_bytes as pageSizeBytes,
      crawl_depth as crawlDepth, cost_usd as costUsd, created_at as createdAt,
      content_hash as contentHash,
      h1_length as h1Length, h2_length as h2Length,
      h1_count as h1Count, h2_count as h2Count,
      robots_directives as robotsDirectives, meta_keywords as metaKeywords,
      text_ratio as textRatio,
      og_title as ogTitle, og_description as ogDescription,
      og_image as ogImage, og_type as ogType,
      twitter_card as twitterCard, twitter_title as twitterTitle,
      twitter_description as twitterDescription, twitter_image as twitterImage,
      schema_types as schemaTypes, schema_json as schemaJson,
      schema_errors as schemaErrors, has_structured_data as hasStructuredData,
      has_hsts as hasHSTS, has_csp as hasCSP,
      x_frame_options as xFrameOptions, x_content_type_options as xContentTypeOptions,
      image_count as imageCount, link_score as linkScore, simhash
    FROM pages WHERE crawl_id = ? AND is_indexable = 0
    ORDER BY created_at ASC
  `).all(crawlId) as PageData[];
}

export function getImagesMissingAlt(crawlId: string): ImageData[] {
  if (!db) return [];
  return db.prepare(`
    SELECT id, crawl_id as crawlId, page_url as pageUrl, image_url as imageUrl,
      alt_text as altText, format, has_width as hasWidth, has_height as hasHeight,
      is_lazy as isLazy
    FROM images WHERE crawl_id = ? AND (alt_text IS NULL OR alt_text = '')
  `).all(crawlId) as ImageData[];
}

export function getInternalLinks(crawlId: string): LinkData[] {
  if (!db) return [];
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      is_internal as isInternal, anchor_text as anchorText, rel_attr as relAttr
    FROM links WHERE crawl_id = ? AND is_internal = 1
  `).all(crawlId) as LinkData[];
}

export function getExternalLinks(crawlId: string): LinkData[] {
  if (!db) return [];
  return db.prepare(`
    SELECT id, crawl_id as crawlId, source_url as sourceUrl, target_url as targetUrl,
      is_internal as isInternal, anchor_text as anchorText, rel_attr as relAttr
    FROM links WHERE crawl_id = ? AND is_internal = 0
  `).all(crawlId) as LinkData[];
}

// ----- PageSpeed Insights / CWV scores -----

export function upsertPsiScoresBatch(scores: PsiScore[]): void {
  const stmt = db.prepare(`
    INSERT INTO psi_scores (page_id, crawl_id, url, strategy, performance_score, lcp_ms, cls_value, tbt_ms, fcp_ms, speed_index_ms, field_lcp_ms, field_inp_ms, field_cls, field_overall_category, fetched_at)
    VALUES (@pageId, @crawlId, @url, @strategy, @performanceScore, @lcpMs, @clsValue, @tbtMs, @fcpMs, @speedIndexMs, @fieldLcpMs, @fieldInpMs, @fieldCls, @fieldOverallCategory, @fetchedAt)
    ON CONFLICT(page_id, strategy) DO UPDATE SET
      performance_score = excluded.performance_score,
      lcp_ms = excluded.lcp_ms,
      cls_value = excluded.cls_value,
      tbt_ms = excluded.tbt_ms,
      fcp_ms = excluded.fcp_ms,
      speed_index_ms = excluded.speed_index_ms,
      field_lcp_ms = excluded.field_lcp_ms,
      field_inp_ms = excluded.field_inp_ms,
      field_cls = excluded.field_cls,
      field_overall_category = excluded.field_overall_category,
      fetched_at = excluded.fetched_at
  `);
  const insertMany = db.transaction((rows: PsiScore[]) => {
    for (const row of rows) stmt.run(row as unknown as Record<string, unknown>);
  });
  insertMany(scores);
}

export function getPsiScoresByCrawl(crawlId: string): PsiScore[] {
  return db.prepare(`
    SELECT page_id as pageId, crawl_id as crawlId, url, strategy,
      performance_score as performanceScore, lcp_ms as lcpMs, cls_value as clsValue,
      tbt_ms as tbtMs, fcp_ms as fcpMs, speed_index_ms as speedIndexMs,
      field_lcp_ms as fieldLcpMs, field_inp_ms as fieldInpMs, field_cls as fieldCls,
      field_overall_category as fieldOverallCategory, fetched_at as fetchedAt
    FROM psi_scores WHERE crawl_id = ? ORDER BY performance_score ASC
  `).all(crawlId) as PsiScore[];
}

// ----- Scheduled crawls -----

const SCHEDULE_SELECT = `
  SELECT id, name, start_url as startUrl, interval_hours as intervalHours,
    enabled, last_run as lastRun, next_run as nextRun,
    config_json as configJson, created_at as createdAt,
    auto_compare as autoCompare, last_diff_json as lastDiffJson
  FROM schedules`;

function toSchedule(row: Record<string, unknown>): CrawlSchedule {
  return {
    ...(row as unknown as CrawlSchedule),
    enabled: !!row.enabled,
    autoCompare: !!row.autoCompare,
  };
}

export function getSchedule(id: string): CrawlSchedule | undefined {
  const row = db.prepare(SCHEDULE_SELECT + ' WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? toSchedule(row) : undefined;
}

/** Tag a crawl as belonging to a schedule, so later runs can be diffed against it. */
export function setCrawlSchedule(crawlId: string, scheduleId: string): void {
  db.prepare('UPDATE crawls SET schedule_id = ? WHERE id = ?').run(scheduleId, crawlId);
}

/**
 * The most recent completed crawl from the same schedule, excluding the one
 * that just finished. This is the baseline an auto-compare diffs against.
 */
export function getPreviousScheduleCrawl(scheduleId: string, excludeCrawlId: string): CrawlRecord | undefined {
  const row = db.prepare(
    CRAWL_SELECT + ` WHERE schedule_id = ? AND id != ? AND status = 'completed'
      ORDER BY start_time DESC LIMIT 1`
  ).get(scheduleId, excludeCrawlId) as Record<string, unknown> | undefined;
  return row ? toCrawlRecord(row) : undefined;
}

export function setScheduleLastDiff(id: string, lastDiffJson: string | null): void {
  db.prepare('UPDATE schedules SET last_diff_json = ? WHERE id = ?').run(lastDiffJson, id);
}

export function listSchedules(): CrawlSchedule[] {
  const rows = db.prepare(SCHEDULE_SELECT + ' ORDER BY created_at ASC').all() as Record<string, unknown>[];
  return rows.map(toSchedule);
}

export function insertSchedule(s: CrawlSchedule): void {
  db.prepare(`
    INSERT INTO schedules (id, name, start_url, interval_hours, enabled, last_run, next_run, config_json, created_at, auto_compare)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(s.id, s.name, s.startUrl, s.intervalHours, s.enabled ? 1 : 0, s.lastRun, s.nextRun, s.configJson, s.createdAt, s.autoCompare ? 1 : 0);
}

export function deleteSchedule(id: string): void {
  db.prepare('DELETE FROM schedules WHERE id = ?').run(id);
}

export function setScheduleEnabled(id: string, enabled: boolean): void {
  db.prepare('UPDATE schedules SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function markScheduleRun(id: string, lastRun: string, nextRun: string): void {
  db.prepare('UPDATE schedules SET last_run = ?, next_run = ? WHERE id = ?').run(lastRun, nextRun, id);
}

export function getDueSchedules(nowIso: string): CrawlSchedule[] {
  const rows = db.prepare(SCHEDULE_SELECT + ' WHERE enabled = 1 AND next_run <= ? ORDER BY next_run ASC')
    .all(nowIso) as Record<string, unknown>[];
  return rows.map(toSchedule);
}

export function closeDatabase(): void {
  if (db) db.close();
}
