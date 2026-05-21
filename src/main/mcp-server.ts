import * as http from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import keytar from 'keytar';
import { CrawlOrchestrator } from './crawler-orchestrator';
import { getAllCrawls, getPagesByCrawl, getLinksByCrawl, getImagesByCrawl } from './database';
import type { CrawlRecord, PageData, LinkData, ImageData } from '../types/index';

const KEYTAR_SERVICE = 'serpent';
const MCP_PORT = 7777;
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function validateHost(req: http.IncomingMessage): boolean {
  const hostHeader = req.headers.host;
  if (!hostHeader) return false;
  try {
    const hostname = new URL('http://' + hostHeader).hostname;
    return ALLOWED_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function buildMcpServer(orchestrator: CrawlOrchestrator): McpServer {
  const server = new McpServer({ name: 'serpent', version: '1.0.3' });

  // ── start_crawl ────────────────────────────────────────────────────────────
  server.registerTool(
    'start_crawl',
    {
      description: 'Start a new website crawl. Returns the crawl ID. Use engine "local" for normal crawls or "brightdata" when JS rendering is needed.',
      inputSchema: z.object({
        url: z.string().describe('The starting URL to crawl (e.g. https://example.com)'),
        engine: z.enum(['local', 'brightdata']).optional().describe('Crawl engine. Defaults to local.'),
        mode: z.enum(['spider', 'list']).optional().describe('spider = follow links, list = crawl only provided URL. Defaults to spider.'),
        max_urls: z.number().int().min(1).max(50000).optional().describe('Maximum URLs to crawl. Defaults to 500. Set higher for large sites (e.g. 2000 for a 1000-page site, 5000+ for a large blog). Always pass this explicitly — the default is conservative.'),
        max_depth: z.number().int().min(1).max(20).optional().describe('Maximum crawl depth. Defaults to 10.'),
      }),
    },
    async ({ url, engine, mode, max_urls, max_depth }) => {
      const resolvedEngine = engine ?? 'local';
      const resolvedMode = mode ?? 'spider';
      const resolvedMaxUrls = max_urls ?? 500;
      const resolvedMaxDepth = max_depth ?? 10;

      let apiKey: string | null = null;
      let bdZone: string | null = null;

      if (resolvedEngine === 'brightdata') {
        apiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
        bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
        if (!apiKey) {
          return { content: [{ type: 'text' as const, text: 'BrightData API key not configured. Please add it in Serpent Settings.' }] };
        }
      }

      const config = {
        startUrl: url,
        mode: resolvedMode,
        engine: resolvedEngine,
        storageMode: 'database' as const,
        maxUrls: resolvedMaxUrls,
        maxDepth: resolvedMaxDepth,
        concurrency: 5,
        respectRobots: true,
        followRedirects: true,
        restrictToSubdomain: true,
        timeout: 30000,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractImages: true,
        extractLinks: true,
        extractCanonicals: true,
        maxCostUsd: 1.0,
        ...(bdZone ? { bdZone } : {}),
      };

      try {
        const crawlId = await orchestrator.startCrawl(config, apiKey ?? undefined, bdZone ?? undefined);
        return { content: [{ type: 'text' as const, text: `Crawl started. ID: ${crawlId}` }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: 'text' as const, text: `Failed to start crawl: ${msg}` }] };
      }
    }
  );

  // ── stop_crawl ─────────────────────────────────────────────────────────────
  server.registerTool(
    'stop_crawl',
    {
      description: 'Stop the currently running crawl.',
      inputSchema: z.object({}),
    },
    async () => {
      const status = orchestrator.getStatus();
      if (status !== 'running' && status !== 'paused') {
        return { content: [{ type: 'text' as const, text: `No active crawl to stop (status: ${status}).` }] };
      }
      orchestrator.stop();
      return { content: [{ type: 'text' as const, text: 'Crawl stopped.' }] };
    }
  );

  // ── get_crawl_status ───────────────────────────────────────────────────────
  server.registerTool(
    'get_crawl_status',
    {
      description: 'Get the current status of the active crawl.',
      inputSchema: z.object({}),
    },
    async () => {
      const status = orchestrator.getStatus();
      const crawlId = orchestrator.getCrawlId();
      const completed = orchestrator.getCompletedCount();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ status, crawl_id: crawlId || null, completed_pages: completed }, null, 2),
        }],
      };
    }
  );

  // ── list_crawls ────────────────────────────────────────────────────────────
  server.registerTool(
    'list_crawls',
    {
      description: 'List all past crawls stored in the database.',
      inputSchema: z.object({}),
    },
    async () => {
      const crawls = getAllCrawls() as CrawlRecord[];
      if (crawls.length === 0) {
        return { content: [{ type: 'text' as const, text: 'No crawls found.' }] };
      }
      const summary = crawls.map((c) => ({
        id: c.id,
        startUrl: c.startUrl,
        status: c.status,
        completedUrls: c.completedUrls,
        totalUrls: c.totalUrls,
        startTime: c.startTime,
        endTime: c.endTime,
      }));
      return { content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ── get_results ────────────────────────────────────────────────────────────
  server.registerTool(
    'get_results',
    {
      description: 'Get crawled page data for a specific crawl. Returns SEO data for each page.',
      inputSchema: z.object({
        crawl_id: z.string().describe('Crawl ID from list_crawls or start_crawl'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max pages to return. Defaults to 50.'),
        offset: z.number().int().min(0).optional().describe('Page offset for pagination. Defaults to 0.'),
      }),
    },
    async ({ crawl_id, limit, offset }) => {
      const resolvedLimit = limit ?? 50;
      const resolvedOffset = offset ?? 0;
      const pages = getPagesByCrawl(crawl_id) as PageData[];
      if (pages.length === 0) {
        return { content: [{ type: 'text' as const, text: `No pages found for crawl ${crawl_id}.` }] };
      }
      const slice = pages.slice(resolvedOffset, resolvedOffset + resolvedLimit);
      const result = {
        total: pages.length,
        offset: resolvedOffset,
        limit: resolvedLimit,
        pages: slice.map((p) => ({
          url: p.url,
          statusCode: p.statusCode,
          title: p.title,
          titleLength: p.titleLength,
          metaDescription: p.metaDescription,
          metaDescLength: p.metaDescLength,
          h1: p.h1,
          h2: p.h2,
          h1Count: p.h1Count,
          h2Count: p.h2Count,
          isIndexable: p.isIndexable,
          canonicalUrl: p.canonicalUrl,
          isCanonicalized: p.isCanonicalized,
          wordCount: p.wordCount,
          textRatio: p.textRatio,
          responseTimeMs: p.responseTimeMs,
          pageSizeBytes: p.pageSizeBytes,
          crawlDepth: p.crawlDepth,
          imageCount: p.imageCount,
          linkScore: p.linkScore,
          robotsDirectives: p.robotsDirectives,
          // Open Graph
          ogTitle: p.ogTitle,
          ogDescription: p.ogDescription,
          ogImage: p.ogImage,
          ogType: p.ogType,
          // Structured Data
          hasStructuredData: p.hasStructuredData,
          schemaTypes: p.schemaTypes,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── get_issues ─────────────────────────────────────────────────────────────
  server.registerTool(
    'get_issues',
    {
      description: 'Get SEO issues found during a crawl, grouped by severity.',
      inputSchema: z.object({
        crawl_id: z.string().describe('Crawl ID to analyze'),
      }),
    },
    async ({ crawl_id }) => {
      const pages = getPagesByCrawl(crawl_id) as PageData[];
      if (pages.length === 0) {
        return { content: [{ type: 'text' as const, text: `No pages found for crawl ${crawl_id}.` }] };
      }
      type Issue = { url: string; details: string };
      const issues: Record<'critical' | 'warning' | 'info', Issue[]> = { critical: [], warning: [], info: [] };

      for (const p of pages) {
        if (p.statusCode !== null && p.statusCode >= 400) {
          issues.critical.push({ url: p.url, details: `HTTP ${p.statusCode}` });
        }
        if (!p.title || !p.title.trim()) {
          issues.critical.push({ url: p.url, details: 'Missing title' });
        }
        if (p.titleLength !== null && (p.titleLength < 10 || p.titleLength > 60)) {
          issues.warning.push({ url: p.url, details: `Title length ${p.titleLength} chars (ideal: 10-60)` });
        }
        if (!p.metaDescription || !p.metaDescription.trim()) {
          issues.warning.push({ url: p.url, details: 'Missing meta description' });
        }
        if (!p.isIndexable) {
          issues.warning.push({ url: p.url, details: 'Page marked as non-indexable' });
        }
        if (!p.h1 || !p.h1.trim()) {
          issues.warning.push({ url: p.url, details: 'Missing H1' });
        }
        if (p.h1Count > 1) {
          issues.warning.push({ url: p.url, details: `Multiple H1 tags (${p.h1Count})` });
        }
        if (p.responseTimeMs !== null && p.responseTimeMs > 2000) {
          issues.warning.push({ url: p.url, details: `Slow response: ${p.responseTimeMs}ms` });
        }
        if (p.canonicalUrl && p.canonicalUrl !== p.url) {
          issues.info.push({ url: p.url, details: `Canonicalized to ${p.canonicalUrl}` });
        }
        if (!p.ogImage || !p.ogImage.trim()) {
          issues.warning.push({ url: p.url, details: 'Missing OG image (og:image)' });
        }
        if (!p.hasStructuredData) {
          issues.info.push({ url: p.url, details: 'No structured data (Schema.org)' });
        }
        if (p.wordCount !== null && p.wordCount > 0 && p.wordCount < 300) {
          issues.warning.push({ url: p.url, details: `Thin content: only ${p.wordCount} words` });
        }
        if (p.h2Count !== null && p.h2Count === 0 && p.wordCount !== null && p.wordCount > 500) {
          issues.info.push({ url: p.url, details: 'No H2 headings on a long page (affects readability/SEO)' });
        }
      }

      // Duplicate title detection
      const titleMap = new Map<string, string[]>();
      for (const p of pages) {
        if (p.title && p.title.trim()) {
          const t = p.title.trim().toLowerCase();
          if (!titleMap.has(t)) titleMap.set(t, []);
          titleMap.get(t)!.push(p.url);
        }
      }
      for (const [title, urls] of titleMap) {
        if (urls.length > 1) {
          issues.warning.push({ url: urls.join(', '), details: `Duplicate title: "${title}" on ${urls.length} pages` });
        }
      }

      // Duplicate meta description detection
      const metaMap = new Map<string, string[]>();
      for (const p of pages) {
        if (p.metaDescription && p.metaDescription.trim()) {
          const m = p.metaDescription.trim().toLowerCase();
          if (!metaMap.has(m)) metaMap.set(m, []);
          metaMap.get(m)!.push(p.url);
        }
      }
      for (const [, urls] of metaMap) {
        if (urls.length > 1) {
          issues.warning.push({ url: urls.join(', '), details: `Duplicate meta description on ${urls.length} pages` });
        }
      }

      const result = {
        total_pages: pages.length,
        critical_count: issues.critical.length,
        warning_count: issues.warning.length,
        info_count: issues.info.length,
        issues,
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── export_csv ─────────────────────────────────────────────────────────────
  server.registerTool(
    'export_csv',
    {
      description: 'Export crawl results as CSV text.',
      inputSchema: z.object({
        crawl_id: z.string().describe('Crawl ID to export'),
      }),
    },
    async ({ crawl_id }) => {
      const pages = getPagesByCrawl(crawl_id) as PageData[];
      if (pages.length === 0) {
        return { content: [{ type: 'text' as const, text: `No pages found for crawl ${crawl_id}.` }] };
      }

      const headers: (keyof PageData)[] = [
        'url', 'statusCode', 'title', 'titleLength', 'metaDescription', 'metaDescLength',
        'h1', 'h2', 'h1Count', 'h2Count', 'wordCount', 'canonicalUrl', 'isCanonicalized',
        'isIndexable', 'responseTimeMs', 'pageSizeBytes', 'crawlDepth', 'costUsd',
      ];

      const escape = (v: unknown): string => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return (s.includes(',') || s.includes('"') || s.includes('\n'))
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      };

      const rows = pages.map((p) => headers.map((h) => escape(p[h])).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      return { content: [{ type: 'text' as const, text: csv }] };
    }
  );

  // ── get_links ──────────────────────────────────────────────────────────────
  server.registerTool(
    'get_links',
    {
      description: 'Get the internal link graph for a crawl. Returns source→target pairs with anchor text. Use this to find orphaned pages (no inbound links), link equity distribution, and navigation structure.',
      inputSchema: z.object({
        crawl_id: z.string().describe('Crawl ID from list_crawls or start_crawl'),
        filter: z.enum(['all', 'internal', 'external']).optional().describe('Filter by link type. Defaults to "internal".'),
        limit: z.number().int().min(1).max(5000).optional().describe('Max links to return. Defaults to 200.'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination. Defaults to 0.'),
      }),
    },
    async ({ crawl_id, filter, limit, offset }) => {
      const resolvedFilter = filter ?? 'internal';
      const resolvedLimit = limit ?? 200;
      const resolvedOffset = offset ?? 0;

      const allLinks = getLinksByCrawl(crawl_id) as LinkData[];
      if (allLinks.length === 0) {
        return { content: [{ type: 'text' as const, text: `No links found for crawl ${crawl_id}.` }] };
      }

      const filtered = resolvedFilter === 'all'
        ? allLinks
        : resolvedFilter === 'internal'
          ? allLinks.filter(l => l.isInternal)
          : allLinks.filter(l => !l.isInternal);

      const slice = filtered.slice(resolvedOffset, resolvedOffset + resolvedLimit);

      // Compute orphaned pages: pages crawled but with 0 inbound internal links
      const pages = getPagesByCrawl(crawl_id) as PageData[];
      const inboundCount = new Map<string, number>();
      for (const p of pages) inboundCount.set(p.url, 0);
      for (const l of allLinks) {
        if (l.isInternal && inboundCount.has(l.targetUrl)) {
          inboundCount.set(l.targetUrl, (inboundCount.get(l.targetUrl) ?? 0) + 1);
        }
      }
      const orphaned = [...inboundCount.entries()]
        .filter(([, count]) => count === 0)
        .map(([url]) => url);

      // Top 10 most-linked pages
      const sorted = [...inboundCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([url, count]) => ({ url, inbound_links: count }));

      const result = {
        total_links: filtered.length,
        offset: resolvedOffset,
        limit: resolvedLimit,
        orphaned_pages_count: orphaned.length,
        orphaned_pages: orphaned.slice(0, 50),
        top_linked_pages: sorted,
        links: slice.map(l => ({
          source: l.sourceUrl,
          target: l.targetUrl,
          anchor: l.anchorText,
          rel: l.relAttr,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── get_images ─────────────────────────────────────────────────────────────
  server.registerTool(
    'get_images',
    {
      description: 'Audit images found during a crawl. Returns images with missing alt text, format info, and lazy-loading status. Useful for accessibility and performance analysis.',
      inputSchema: z.object({
        crawl_id: z.string().describe('Crawl ID from list_crawls or start_crawl'),
        missing_alt_only: z.boolean().optional().describe('If true, return only images with missing alt text. Defaults to false.'),
        limit: z.number().int().min(1).max(2000).optional().describe('Max images to return. Defaults to 100.'),
        offset: z.number().int().min(0).optional().describe('Offset for pagination. Defaults to 0.'),
      }),
    },
    async ({ crawl_id, missing_alt_only, limit, offset }) => {
      const resolvedLimit = limit ?? 100;
      const resolvedOffset = offset ?? 0;

      const allImages = getImagesByCrawl(crawl_id) as ImageData[];
      if (allImages.length === 0) {
        return { content: [{ type: 'text' as const, text: `No images found for crawl ${crawl_id}.` }] };
      }

      const missingAlt = allImages.filter(i => !i.altText || !i.altText.trim());
      const filtered = missing_alt_only ? missingAlt : allImages;
      const slice = filtered.slice(resolvedOffset, resolvedOffset + resolvedLimit);

      const result = {
        total_images: allImages.length,
        missing_alt_count: missingAlt.length,
        offset: resolvedOffset,
        limit: resolvedLimit,
        images: slice.map(i => ({
          page: i.pageUrl,
          src: i.imageUrl,
          alt: i.altText,
          format: i.format,
          hasWidth: i.hasWidth,
          hasHeight: i.hasHeight,
          isLazy: i.isLazy,
        })),
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    }
  );

  // ── set_settings ───────────────────────────────────────────────────────────
  server.registerTool(
    'set_settings',
    {
      description: 'Save Bright Data credentials to Serpent so the brightdata crawl engine becomes available. Call get_settings afterwards to confirm.',
      inputSchema: z.object({
        bd_api_key: z.string().min(1).describe('Bright Data API key (bearer token)'),
        bd_zone: z.string().optional().describe('Bright Data zone name. Defaults to "web_unlocker1" if not provided.'),
      }),
    },
    async ({ bd_api_key, bd_zone }) => {
      await keytar.setPassword(KEYTAR_SERVICE, 'bd_api_key', bd_api_key);
      await keytar.setPassword(KEYTAR_SERVICE, 'bd_zone', bd_zone ?? 'web_unlocker1');
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            success: true,
            message: 'Bright Data credentials saved. Call get_settings to verify.',
            zone: bd_zone ?? 'web_unlocker1',
          }, null, 2),
        }],
      };
    }
  );

  // ── get_settings ───────────────────────────────────────────────────────────
  server.registerTool(
    'get_settings',
    {
      description: 'Check which crawl engines and features are configured in Serpent. Call this before starting a crawl to know if Bright Data proxy is available. Returns available engines and configuration status.',
      inputSchema: z.object({}),
    },
    async () => {
      const bdApiKey = await keytar.getPassword(KEYTAR_SERVICE, 'bd_api_key');
      const bdZone = await keytar.getPassword(KEYTAR_SERVICE, 'bd_zone');
      const brightdataConfigured = !!bdApiKey;

      const settings = {
        available_engines: brightdataConfigured ? ['local', 'brightdata'] : ['local'],
        brightdata_configured: brightdataConfigured,
        brightdata_zone: bdZone || 'web_unlocker1',
        default_engine: brightdataConfigured ? 'brightdata' : 'local',
        notes: brightdataConfigured
          ? 'Bright Data is configured. Use engine="brightdata" for JS-rendered pages and sites with bot protection.'
          : 'Bright Data is NOT configured. Only local crawling is available. To enable Bright Data, set your API key in Serpent Settings.',
      };
      return { content: [{ type: 'text' as const, text: JSON.stringify(settings, null, 2) }] };
    }
  );

  return server;
}

export function startMcpServer(orchestrator: CrawlOrchestrator): http.Server {
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const httpServer = http.createServer(async (req, res) => {
    // DNS rebinding protection
    if (!validateHost(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid Host header' }));
      return;
    }

    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const method = req.method?.toUpperCase();

    // ── POST: new or existing session ──────────────────────────────────────
    if (method === 'POST') {
      let body: unknown;
      try {
        body = await readBody(req);
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport | undefined;

      if (sessionId && sessions.has(sessionId)) {
        // Reuse existing session
        transport = sessions.get(sessionId);
      } else if (!sessionId && isInitializeRequest(body)) {
        // New session: create transport + server pair
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            // transport is captured in closure — guaranteed to be set before callback fires
            sessions.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport?.sessionId) {
            sessions.delete(transport.sessionId);
          }
        };
        const mcpServer = buildMcpServer(orchestrator);
        await mcpServer.connect(transport);
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request: missing or invalid session' }));
        return;
      }

      await transport!.handleRequest(req, res, body);
      return;
    }

    // ── GET: SSE stream for existing session ──────────────────────────────
    if (method === 'GET') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      await sessions.get(sessionId)!.handleRequest(req, res);
      return;
    }

    // ── DELETE: terminate session ──────────────────────────────────────────
    if (method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      const t = sessions.get(sessionId)!;
      await t.handleRequest(req, res);
      sessions.delete(sessionId);
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
  });

  // Retry binding if the port is still in TIME_WAIT from the previous
  // electronmon-triggered process restart. Retries up to 10 times, 500 ms apart.
  const MAX_RETRIES = 10;
  const RETRY_DELAY_MS = 500;
  let attempt = 0;
  const tryListen = () => {
    // Use `once` so listeners don't accumulate across retries.
    httpServer.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE' && attempt < MAX_RETRIES) {
        attempt++;
        console.warn(`[MCP] Port ${MCP_PORT} in use, retrying (${attempt}/${MAX_RETRIES})…`);
        // Wait for the server to fully close before re-attempting listen.
        httpServer.close(() => setTimeout(tryListen, RETRY_DELAY_MS));
      } else {
        console.error(`[MCP] Failed to bind port ${MCP_PORT}:`, err.message);
      }
    });
    httpServer.listen(MCP_PORT, '127.0.0.1', () => {
      console.log(`[MCP] Serpent MCP server running on http://127.0.0.1:${MCP_PORT}/mcp`);
    });
  };
  tryListen();

  return httpServer;
}
