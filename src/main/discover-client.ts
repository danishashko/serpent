import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from './database';
import { DiscoverRequest, DiscoverResult, DiscoverTaskResponse, ContentGap } from '../types/index';

const BD_DISCOVER_ENDPOINT = 'https://api.brightdata.com/discover';
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 60; // 2 min max wait

/**
 * Start a Discover API search task. Returns a task_id for polling.
 */
export async function discoverStart(
  request: DiscoverRequest,
  apiKey: string
): Promise<{ taskId: string } | { error: string }> {
  try {
    const body: Record<string, unknown> = {
      query: request.query,
      format: 'json',
      num_results: request.numResults || 10,
      remove_duplicates: true,
    };

    if (request.intent) body.intent = request.intent;
    if (request.country) body.country = request.country;
    if (request.language) body.language = request.language;
    if (request.city) body.city = request.city;
    if (request.filterKeywords?.length) body.filter_keywords = request.filterKeywords;
    if (request.includeContent) body.include_content = true;
    if (request.startDate) body.start_date = request.startDate;
    if (request.endDate) body.end_date = request.endDate;

    const response = await axios.post(BD_DISCOVER_ENDPOINT, body, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (response.status === 200 && response.data?.task_id) {
      return { taskId: response.data.task_id };
    }

    return { error: `Discover API error (${response.status}): ${JSON.stringify(response.data)}` };
  } catch (err) {
    return { error: `Discover API request failed: ${String(err)}` };
  }
}

/**
 * Poll a Discover API task until completion.
 */
export async function discoverPoll(
  taskId: string,
  apiKey: string
): Promise<DiscoverTaskResponse> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    try {
      const response = await axios.get(`${BD_DISCOVER_ENDPOINT}?task_id=${encodeURIComponent(taskId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 15000,
        validateStatus: () => true,
      });

      const data = response.data;
      if (data?.status === 'done') {
        return {
          status: 'done',
          durationSeconds: data.duration_seconds || 0,
          results: (data.results || []).map((r: Record<string, unknown>) => ({
            link: String(r.link || ''),
            title: String(r.title || ''),
            description: String(r.description || ''),
            relevanceScore: Number(r.relevance_score || 0),
            content: r.content ? String(r.content) : null,
          })),
        };
      }

      if (data?.status === 'processing') {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      return { status: 'error', durationSeconds: 0, results: [] };
    } catch {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  return { status: 'error', durationSeconds: 0, results: [] };
}

/**
 * Full discover search: start + poll until done.
 */
export async function discoverSearch(
  request: DiscoverRequest,
  apiKey: string
): Promise<DiscoverTaskResponse & { error?: string }> {
  const startResult = await discoverStart(request, apiKey);
  if ('error' in startResult) {
    return { status: 'error', durationSeconds: 0, results: [], error: startResult.error };
  }

  return discoverPoll(startResult.taskId, apiKey);
}

/**
 * Competitor discovery: search for competitors of a domain/keyword and store results.
 */
export async function discoverCompetitors(
  crawlId: string,
  domain: string,
  keywords: string[],
  apiKey: string,
  country = 'US'
): Promise<{ results: DiscoverResult[]; error?: string }> {
  const allResults: DiscoverResult[] = [];

  for (const keyword of keywords) {
    const request: DiscoverRequest = {
      query: `${keyword} ${domain}`,
      intent: [
        `I am an SEO analyst researching competitors for "${domain}" in the "${keyword}" space.`,
        `Prioritize official company websites, product pages, and landing pages that rank for "${keyword}".`,
        `Focus on domains different from "${domain}" that target the same audience and keywords.`,
        `Strictly exclude social media profiles, news aggregators, directory listings, and PDF documents.`,
      ].join('\n'),
      country,
      numResults: 10,
      language: 'en',
    };

    const response = await discoverSearch(request, apiKey);
    if (response.error) {
      return { results: [], error: response.error };
    }

    // Filter out results from the user's own domain
    const domainLower = domain.toLowerCase().replace(/^www\./, '');
    const filtered = response.results.filter(r => {
      try {
        const resultDomain = new URL(r.link).hostname.toLowerCase().replace(/^www\./, '');
        return resultDomain !== domainLower;
      } catch {
        return true;
      }
    });

    allResults.push(...filtered);
  }

  // Deduplicate by URL and store
  const seen = new Set<string>();
  const deduped = allResults.filter(r => {
    if (seen.has(r.link)) return false;
    seen.add(r.link);
    return true;
  });

  storeDiscoverResults(crawlId, 'competitor', deduped);
  return { results: deduped };
}

/**
 * Content gap analysis: find topics competitors cover that the crawled site doesn't.
 */
export async function discoverContentGaps(
  crawlId: string,
  domain: string,
  topics: string[],
  crawledUrls: string[],
  crawledTitles: string[],
  apiKey: string,
  country = 'US'
): Promise<{ gaps: ContentGap[]; error?: string }> {
  const gaps: ContentGap[] = [];

  // Build a lowercase set of crawled content signals for matching
  const crawledContent = new Set<string>();
  for (const url of crawledUrls) crawledContent.add(url.toLowerCase());
  for (const title of crawledTitles) {
    if (title) crawledContent.add(title.toLowerCase());
  }

  for (const topic of topics) {
    const request: DiscoverRequest = {
      query: topic,
      intent: [
        `I am an SEO content strategist analyzing content coverage for the topic "${topic}".`,
        `Prioritize in-depth blog posts, guides, how-to articles, and resource pages.`,
        `Focus on pages with high-quality, educational content that would rank well in search engines.`,
        `Strictly exclude forums, social media posts, news articles older than 2 years, and promotional landing pages.`,
      ].join('\n'),
      country,
      numResults: 15,
      language: 'en',
      includeContent: false,
    };

    const response = await discoverSearch(request, apiKey);
    if (response.error) {
      return { gaps: [], error: response.error };
    }

    // Check if the user's site covers this topic
    const domainLower = domain.toLowerCase().replace(/^www\./, '');
    const ownResults = response.results.filter(r => {
      try {
        return new URL(r.link).hostname.toLowerCase().replace(/^www\./, '') === domainLower;
      } catch {
        return false;
      }
    });

    const competitorResults = response.results.filter(r => {
      try {
        return new URL(r.link).hostname.toLowerCase().replace(/^www\./, '') !== domainLower;
      } catch {
        return true;
      }
    });

    // Determine if this is a gap
    const hasOwnContent = ownResults.length > 0 ||
      crawledTitles.some(t => t && t.toLowerCase().includes(topic.toLowerCase())) ||
      crawledUrls.some(u => u.toLowerCase().includes(topic.toLowerCase().replace(/\s+/g, '-')));

    // Extract competitor domains
    const competitorDomains = new Set<string>();
    for (const r of competitorResults) {
      try {
        competitorDomains.add(new URL(r.link).hostname.replace(/^www\./, ''));
      } catch { /* skip */ }
    }

    const avgRelevance = competitorResults.length > 0
      ? competitorResults.reduce((sum, r) => sum + r.relevanceScore, 0) / competitorResults.length
      : 0;

    gaps.push({
      id: uuidv4(),
      crawlId,
      topic,
      hasOwnContent,
      ownContentCount: ownResults.length,
      competitorCount: competitorResults.length,
      competitorDomains: Array.from(competitorDomains),
      topCompetitorUrls: competitorResults.slice(0, 5).map(r => ({
        url: r.link,
        title: r.title,
        relevanceScore: r.relevanceScore,
      })),
      avgRelevanceScore: Math.round(avgRelevance * 100) / 100,
      gapSeverity: !hasOwnContent && competitorResults.length >= 3 ? 'high'
        : !hasOwnContent && competitorResults.length >= 1 ? 'medium'
        : hasOwnContent && competitorResults.length >= 5 ? 'low'
        : 'none',
      analyzedAt: new Date().toISOString(),
    });
  }

  storeContentGaps(crawlId, gaps);
  return { gaps };
}

// ─── Database Storage ──────────────────────────────────────────────────────────

export function storeDiscoverResults(crawlId: string, searchType: string, results: DiscoverResult[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO discover_results (id, crawl_id, search_type, link, title, description, relevance_score, content, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  const tx = db.transaction(() => {
    for (const r of results) {
      stmt.run(uuidv4(), crawlId, searchType, r.link, r.title, r.description, r.relevanceScore, r.content || null, now);
    }
  });
  tx();
}

export function getDiscoverResults(crawlId: string, searchType?: string): DiscoverResult[] {
  const db = getDb();
  if (searchType) {
    return db.prepare('SELECT link, title, description, relevance_score AS relevanceScore, content FROM discover_results WHERE crawl_id = ? AND search_type = ? ORDER BY relevance_score DESC').all(crawlId, searchType) as DiscoverResult[];
  }
  return db.prepare('SELECT link, title, description, relevance_score AS relevanceScore, content FROM discover_results WHERE crawl_id = ? ORDER BY relevance_score DESC').all(crawlId) as DiscoverResult[];
}

export function storeContentGaps(_crawlId: string, gaps: ContentGap[]): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO content_gaps (id, crawl_id, topic, has_own_content, own_content_count, competitor_count,
      competitor_domains_json, top_competitor_urls_json, avg_relevance_score, gap_severity, analyzed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = db.transaction(() => {
    for (const g of gaps) {
      stmt.run(
        g.id, g.crawlId, g.topic, g.hasOwnContent ? 1 : 0, g.ownContentCount, g.competitorCount,
        JSON.stringify(g.competitorDomains), JSON.stringify(g.topCompetitorUrls),
        g.avgRelevanceScore, g.gapSeverity, g.analyzedAt
      );
    }
  });
  tx();
}

export function getContentGaps(crawlId: string): ContentGap[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM content_gaps WHERE crawl_id = ? ORDER BY gap_severity DESC, competitor_count DESC').all(crawlId) as Record<string, unknown>[];

  return rows.map(r => ({
    id: String(r.id),
    crawlId: String(r.crawl_id),
    topic: String(r.topic),
    hasOwnContent: Boolean(r.has_own_content),
    ownContentCount: Number(r.own_content_count),
    competitorCount: Number(r.competitor_count),
    competitorDomains: JSON.parse(String(r.competitor_domains_json || '[]')),
    topCompetitorUrls: JSON.parse(String(r.top_competitor_urls_json || '[]')),
    avgRelevanceScore: Number(r.avg_relevance_score),
    gapSeverity: String(r.gap_severity) as ContentGap['gapSeverity'],
    analyzedAt: String(r.analyzed_at),
  }));
}
