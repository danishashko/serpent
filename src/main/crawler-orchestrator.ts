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

// ─── Simple robots.txt parser ──────────────────────────────────────────────────

interface RobotsTxtRules {
  disallowed: string[];
  allowed: string[];
}

function parseRobotsTxt(body: string, userAgent: string = '*'): RobotsTxtRules {
  const lines = body.split('\n').map(l => l.trim());
  const rules: RobotsTxtRules = { disallowed: [], allowed: [] };
  let currentAgentMatches = false;
  let foundSpecificAgent = false;

  for (const line of lines) {
    if (line.startsWith('#') || line === '') {
      // Blank line resets current agent block
      if (line === '') currentAgentMatches = false;
      continue;
    }

    const lower = line.toLowerCase();
    if (lower.startsWith('user-agent:')) {
      const agent = line.slice('user-agent:'.length).trim().toLowerCase();
      if (agent === userAgent.toLowerCase() || agent === '*') {
        currentAgentMatches = true;
        if (agent !== '*') foundSpecificAgent = true;
      } else {
        currentAgentMatches = false;
      }
    } else if (currentAgentMatches && lower.startsWith('disallow:')) {
      const path = line.slice('disallow:'.length).trim();
      if (path) rules.disallowed.push(path);
    } else if (currentAgentMatches && lower.startsWith('allow:')) {
      const path = line.slice('allow:'.length).trim();
      if (path) rules.allowed.push(path);
    }
  }

  // If we found specific agent rules, only use those (re-parse)
  if (foundSpecificAgent && userAgent !== '*') {
    return parseRobotsTxt(body, userAgent);
  }

  return rules;
}

function isUrlAllowedByRobots(urlPath: string, rules: RobotsTxtRules): boolean {
  // Check allowed first (more specific takes precedence by length)
  let longestAllow = -1;
  let longestDisallow = -1;

  for (const pattern of rules.allowed) {
    if (urlPath.startsWith(pattern)) {
      longestAllow = Math.max(longestAllow, pattern.length);
    }
  }

  for (const pattern of rules.disallowed) {
    if (urlPath.startsWith(pattern)) {
      longestDisallow = Math.max(longestDisallow, pattern.length);
    }
  }

  // If both match, longer pattern wins. If equal length, allow wins.
  if (longestDisallow < 0) return true; // Nothing disallowed
  if (longestAllow >= longestDisallow) return true; // Allow is more specific
  return false;
}

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
  private robotsRules: RobotsTxtRules | null = null;

  private async fetchRobotsTxt(origin: string): Promise<void> {
    try {
      const response = await axios.get(`${origin}/robots.txt`, {
        timeout: 10000,
        validateStatus: (s) => s < 500,
      });
      if (response.status === 200 && typeof response.data === 'string') {
        this.robotsRules = parseRobotsTxt(response.data, 'GhostFrog');
      } else {
        this.robotsRules = { disallowed: [], allowed: [] }; // No robots.txt = all allowed
      }
    } catch {
      this.robotsRules = { disallowed: [], allowed: [] }; // Fetch failed = all allowed
    }
  }

  async startCrawl(config: CrawlConfig, apiKey?: string, bdZone?: string): Promise<string> {
    this.crawlId = uuidv4();
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

    if (config.respectRobots) {
      await this.fetchRobotsTxt(this.baseOrigin);
    }

    const crawlRecord: CrawlRecord = {
      id: this.crawlId,
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

    if (config.respectRobots) {
      await this.fetchRobotsTxt(this.baseOrigin);
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
    if (!this.config) return;
    if (this.visited.has(url) || this.pending.has(url)) return;
    if (this.config.maxUrls > 0 && this.totalQueued >= this.config.maxUrls) return;
    if (this.config.maxDepth > 0 && depth > this.config.maxDepth) return;

    // Scope check
    try {
      const parsed = new URL(url);
      if (parsed.origin !== this.baseOrigin) return;

      // robots.txt check
      if (this.robotsRules && !isUrlAllowedByRobots(parsed.pathname, this.robotsRules)) return;
    } catch {
      return;
    }

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

      // Spider mode: enqueue discovered URLs
      if (this.config.mode === 'spider') {
        for (const discoveredUrl of result.discoveredUrls) {
          this.enqueueUrl(discoveredUrl, depth + 1);
        }
      }

      // Save progress every 10 pages
      if (this.completedCount % 10 === 0) {
        updateCrawlStatus(this.crawlId, 'running', this.totalQueued, this.completedCount, this.totalSpend);
      }

      this.emitProgress(url);
    } catch (err) {
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
