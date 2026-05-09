import Database from 'better-sqlite3';
import path from 'path';
import crypto from 'crypto';
import os from 'os';

export const FREE_TIER_LIMIT = 1000;
export const FREE_TIER_WARN = 800;

let db: Database.Database | null = null;

function getMachineFingerprint(): string {
  const raw = [
    os.hostname(),
    os.userInfo().username,
    process.env.COMPUTERNAME ?? '',
    process.env.USERNAME ?? '',
  ].join('::');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export function initCrawlCounter(appDataPath: string): void {
  const dbPath = path.join(appDataPath, 'crawl-stats.db');
  db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS stats (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const fp = getMachineFingerprint();
  const stored = db.prepare('SELECT value FROM stats WHERE key = ?').get('fingerprint') as { value: string } | undefined;
  if (!stored) {
    db.prepare('INSERT INTO stats (key, value) VALUES (?, ?)').run('fingerprint', fp);
  }

  const total = db.prepare('SELECT value FROM stats WHERE key = ?').get('total_crawled') as { value: string } | undefined;
  if (!total) {
    db.prepare('INSERT INTO stats (key, value) VALUES (?, ?)').run('total_crawled', '0');
  }
}

export function addCrawledUrls(count: number): void {
  if (!db || count <= 0) return;
  const current = db.prepare('SELECT value FROM stats WHERE key = ?').get('total_crawled') as { value: string } | undefined;
  const newTotal = parseInt(current?.value ?? '0', 10) + count;
  db.prepare('UPDATE stats SET value = ? WHERE key = ?').run(String(newTotal), 'total_crawled');
}

export function getTotalCrawled(): number {
  if (!db) return 0;
  const row = db.prepare('SELECT value FROM stats WHERE key = ?').get('total_crawled') as { value: string } | undefined;
  return parseInt(row?.value ?? '0', 10);
}

export function getCrawlUsage(): { totalCrawled: number; remaining: number; atWarning: boolean; atLimit: boolean } {
  const totalCrawled = getTotalCrawled();
  return {
    totalCrawled,
    remaining: Math.max(0, FREE_TIER_LIMIT - totalCrawled),
    atWarning: totalCrawled >= FREE_TIER_WARN,
    atLimit: totalCrawled >= FREE_TIER_LIMIT,
  };
}
