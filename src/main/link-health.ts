// Post-crawl link health pass.
//
// A crawl records what each page links to, but whether those targets work is
// only knowable once the crawl is over. This module runs the checks that need
// the finished crawl and writes the result back as per-page counters, which is
// what lets the Issues tab and the MCP `get_issues` tool report them:
//
//   1. internal links   — which pages link to a URL that errored or redirects
//                         (no network: the crawl already fetched every target)
//   2. external links   — HTTP status of every distinct off-site link target
//   3. images           — HTTP status of every distinct image file
//   4. XML sitemap      — discover the sitemap and mark each page in / not in it
//
// Stages 2–4 hit the network, so they run after the crawl is reported
// complete and never block it. `onStage` fires after each one so the UI can
// refresh as results land.

import {
  getCrawlById,
  getDistinctExternalLinkTargets,
  getDistinctImageUrls,
  getPagesByCrawl,
  recomputeLinkHealth,
  setLinkHealthSummary,
  setPagesInSitemap,
  updateImageStatusCodes,
  updateLinkStatusCodes,
} from './database';
import type { LinkHealthTotals } from './database';
import { isPrivateHost, probeUrlStatuses } from './external-link-checker';
import type { ProbeOptions } from './external-link-checker';
import { analyzeSitemap, discoverSitemapUrls } from './sitemap-analyzer';
import type { AnalyzerDeps } from './sitemap-analyzer';
import type { CrawlConfig, LinkHealthSummary, PostCrawlStage } from '../types/index';

/** Upper bound on probes per stage, so a huge crawl cannot queue an unbounded follow-up. */
export const MAX_PROBES_PER_STAGE = 5000;
/** Parallel probes for off-site link targets (many hosts). Image probes keep the prober default. */
export const EXTERNAL_CONCURRENCY = 12;
/** Wall-clock budget per network stage. */
export const STAGE_BUDGET_MS = 10 * 60 * 1000;

const running = new Map<string, PostCrawlStage>();

/** The stage currently running for a crawl, or null when no pass is in flight. */
export function getPostCrawlStage(crawlId: string): PostCrawlStage | null {
  return running.get(crawlId) ?? null;
}

export interface PostCrawlOptions {
  /** Called after each stage has written its results. */
  onStage?: (stage: PostCrawlStage, crawlId: string) => void;
  /** Test seams. */
  probe?: typeof probeUrlStatuses;
  sitemapDeps?: AnalyzerDeps;
}

function emptyTotals(): LinkHealthTotals {
  return {
    pagesWithBrokenOutlinks: 0,
    pagesWithRedirectOutlinks: 0,
    pagesWithBrokenExternalOutlinks: 0,
    pagesWithBrokenImages: 0,
  };
}

export async function runPostCrawlChecks(
  crawlId: string,
  opts: PostCrawlOptions = {},
): Promise<LinkHealthSummary> {
  const probe = opts.probe ?? probeUrlStatuses;
  const summary: LinkHealthSummary = {
    state: 'running',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    externalLinks: { total: 0, checked: 0, truncated: false },
    images: { total: 0, checked: 0, truncated: false },
    sitemap: null,
    totals: emptyTotals(),
  };

  const crawl = getCrawlById(crawlId);
  let config: Partial<CrawlConfig> = {};
  try { config = crawl ? (JSON.parse(crawl.configJson) as Partial<CrawlConfig>) : {}; } catch { /* legacy row */ }

  let startOrigin: string | null = null;
  let startHost = '';
  try {
    const u = new URL(crawl?.startUrl ?? '');
    startOrigin = u.origin;
    startHost = u.hostname;
  } catch { /* no usable start URL — sitemap stage is skipped */ }

  // A crawl of a private host (localhost, a LAN staging box) may probe private
  // targets; a crawl of a public site may not be steered into the user's network.
  const allowPrivateHosts = startHost !== '' && isPrivateHost(startHost);
  const rps = config.requestsPerSecond ?? 0;
  const baseProbe: ProbeOptions = {
    maxUrls: MAX_PROBES_PER_STAGE,
    budgetMs: STAGE_BUDGET_MS,
    allowPrivateHosts,
  };

  const stageDone = (stage: PostCrawlStage): void => {
    summary.totals = recomputeLinkHealth(crawlId);
    setLinkHealthSummary(crawlId, summary);
    opts.onStage?.(stage, crawlId);
  };

  try {
    // 1. Internal links — pure database work.
    running.set(crawlId, 'internal_links');
    stageDone('internal_links');

    // 2. External link targets.
    running.set(crawlId, 'external_links');
    try {
      // Off-site targets are spread over many hosts, so a wider pool costs no
      // single server more than a request or two at a time.
      const res = await probe(getDistinctExternalLinkTargets(crawlId), { ...baseProbe, concurrency: EXTERNAL_CONCURRENCY });
      if (res.statuses.size > 0) updateLinkStatusCodes(crawlId, res.statuses);
      summary.externalLinks = { total: res.total, checked: res.checked, truncated: res.truncated };
    } catch (err) {
      console.error('[LINK-HEALTH] external link check failed:', err);
    }
    stageDone('external_links');

    // 3. Image files. Most sit on the crawled host or its CDN, so this stage
    //    honours the crawl's own rate limit and User-Agent.
    running.set(crawlId, 'images');
    try {
      const res = await probe(getDistinctImageUrls(crawlId), {
        ...baseProbe,
        minIntervalMs: rps > 0 ? Math.ceil(1000 / rps) : 0,
        userAgent: config.userAgent || undefined,
      });
      if (res.statuses.size > 0) updateImageStatusCodes(crawlId, res.statuses);
      summary.images = { total: res.total, checked: res.checked, truncated: res.truncated };
    } catch (err) {
      console.error('[LINK-HEALTH] image check failed:', err);
    }
    stageDone('images');

    // 4. XML sitemap. Only meaningful for a spider crawl of one site: a list
    //    crawl is an arbitrary set of URLs, so "missing from the sitemap"
    //    would say nothing about the site.
    running.set(crawlId, 'sitemap');
    if (startOrigin && config.mode !== 'list') {
      try {
        const sitemapUrls = await discoverSitemapUrls(startOrigin, opts.sitemapDeps);
        if (sitemapUrls.length === 0) {
          summary.sitemap = { found: false, sitemapUrls: [], urlsInSitemap: 0, notInSitemap: 0, nonIndexableInSitemap: 0, orphanFromSitemap: 0, errors: [] };
        } else {
          const result = await analyzeSitemap(sitemapUrls, getPagesByCrawl(crawlId), opts.sitemapDeps);
          const found = result.urlsInSitemap.length > 0;
          // A sitemap that could not be read is "unknown", not "every page is
          // missing from it" — only flag pages when URLs were actually parsed.
          if (found) setPagesInSitemap(crawlId, new Set(result.urlsInSitemap), startOrigin);
          summary.sitemap = {
            found,
            sitemapUrls,
            urlsInSitemap: result.urlsInSitemap.length,
            notInSitemap: result.notInSitemap.length,
            nonIndexableInSitemap: result.nonIndexableInSitemap.length,
            orphanFromSitemap: result.orphanFromSitemap.length,
            errors: result.errors.slice(0, 10),
          };
        }
      } catch (err) {
        console.error('[LINK-HEALTH] sitemap audit failed:', err);
      }
    }

    summary.state = 'done';
    summary.finishedAt = new Date().toISOString();
    stageDone('sitemap');
    return summary;
  } finally {
    running.delete(crawlId);
  }
}
