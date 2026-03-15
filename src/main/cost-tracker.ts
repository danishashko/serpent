import { getDb } from './database';
import { v4 as uuidv4 } from 'uuid';

// Bright Data Web Unlocker CPM pricing: $1 per 1,000 requests
const COST_PER_REQUEST_USD = 0.001;

// Hard stop threshold — pause crawl at this percentage of limit
const HARD_STOP_RATIO = 0.95;

export class CostTracker {
  private crawlId: string;
  private maxCostPerCrawl: number;
  private maxCostPerDay: number;
  private crawlSpend = 0;

  constructor(crawlId: string, maxCostPerCrawl: number, maxCostPerDay: number) {
    this.crawlId = crawlId;
    this.maxCostPerCrawl = maxCostPerCrawl;
    this.maxCostPerDay = maxCostPerDay;
  }

  /** Cost of one BD Web Unlocker request (CPM model) */
  static costPerRequest(): number {
    return COST_PER_REQUEST_USD;
  }

  /** Record a request and return the cost */
  recordRequest(bytesDownloaded: number): number {
    const cost = COST_PER_REQUEST_USD;
    this.crawlSpend += cost;

    const db = getDb();
    db.prepare(
      `INSERT INTO usage_logs (id, timestamp, engine_type, urls_crawled, bytes_downloaded, cost_usd)
       VALUES (?, datetime('now'), 'brightdata', 1, ?, ?)`
    ).run(uuidv4(), bytesDownloaded, cost);

    return cost;
  }

  /** Check if crawl should be paused due to cost limits */
  shouldPause(): { pause: boolean; reason?: string } {
    // Per-crawl limit
    if (this.crawlSpend >= this.maxCostPerCrawl * HARD_STOP_RATIO) {
      return {
        pause: true,
        reason: `Crawl spend $${this.crawlSpend.toFixed(4)} reached ${Math.round(HARD_STOP_RATIO * 100)}% of $${this.maxCostPerCrawl.toFixed(2)} limit`,
      };
    }

    // Daily limit
    const dailySpend = this.getDailySpend();
    if (dailySpend >= this.maxCostPerDay * HARD_STOP_RATIO) {
      return {
        pause: true,
        reason: `Daily spend $${dailySpend.toFixed(4)} reached ${Math.round(HARD_STOP_RATIO * 100)}% of $${this.maxCostPerDay.toFixed(2)} daily limit`,
      };
    }

    return { pause: false };
  }

  /** Get today's total BD spend */
  getDailySpend(): number {
    const db = getDb();
    const row = db.prepare(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM usage_logs
       WHERE engine_type = 'brightdata' AND date(timestamp) = date('now')`
    ).get() as { total: number };
    return row.total;
  }

  /** Get current crawl spend */
  getCrawlSpend(): number {
    return this.crawlSpend;
  }

  /** Set crawl spend (for resume) */
  setCrawlSpend(amount: number): void {
    this.crawlSpend = amount;
  }
}
