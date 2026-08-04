/**
 * Retention deletes user data, so these run against the real database module
 * (in-memory) rather than an inlined schema — the migrations, the cascade and
 * the actual SQL predicate all have to hold.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  getDb,
  insertCrawl,
  getAllCrawls,
  setCrawlLocked,
  deleteCrawl,
  purgeCrawlsOlderThan,
} from '../main/database';
import type { CrawlRecord, CrawlStatus } from '../types/index';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-04T12:00:00.000Z');

function crawl(id: string, ageDays: number, status: CrawlStatus = 'completed'): CrawlRecord {
  return {
    id,
    mode: 'local',
    startUrl: `https://example.com/${id}`,
    startTime: new Date(NOW - ageDays * DAY).toISOString(),
    endTime: new Date(NOW - ageDays * DAY + 1000).toISOString(),
    status,
    configJson: '{}',
    totalUrls: 1,
    completedUrls: 1,
    totalSpendUsd: 0,
    locked: false,
  };
}

describe('crawl retention', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('does nothing when retention is off (0 days)', () => {
    insertCrawl(crawl('old', 400));
    expect(purgeCrawlsOlderThan(0, NOW)).toEqual([]);
    expect(getAllCrawls()).toHaveLength(1);
  });

  it('treats negative and non-finite values as off', () => {
    insertCrawl(crawl('old', 400));
    expect(purgeCrawlsOlderThan(-30, NOW)).toEqual([]);
    expect(purgeCrawlsOlderThan(Number.NaN, NOW)).toEqual([]);
    expect(getAllCrawls()).toHaveLength(1);
  });

  it('deletes crawls older than the cutoff and keeps newer ones', () => {
    insertCrawl(crawl('older', 45));
    insertCrawl(crawl('newer', 10));
    const deleted = purgeCrawlsOlderThan(30, NOW);
    expect(deleted).toEqual(['older']);
    expect(getAllCrawls().map(c => c.id)).toEqual(['newer']);
  });

  it('never deletes a locked crawl', () => {
    insertCrawl(crawl('locked-old', 400));
    setCrawlLocked('locked-old', true);
    expect(purgeCrawlsOlderThan(30, NOW)).toEqual([]);
    expect(getAllCrawls()).toHaveLength(1);
    expect(getAllCrawls()[0].locked).toBe(true);
  });

  it('never deletes running or paused crawls, however old', () => {
    insertCrawl(crawl('running', 400, 'running'));
    insertCrawl(crawl('paused', 400, 'paused'));
    expect(purgeCrawlsOlderThan(30, NOW)).toEqual([]);
    expect(getAllCrawls()).toHaveLength(2);
  });

  it('unlocking makes a crawl eligible again', () => {
    insertCrawl(crawl('c1', 400));
    setCrawlLocked('c1', true);
    expect(purgeCrawlsOlderThan(30, NOW)).toEqual([]);
    setCrawlLocked('c1', false);
    expect(purgeCrawlsOlderThan(30, NOW)).toEqual(['c1']);
    expect(getAllCrawls()).toHaveLength(0);
  });

  it('cascades to child rows so no orphans are left behind', () => {
    insertCrawl(crawl('c1', 400));
    const db = getDb();
    db.prepare(
      "INSERT INTO pages (id, crawl_id, url, status_code) VALUES ('p1', 'c1', 'https://example.com/a', 200)"
    ).run();
    db.prepare(
      "INSERT INTO links (id, crawl_id, source_url, target_url, is_internal) VALUES ('l1', 'c1', 'https://example.com/a', 'https://example.com/b', 1)"
    ).run();

    purgeCrawlsOlderThan(30, NOW);

    expect(db.prepare('SELECT COUNT(*) c FROM pages').get()).toEqual({ c: 0 });
    expect(db.prepare('SELECT COUNT(*) c FROM links').get()).toEqual({ c: 0 });
  });

  it('deleteCrawl removes one crawl regardless of age or status', () => {
    insertCrawl(crawl('keep', 1));
    insertCrawl(crawl('drop', 1, 'running'));
    deleteCrawl('drop');
    expect(getAllCrawls().map(c => c.id)).toEqual(['keep']);
  });

  it('returns locked as a boolean, not a SQLite 0/1', () => {
    insertCrawl(crawl('c1', 1));
    expect(getAllCrawls()[0].locked).toBe(false);
    setCrawlLocked('c1', true);
    expect(getAllCrawls()[0].locked).toBe(true);
  });
});
