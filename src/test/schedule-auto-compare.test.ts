/**
 * Auto-compare depends on crawls being correctly tagged with the schedule that
 * started them, and on picking the right baseline to diff against. Both are
 * exercised here against the real database module.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDatabase,
  insertCrawl,
  insertSchedule,
  getSchedule,
  listSchedules,
  setCrawlSchedule,
  getPreviousScheduleCrawl,
  setScheduleLastDiff,
  updateCrawlStatus,
} from '../main/database';
import type { CrawlRecord, CrawlSchedule, CrawlStatus } from '../types/index';

const NOW = Date.parse('2026-08-04T12:00:00.000Z');
const MIN = 60 * 1000;

function crawl(id: string, minutesAgo: number, status: CrawlStatus = 'completed'): CrawlRecord {
  return {
    id,
    mode: 'local',
    startUrl: 'https://example.com/',
    startTime: new Date(NOW - minutesAgo * MIN).toISOString(),
    endTime: new Date(NOW - minutesAgo * MIN + 1000).toISOString(),
    status,
    configJson: '{}',
    totalUrls: 1,
    completedUrls: 1,
    totalSpendUsd: 0,
    locked: false,
  };
}

function schedule(id: string, autoCompare: boolean): CrawlSchedule {
  return {
    id,
    name: `sched-${id}`,
    startUrl: 'https://example.com/',
    intervalHours: 24,
    enabled: true,
    lastRun: null,
    nextRun: new Date(NOW + 3600_000).toISOString(),
    configJson: '{}',
    createdAt: new Date(NOW).toISOString(),
    autoCompare,
    lastDiffJson: null,
  };
}

describe('scheduled crawl auto-compare', () => {
  beforeEach(() => {
    initDatabase(':memory:');
  });

  it('round-trips the autoCompare flag as a boolean', () => {
    insertSchedule(schedule('s1', true));
    insertSchedule(schedule('s2', false));
    expect(getSchedule('s1')?.autoCompare).toBe(true);
    expect(getSchedule('s2')?.autoCompare).toBe(false);
    expect(listSchedules().map(s => s.autoCompare)).toEqual([true, false]);
  });

  it('tags a crawl with its schedule', () => {
    insertSchedule(schedule('s1', true));
    insertCrawl(crawl('c1', 10));
    setCrawlSchedule('c1', 's1');
    expect(getPreviousScheduleCrawl('s1', 'never-matches')?.id).toBe('c1');
  });

  it('has no baseline on the first run', () => {
    insertSchedule(schedule('s1', true));
    insertCrawl(crawl('c1', 0));
    setCrawlSchedule('c1', 's1');
    expect(getPreviousScheduleCrawl('s1', 'c1')).toBeUndefined();
  });

  it('picks the most recent previous crawl from the same schedule', () => {
    insertSchedule(schedule('s1', true));
    for (const [id, ago] of [['oldest', 300], ['middle', 200], ['newest', 100], ['current', 0]] as const) {
      insertCrawl(crawl(id, ago));
      setCrawlSchedule(id, 's1');
    }
    expect(getPreviousScheduleCrawl('s1', 'current')?.id).toBe('newest');
  });

  it('never crosses schedules', () => {
    insertSchedule(schedule('s1', true));
    insertSchedule(schedule('s2', true));
    insertCrawl(crawl('a1', 100));
    setCrawlSchedule('a1', 's1');
    insertCrawl(crawl('b1', 50));
    setCrawlSchedule('b1', 's2');
    insertCrawl(crawl('b2', 0));
    setCrawlSchedule('b2', 's2');

    expect(getPreviousScheduleCrawl('s2', 'b2')?.id).toBe('b1');
    expect(getPreviousScheduleCrawl('s1', 'a1')).toBeUndefined();
  });

  it('ignores manual crawls that have no schedule', () => {
    insertSchedule(schedule('s1', true));
    insertCrawl(crawl('manual', 100)); // never tagged
    insertCrawl(crawl('c1', 0));
    setCrawlSchedule('c1', 's1');
    expect(getPreviousScheduleCrawl('s1', 'c1')).toBeUndefined();
  });

  it('ignores an unfinished previous run as a baseline', () => {
    insertSchedule(schedule('s1', true));
    insertCrawl(crawl('stopped', 100, 'error'));
    setCrawlSchedule('stopped', 's1');
    insertCrawl(crawl('c1', 0));
    setCrawlSchedule('c1', 's1');
    expect(getPreviousScheduleCrawl('s1', 'c1')).toBeUndefined();

    // ...but once that run is marked completed it becomes the baseline.
    updateCrawlStatus('stopped', 'completed', 1, 1, 0, new Date(NOW).toISOString());
    expect(getPreviousScheduleCrawl('s1', 'c1')?.id).toBe('stopped');
  });

  it('stores and clears the last diff summary', () => {
    insertSchedule(schedule('s1', true));
    setScheduleLastDiff('s1', JSON.stringify({ added: 3, removed: 1, changed: 5 }));
    expect(JSON.parse(getSchedule('s1')!.lastDiffJson!)).toMatchObject({ added: 3, removed: 1, changed: 5 });
    setScheduleLastDiff('s1', null);
    expect(getSchedule('s1')!.lastDiffJson).toBeNull();
  });

  it('exposes scheduleId on the crawl record', () => {
    insertSchedule(schedule('s1', true));
    insertCrawl(crawl('c1', 10));
    setCrawlSchedule('c1', 's1');
    expect(getPreviousScheduleCrawl('s1', 'x')?.scheduleId).toBe('s1');
  });
});
