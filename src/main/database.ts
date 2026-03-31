import Database from 'better-sqlite3';
import path from 'path';
import { app } from 'electron';
import { PageData, LinkData, ImageData, RedirectData, HreflangData, CustomExtractionResult, CrawlRecord, AIAnalysis, IssueRecommendation, UsageLog, CrawlDiff, CrawlDiffChange } from '../types/index';

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
      response_time_ms, page_size_bytes, crawl_depth, cost_usd, created_at, content_hash,
      h1_length, h2_length, h1_count, h2_count, robots_directives, meta_keywords, text_ratio,
      og_title, og_description, og_image, og_type,
      twitter_card, twitter_title, twitter_description, twitter_image,
      schema_types, schema_json, schema_errors, has_structured_data,
      has_hsts, has_csp, x_frame_options, x_content_type_options, image_count, link_score
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
      @hasHSTS, @hasCSP, @xFrameOptions, @xContentTypeOptions, @imageCount, @linkScore
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
      image_count as imageCount, link_score as linkScore
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

  const links = db.prepare(
    'SELECT source_url, target_url FROM links WHERE crawl_id = ? AND is_internal = 1'
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

export function closeDatabase(): void {
  if (db) db.close();
}
