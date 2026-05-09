import PQueue from 'p-queue';
import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';
import axios from 'axios';
import {
  CrawlConfig,
  CrawlProgress,
  CrawlStatus,
  CrawlRecord,
  RedirectData,
  HreflangData,
  CustomExtractionResult,
} from '../types/index';
import { crawlPageLocal } from './crawler-local';
import { crawlPageBrightData } from './crawler-brightdata';
import { CostTracker } from './cost-tracker';
import {
  insertCrawl,
  insertPage,
  insertLinks,
  insertImages,
  insertRedirects,
  insertHreflang,
  insertCustomExtractions,
  updateCrawlStatus,
  pageExists,
  getCrawledUrls,
  getLatestIncompleteCrawl,
} from './database';
import { parseRobotsTxt, checkPath, type RobotsRuleSet } from './robots-tester';

// ─── Robots.txt enforcement (delegated to robots-tester.ts) ────────────────────
// Re-exported here so existing callers (and tests) keep working.
export { parseRobotsTxt, checkPath } from './robots-tester';
export type { RobotsRuleSet } from './robots-tester';

export class CrawlOrchestrator extends EventEmitter {
  private queue: PQueue | null = null;
  private crawlId: string = '';
  private visited = new Set<string>();
  private pending = new Set<string>();
  private status: CrawlStatus = 'idle';
  private config: CrawlConfig | null = null;
  private baseOrigin: string = '';
  private completedCount = 0;
  private totalQueued = 0;
  private totalSpend = 0;
  private responseTimes: number[] = [];
  private startTime = 0;
  private apiKey: string | null = null;
  private bdZone: string = 'web_unlocker1';
  private robotsRules: RobotsRuleSet | null = null;
  private robotsUserAgent: string = 'Serpent';

  private async loadRobots(origin: string, customBody: string | undefined): Promise<void> {
    // Custom robots.txt overrides any HTTP fetch (used by tests + advanced mode).
    if (typeof customBody === 'string' && customBody.length > 0) {
      this.robotsRules = parseRobotsTxt(customBody, this.robotsUserAgent);
      return;
    }
    try {
      const response = await axios.get(`${origin}/robots.txt`, {
        timeout: 10000,
        validateStatus: (s) => s < 500,
      });
      if (response.status === 200 && typeof response.data === 'string') {
        this.robotsRules = parseRobotsTxt(response.data, this.robotsUserAgent);
      } else {
        this.robotsRules = { agent: '*', rules: [] }; // No robots.txt = all allowed
      }
    } catch {
      this.robotsRules = { agent: '*', rules: [] }; // Fetch failed = all allowed
    }
  }

  async startCrawl(config: CrawlConfig, apiKey?: string, bdZone?: string): Promise<string> {
    if (this.status === 'running') {
      // Only refuse if there's actual work in flight. If the in-memory state got stuck
      // (e.g. a previous resume that never reached idle), reset and proceed.
      const hasInFlightWork =
        this.queue !== null && (this.queue.size > 0 || this.queue.pending > 0);
      if (hasInFlightWork) {
        throw new Error('A crawl is already running. Stop it before starting a new one.');
      }
      console.warn('[ORCHESTRATOR] status was "running" but queue is empty — resetting stale state');
      if (this.queue) {
        this.queue.clear();
        this.queue = null;
      }
      this.status = 'idle';
    }

    const id = uuidv4();
    this.crawlId = id;
    this.config = config;
    this.visited.clear();
    this.pending.clear();
    this.status = 'running';
    this.completedCount = 0;
    this.totalQueued = 0;
    this.totalSpend = 0;
    this.responseTimes = [];
    this.startTime = Date.now();
    this.apiKey = apiKey || null;
    this.bdZone = bdZone || 'web_unlocker1';

    const baseUrl = new URL(config.startUrl);
    this.baseOrigin = baseUrl.origin;
    this.robotsRules = null;
    this.robotsUserAgent = config.robotsUserAgent && config.robotsUserAgent.trim() ? config.robotsUserAgent.trim() : 'Serpent';

    if (config.respectRobots) {
      await this.loadRobots(this.baseOrigin, config.customRobotsTxt);
    }

    const crawlRecord: CrawlRecord = {
      id: id,
      mode: config.engine,
      startUrl: config.startUrl,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'running',
      configJson: JSON.stringify(config),
      totalUrls: 0,
      completedUrls: 0,
      totalSpendUsd: 0,
    };

    insertCrawl(crawlRecord);

    const concurrency = config.engine === 'local' ? (config.concurrency || 5) : 20;
    this.queue = new PQueue({ concurrency, autoStart: true });

    if (config.mode === 'spider') {
      this.enqueueUrl(config.startUrl, 0);
    } else {
      // List mode: startUrl contains newline-separated URLs
      const urls = config.startUrl
        .split('\n')
        .map(u => u.trim())
        .filter(u => u.length > 0);
      for (const u of urls) {
        this.enqueueUrl(u, 0);
      }
    }

    this.queue.on('idle', () => {
      if (this.status === 'running') {
        this.status = 'completed';
        updateCrawlStatus(
          this.crawlId,
          'completed',
          this.totalQueued,
          this.completedCount,
          this.totalSpend,
          new Date().toISOString()
        );
        this.emitProgress();
        this.emit('complete', this.crawlId);
      }
    });

    return this.crawlId;
  }

  pause(): void {
    if (this.queue && this.status === 'running') {
      this.queue.pause();
      this.status = 'paused';
      updateCrawlStatus(this.crawlId, 'paused', this.totalQueued, this.completedCount, this.totalSpend);
      this.emitProgress();
    }
  }

  resume(): void {
    if (this.queue && this.status === 'paused') {
      this.status = 'running';
      this.queue.start();
      updateCrawlStatus(this.crawlId, 'running', this.totalQueued, this.completedCount, this.totalSpend);
      this.emitProgress();
    }
  }

  stop(): void {
    if (this.queue) {
      this.queue.clear();
      this.queue.pause();
    }
    this.status = 'completed';
    updateCrawlStatus(
      this.crawlId,
      'completed',
      this.totalQueued,
      this.completedCount,
      this.totalSpend,
      new Date().toISOString()
    );
    this.emitProgress();
    this.emit('complete', this.crawlId);
  }

  getStatus(): CrawlStatus {
    return this.status;
  }

  getCrawlId(): string {
    return this.crawlId;
  }

  getCompletedCount(): number {
    return this.completedCount;
  }

  /** Check if there's an incomplete crawl that can be resumed */
  getIncompleteCrawl(): CrawlRecord | undefined {
    return getLatestIncompleteCrawl();
  }

  /** Resume an incomplete crawl from where it left off */
  async resumeIncompleteCrawl(apiKey?: string, bdZone?: string): Promise<string | null> {
    const incomplete = getLatestIncompleteCrawl();
    if (!incomplete) return null;

    const config: CrawlConfig = JSON.parse(incomplete.configJson);
    this.crawlId = incomplete.id;
    this.config = config;
    this.status = 'running';
    this.completedCount = incomplete.completedUrls;
    this.totalQueued = incomplete.completedUrls;
    this.totalSpend = incomplete.totalSpendUsd;
    this.responseTimes = [];
    this.startTime = Date.now();
    this.apiKey = apiKey || null;
    this.bdZone = bdZone || 'web_unlocker1';

    const baseUrl = new URL(config.startUrl);
    this.baseOrigin = baseUrl.origin;
    this.robotsRules = null;
    this.robotsUserAgent = config.robotsUserAgent && config.robotsUserAgent.trim() ? config.robotsUserAgent.trim() : 'Serpent';

    if (config.respectRobots) {
      await this.loadRobots(this.baseOrigin, config.customRobotsTxt);
    }

    // Rebuild visited set from already-crawled URLs
    const crawledUrls = getCrawledUrls(this.crawlId);
    this.visited.clear();
    this.pending.clear();
    for (const url of crawledUrls) {
      this.visited.add(url);
    }

    updateCrawlStatus(this.crawlId, 'running', this.totalQueued, this.completedCount, this.totalSpend);

    const concurrency = config.engine === 'local' ? (config.concurrency || 5) : 20;
    this.queue = new PQueue({ concurrency, autoStart: true });

    // Re-enqueue the start URL — enqueueUrl will skip already-visited
    if (config.mode === 'spider') {
      this.enqueueUrl(config.startUrl, 0);
    } else {
      const urls = config.startUrl.split('\n').map(u => u.trim()).filter(u => u.length > 0);
      for (const u of urls) {
        this.enqueueUrl(u, 0);
      }
    }

    this.queue.on('idle', () => {
      if (this.status === 'running') {
        this.status = 'completed';
        updateCrawlStatus(
          this.crawlId,
          'completed',
          this.totalQueued,
          this.completedCount,
          this.totalSpend,
          new Date().toISOString()
        );
        this.emitProgress();
        this.emit('complete', this.crawlId);
      }
    });

    this.emitProgress();
    return this.crawlId;
  }

  private enqueueUrl(url: string, depth: number): void {
    if (!this.config) { console.log('[CRAWL-DBG] enqueueUrl: no config'); return; }
    if (this.visited.has(url) || this.pending.has(url)) { console.log(`[CRAWL-DBG] enqueueUrl SKIP (already seen): ${url}`); return; }
    if (this.config.maxUrls > 0 && this.totalQueued >= this.config.maxUrls) { console.log(`[CRAWL-DBG] enqueueUrl SKIP (maxUrls ${this.config.maxUrls} reached): ${url}`); return; }
    if (this.config.maxDepth > 0 && depth > this.config.maxDepth) { console.log(`[CRAWL-DBG] enqueueUrl SKIP (maxDepth ${this.config.maxDepth}, depth ${depth}): ${url}`); return; }

    // Scope check
    try {
      const parsed = new URL(url);
      if (parsed.origin !== this.baseOrigin) { console.log(`[CRAWL-DBG] enqueueUrl SKIP (origin mismatch: ${parsed.origin} vs ${this.baseOrigin}): ${url}`); return; }

      // robots.txt check
      if (this.robotsRules && !checkPath(parsed.pathname + (parsed.search || ''), this.robotsRules).allowed) { console.log(`[CRAWL-DBG] enqueueUrl SKIP (robots): ${url}`); return; }
    } catch {
      console.log(`[CRAWL-DBG] enqueueUrl SKIP (URL parse error): ${url}`);
      return;
    }

    console.log(`[CRAWL-DBG] enqueueUrl OK depth=${depth}: ${url}`);
    this.pending.add(url);
    this.totalQueued++;
    this.queue!.add(() => this.processUrl(url, depth));
  }

  private async processUrl(url: string, depth: number): Promise<void> {
    if (!this.config) return;
    if (this.status === 'paused') return;

    // Check cost limit before fetching (BD mode)
    if (this.config.engine === 'brightdata' && this.config.maxCostUsd > 0) {
      const estimatedCost = CostTracker.costPerRequest();
      if (this.totalSpend + estimatedCost > this.config.maxCostUsd * 0.95) {
        this.queue?.pause();
        this.status = 'paused';
        this.emit('cost-limit-warning', {
          currentSpend: this.totalSpend,
          limit: this.config.maxCostUsd,
        });
        return;
      }
    }

    this.pending.delete(url);
    this.visited.add(url);

    // Skip if already in DB (resume support)
    if (pageExists(this.crawlId, url)) {
      this.completedCount++;
      this.emitProgress();
      return;
    }

    this.emit('url-start', url);
    console.log(`[CRAWL-DBG] processUrl START depth=${depth}: ${url}`);

    try {
      let result: Awaited<ReturnType<typeof crawlPageLocal>>;

      if (this.config.engine === 'local') {
        result = await crawlPageLocal(url, this.crawlId, depth, this.config, this.baseOrigin);
      } else {
        if (!this.apiKey) {
          this.emit('error', new Error('Bright Data API key not configured'));
          return;
        }
        const bdResult = await crawlPageBrightData(
          url,
          this.crawlId,
          depth,
          this.config,
          this.baseOrigin,
          this.apiKey,
          this.bdZone
        );
        this.totalSpend += bdResult.page.costUsd;
        result = bdResult;
      }

      // Spider mode: enqueue discovered URLs FIRST (before DB ops that might fail)
      console.log(`[CRAWL-DBG] processUrl DONE: ${url} | discovered=${result.discoveredUrls.length} links=${result.links.length} status=${result.page.statusCode} mode=${this.config.mode}`);
      if (result.discoveredUrls.length > 0) {
        console.log(`[CRAWL-DBG] First 5 discovered:`, result.discoveredUrls.slice(0, 5));
      }
      if (this.config.mode === 'spider') {
        for (const discoveredUrl of result.discoveredUrls) {
          this.enqueueUrl(discoveredUrl, depth + 1);
        }
      }

      // Store to DB
      insertPage(result.page);
      if (result.links.length > 0) insertLinks(result.links);
      if (result.images.length > 0) insertImages(result.images);

      // Store redirect chain
      if (result.redirectChain.length > 0) {
        const finalUrl = result.redirectChain[result.redirectChain.length - 1]?.url || url;
        const redirectRows: RedirectData[] = result.redirectChain.map((hop, i) => ({
          id: uuidv4(),
          crawlId: this.crawlId,
          sourceUrl: i === 0 ? url : result.redirectChain[i - 1].url,
          targetUrl: hop.url,
          statusCode: hop.statusCode,
          hopNumber: i,
          finalUrl,
        }));
        insertRedirects(redirectRows);
      }

      // Store hreflang entries
      if (result.hreflang.length > 0) {
        const hreflangRows: HreflangData[] = result.hreflang.map(h => ({
          id: uuidv4(),
          crawlId: this.crawlId,
          pageUrl: url,
          hreflang: h.hreflang,
          href: h.href,
        }));
        insertHreflang(hreflangRows);
      }

      // Store custom extraction results
      if (result.customExtractions.length > 0) {
        const extractionRows: CustomExtractionResult[] = result.customExtractions.map(e => ({
          id: uuidv4(),
          crawlId: this.crawlId,
          pageUrl: url,
          ruleName: e.name,
          selector: e.selector,
          value: e.value,
        }));
        insertCustomExtractions(extractionRows);
      }

      this.completedCount++;
      if (result.page.responseTimeMs) {
        this.responseTimes.push(result.page.responseTimeMs);
        if (this.responseTimes.length > 100) this.responseTimes.shift();
      }

      // Save progress every 10 pages
      if (this.completedCount % 10 === 0) {
        updateCrawlStatus(this.crawlId, 'running', this.totalQueued, this.completedCount, this.totalSpend);
      }

      this.emitProgress(url);
    } catch (err) {
      console.error(`[CRAWL-DBG] processUrl ERROR: ${url}`, err);
      this.emit('url-error', { url, error: err });
      this.completedCount++;
      this.emitProgress(url);
    }
  }

  private emitProgress(currentUrl?: string): void {
    const avgResponseMs = this.responseTimes.length > 0
      ? Math.round(this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length)
      : 0;

    const elapsed = (Date.now() - this.startTime) / 1000 || 1;
    const pagesPerSecond = Math.round((this.completedCount / elapsed) * 10) / 10;

    const progress: CrawlProgress = {
      crawlId: this.crawlId,
      status: this.status,
      completed: this.completedCount,
      total: this.totalQueued,
      currentUrl: currentUrl || '',
      avgResponseMs,
      totalSpendUsd: this.totalSpend,
      costLimitUsd: this.config?.maxCostUsd ?? 0,
      pagesPerSecond,
    };

    this.emit('progress', progress);
  }
}
