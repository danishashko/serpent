/**
 * Functional tests for the MCP HTTP server (mcp-server.ts).
 *
 * Strategy:
 *  - Mock keytar (native Electron addon)
 *  - Mock database functions (avoid SQLite file creation)
 *  - Create a minimal CrawlOrchestrator stub
 *  - Start the HTTP server, hit /mcp with real MCP protocol messages
 *  - Assert session creation, tool listing, and clean shutdown
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as http from 'node:http';

// ── Mock keytar before mcp-server loads ────────────────────────────────────
vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn().mockResolvedValue(null),
    setPassword: vi.fn().mockResolvedValue(undefined),
    deletePassword: vi.fn().mockResolvedValue(false),
  },
}));

// ── Mock database module ────────────────────────────────────────────────────
vi.mock('../main/database', () => ({
  getAllCrawls: vi.fn().mockReturnValue([]),
  getPagesByCrawl: vi.fn().mockReturnValue([]),
  getLinksByCrawl: vi.fn().mockReturnValue([]),
  getImagesByCrawl: vi.fn().mockReturnValue([]),
  getLinkHealthSummary: vi.fn().mockReturnValue(null),
  initDatabase: vi.fn(),
}));

// ── Mock link-health ────────────────────────────────────────────────────────
// The suite runs with a shared module cache (isolate: false). Loading the real
// link-health here would cache it bound to the mocked database above and
// break link-health.test.ts, which needs it bound to the real one.
vi.mock('../main/link-health', () => ({
  getPostCrawlStage: vi.fn().mockReturnValue(null),
}));

// ── Import after mocks are in place ────────────────────────────────────────
import { startMcpServer } from '../main/mcp-server';
import { getPagesByCrawl, getLinksByCrawl, getImagesByCrawl, getLinkHealthSummary } from '../main/database';

// ── Minimal CrawlOrchestrator stub ─────────────────────────────────────────
function makeMockOrchestrator() {
  return {
    startCrawl: vi.fn().mockResolvedValue('test-crawl-id'),
    stop: vi.fn(),
    getStatus: vi.fn().mockReturnValue('idle'),
    getCrawlId: vi.fn().mockReturnValue(null),
    getCompletedCount: vi.fn().mockReturnValue(0),
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as import('../main/crawler-orchestrator').CrawlOrchestrator;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function parseSseOrJson(body: string, contentType: string): unknown {
  if (contentType.includes('text/event-stream')) {
    // Extract the first `data:` line from SSE response
    const match = body.match(/^data: (.+)$/m);
    if (match) return JSON.parse(match[1]);
    return null;
  }
  return JSON.parse(body);
}

function postMcp(
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: 7777,
      path: '/mcp',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(data),
        Host: 'localhost',
        ...headers,
      },
    };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c: Buffer) => { raw += c.toString(); });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────
describe('MCP HTTP server', () => {
  let server: http.Server;

  beforeAll(() => {
    const orch = makeMockOrchestrator();
    server = startMcpServer(orch);
    // Give the server a moment to bind
    return new Promise<void>((resolve) => {
      if (server.listening) { resolve(); return; }
      server.once('listening', resolve);
    });
  });

  afterAll(() => {
    return new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('rejects requests with a disallowed Host header (DNS rebinding protection)', async () => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    const res = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: '127.0.0.1', port: 7777, path: '/mcp', method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json, text/event-stream',
            'Content-Length': Buffer.byteLength(data),
            // Simulate a DNS rebinding attack with a spoofed Host header
            Host: 'evil.attacker.com',
          },
        },
        (r) => { let b = ''; r.on('data', (c: Buffer) => { b += c; }); r.on('end', () => resolve({ status: r.statusCode ?? 0, body: b })); }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown paths', async () => {
    const r = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        { hostname: '127.0.0.1', port: 7777, path: '/unknown', method: 'GET',
          headers: { Host: 'localhost', Accept: 'application/json, text/event-stream' } },
        (res) => { res.resume(); resolve({ status: res.statusCode ?? 0 }); }
      );
      req.on('error', reject);
      req.end();
    });
    expect(r.status).toBe(404);
  });

  it('accepts MCP initialize and returns a session ID', async () => {
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      },
    };

    const res = await postMcp(initRequest);
    expect(res.status).toBe(200);

    // MCP SDK sets mcp-session-id header on initialize response
    expect(res.headers['mcp-session-id']).toBeTruthy();
    const sessionId = res.headers['mcp-session-id'] as string;
    expect(sessionId.length).toBeGreaterThan(10);

    // Response body should be a valid JSON-RPC response with serverInfo
    const json = parseSseOrJson(res.body, res.headers['content-type'] ?? '') as Record<string, unknown>;
    const result = json?.result as Record<string, unknown>;
    const serverInfo = result?.serverInfo as Record<string, unknown>;
    expect(serverInfo?.name).toBe('serpent');
  });

  it('can list tools after session initialization', async () => {
    // First: initialize to get a session ID
    const initRequest = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0' },
      },
    };
    const initRes = await postMcp(initRequest);
    expect(initRes.status).toBe(200);
    const sessionId = initRes.headers['mcp-session-id'] as string;
    expect(sessionId).toBeTruthy();

    // Then: list tools
    const listRequest = {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    };
    const listRes = await postMcp(listRequest, { 'mcp-session-id': sessionId });
    expect(listRes.status).toBe(200);

    const json = parseSseOrJson(listRes.body, listRes.headers['content-type'] ?? '') as Record<string, unknown>;
    const result = json?.result as Record<string, { name: string }[]>;
    const tools: Array<{ name: string }> = result?.tools ?? [];
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain('start_crawl');
    expect(toolNames).toContain('stop_crawl');
    expect(toolNames).toContain('get_crawl_status');
    expect(toolNames).toContain('list_crawls');
    expect(toolNames).toContain('get_results');
    expect(toolNames).toContain('get_issues');
    expect(toolNames).toContain('export_csv');
  });

  it('get_crawl_status returns idle status from mock orchestrator', async () => {
    // Initialize
    const initRes = await postMcp({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    const sessionId = initRes.headers['mcp-session-id'] as string;

    // Call get_crawl_status
    const callRes = await postMcp({
      jsonrpc: '2.0', id: 2, method: 'tools/call',
      params: { name: 'get_crawl_status', arguments: {} },
    }, { 'mcp-session-id': sessionId });
    expect(callRes.status).toBe(200);

    const json = parseSseOrJson(callRes.body, callRes.headers['content-type'] ?? '') as Record<string, unknown>;
    const result = json?.result as Record<string, Array<{ text: string }>>;
    const text = result?.content?.[0]?.text ?? '';
    const data = JSON.parse(text) as { status: string; crawl_id: string | null; completed_pages: number };
    expect(data.status).toBe('idle');
    expect(data.crawl_id).toBeNull();
    expect(data.completed_pages).toBe(0);
  });

  // ── Helpers for the tool-behaviour tests below ─────────────────────────────
  async function initSession(): Promise<string> {
    const initRes = await postMcp({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
    });
    return initRes.headers['mcp-session-id'] as string;
  }

  async function callTool(sessionId: string, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const res = await postMcp(
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } },
      { 'mcp-session-id': sessionId }
    );
    const json = parseSseOrJson(res.body, res.headers['content-type'] ?? '') as Record<string, unknown>;
    const result = json?.result as { content?: Array<{ text: string }>; isError?: boolean };
    return { isError: result?.isError === true, text: result?.content?.[0]?.text ?? '' };
  }

  it('start_crawl refuses link-local / cloud-metadata addresses on any engine', async () => {
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'start_crawl', { url: 'http://169.254.169.254/', engine: 'local', mode: 'list' });
    expect(r.isError).toBe(true);
    expect(r.text.toLowerCase()).toContain('metadata');
  });

  it('start_crawl still allows localhost on the local engine (dev-site crawling)', async () => {
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'start_crawl', { url: 'http://127.0.0.1:3000/', engine: 'local', mode: 'list' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('Crawl started');
  });

  it('get_issues caps each severity list to `limit` while reporting true counts', async () => {
    // 150 pages that each return 200 with no <title> → 150 "Missing title" criticals.
    const pages = Array.from({ length: 150 }, (_, i) => ({
      url: `http://example.com/p${i}`,
      statusCode: 200, title: null, titleLength: null,
      metaDescription: `desc ${i}`, isIndexable: true,
      h1: 'H', h1Count: 1, responseTimeMs: 100, canonicalUrl: null,
      ogImage: 'x', hasStructuredData: true, wordCount: 500, h2Count: 1,
    }));
    vi.mocked(getPagesByCrawl).mockReturnValueOnce(pages as unknown as ReturnType<typeof getPagesByCrawl>);
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'get_issues', { crawl_id: 'x', limit: 10 });
    const data = JSON.parse(r.text) as { critical_count: number; truncated: boolean; issues: { critical: unknown[] } };
    expect(data.critical_count).toBe(150);
    expect(data.issues.critical.length).toBe(10);
    expect(data.truncated).toBe(true);
  });

  it('get_issues gates all page-content checks for non-HTML resources (PDF/JPEG)', async () => {
    const pages = [
      {
        // PDF: fields set so missing-title (critical), title-length, missing
        // meta description, missing H1, missing OG image, no structured data
        // and thin content would ALL fire without the content-type gate.
        url: 'http://example.com/doc.pdf', statusCode: 200, contentType: 'application/pdf',
        title: null, titleLength: 5, metaDescription: null, isIndexable: true,
        h1: null, h1Count: 0, responseTimeMs: 100, canonicalUrl: null,
        ogImage: null, hasStructuredData: false, wordCount: 50, h2Count: null,
      },
      {
        // JPEG: otherwise-clean content, but h1Count > 1 and a long page with
        // no H2 would trip multiple-H1 / no-H2-on-long-page without the gate.
        url: 'http://example.com/photo.jpg', statusCode: 200, contentType: 'image/jpeg',
        title: 'Photo', titleLength: 20, metaDescription: 'A description here that is fine.',
        isIndexable: true, h1: 'Something', h1Count: 3, responseTimeMs: 100, canonicalUrl: null,
        ogImage: 'https://example.com/og.png', hasStructuredData: true, wordCount: 600, h2Count: 0,
      },
    ];
    vi.mocked(getPagesByCrawl).mockReturnValueOnce(pages as unknown as ReturnType<typeof getPagesByCrawl>);
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'get_issues', { crawl_id: 'x' });
    const data = JSON.parse(r.text) as {
      critical_count: number;
      issues: { critical: Array<{ details: string }>; warning: Array<{ details: string }>; info: Array<{ details: string }> };
    };
    expect(data.critical_count).toBe(0);
    const allDetails = [...data.issues.critical, ...data.issues.warning, ...data.issues.info].map((i) => i.details);
    const forbidden = [
      'Missing title',
      'Title length',
      'Missing meta description',
      'Missing H1',
      'Multiple H1 tags',
      'Missing OG image',
      'No structured data',
      'Thin content:',
      'No H2 headings on a long page',
    ];
    for (const phrase of forbidden) {
      expect(allDetails.some((detail) => detail.includes(phrase))).toBe(false);
    }
  });

  it('get_issues reports a redirect as a redirect, not as a non-indexable page', async () => {
    const base = {
      title: 'A page title that is fine', titleLength: 25, metaDescription: 'A description here that is fine.',
      h1: 'H', h1Count: 1, responseTimeMs: 100, ogImage: 'x', hasStructuredData: true, wordCount: 500, h2Count: 1,
      contentType: 'text/html',
    };
    const pages = [
      // 301: isIndexable is false, but the finding is the redirect.
      { ...base, url: 'http://example.com/old', statusCode: 301, isIndexable: false, canonicalUrl: null, contentType: null },
      // Canonicalised elsewhere: already reported as "Canonicalized to …".
      { ...base, url: 'http://example.com/dup', statusCode: 200, isIndexable: false, canonicalUrl: 'http://example.com/main' },
      // noindex on a 200: the one real "non-indexable" warning.
      { ...base, url: 'http://example.com/hidden', statusCode: 200, isIndexable: false, canonicalUrl: 'http://example.com/hidden' },
    ];
    vi.mocked(getPagesByCrawl).mockReturnValueOnce(pages as unknown as ReturnType<typeof getPagesByCrawl>);
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'get_issues', { crawl_id: 'x' });
    const data = JSON.parse(r.text) as { issues: { warning: Array<{ url: string; details: string }>; info: Array<{ url: string; details: string }> } };
    const nonIndexable = data.issues.warning.filter((i) => i.details.includes('non-indexable')).map((i) => i.url);
    expect(nonIndexable).toEqual(['http://example.com/hidden']);
    expect(data.issues.info).toContainEqual({ url: 'http://example.com/old', details: 'Redirect (HTTP 301)' });
    expect(data.issues.info.some((i) => i.url === 'http://example.com/dup' && i.details.startsWith('Canonicalized to'))).toBe(true);
  });

  it('get_issues names broken link, image and sitemap findings per page', async () => {
    const base = {
      statusCode: 200, contentType: 'text/html', title: 'A page title that is fine', titleLength: 25,
      metaDescription: 'A description here that is fine.', isIndexable: true, h1: 'H', h1Count: 1,
      responseTimeMs: 100, ogImage: 'x', hasStructuredData: true, wordCount: 500, h2Count: 1,
    };
    const pages = [
      { ...base, url: 'http://example.com/', canonicalUrl: 'http://example.com/', brokenOutlinks: 1, redirectOutlinks: 1, brokenExternalOutlinks: 1, brokenImages: 1, inSitemap: 1 },
      { ...base, url: 'http://example.com/unlisted', canonicalUrl: 'http://example.com/unlisted', inSitemap: 0 },
      { ...base, url: 'http://example.com/hidden', canonicalUrl: 'http://example.com/hidden', isIndexable: false, inSitemap: 1 },
    ];
    vi.mocked(getPagesByCrawl).mockReturnValueOnce(pages as unknown as ReturnType<typeof getPagesByCrawl>);
    vi.mocked(getLinksByCrawl).mockReturnValueOnce([
      { sourceUrl: 'http://example.com/', targetUrl: 'http://example.com/gone', isInternal: true, statusCode: 404 },
      { sourceUrl: 'http://example.com/', targetUrl: 'http://example.com/moved', isInternal: true, statusCode: 301 },
      { sourceUrl: 'http://example.com/', targetUrl: 'https://partner.test/dead', isInternal: false, statusCode: 0 },
      { sourceUrl: 'http://example.com/', targetUrl: 'https://waf.test/', isInternal: false, statusCode: 403 },
    ] as unknown as ReturnType<typeof getLinksByCrawl>);
    vi.mocked(getImagesByCrawl).mockReturnValueOnce([
      { pageUrl: 'http://example.com/', imageUrl: 'http://example.com/a.png', statusCode: 404 },
      { pageUrl: 'http://example.com/', imageUrl: 'http://example.com/b.png', statusCode: 403 },
    ] as unknown as ReturnType<typeof getImagesByCrawl>);
    vi.mocked(getLinkHealthSummary).mockReturnValueOnce({ state: 'done' });

    const sessionId = await initSession();
    const r = await callTool(sessionId, 'get_issues', { crawl_id: 'x' });
    const data = JSON.parse(r.text) as {
      post_crawl_checks: { state: string };
      issues: { warning: Array<{ url: string; details: string }>; info: Array<{ url: string; details: string }> };
    };
    expect(data.post_crawl_checks.state).toBe('done');
    const warn = data.issues.warning.map((i) => `${i.url} :: ${i.details}`);
    const info = data.issues.info.map((i) => `${i.url} :: ${i.details}`);
    expect(warn).toContain('http://example.com/ :: Links to 1 broken internal URL(s): http://example.com/gone (404)');
    expect(warn).toContain('http://example.com/ :: Links to 1 broken external URL(s): https://partner.test/dead (unreachable)');
    expect(warn).toContain('http://example.com/ :: 1 broken image(s): http://example.com/a.png (404)');
    expect(info).toContain('http://example.com/ :: Links to 1 redirecting internal URL(s): http://example.com/moved (301)');
    expect(info).toContain('http://example.com/unlisted :: Indexable page missing from the XML sitemap');
    expect(warn.some((w) => w.startsWith('http://example.com/hidden :: Listed in the XML sitemap but not indexable'))).toBe(true);
    // A 403 from a third party is never reported as broken.
    expect(warn.join('\n')).not.toContain('waf.test');
    expect(warn.join('\n')).not.toContain('b.png');
  });

  it('get_images counts alt="" as decorative, not missing', async () => {
    vi.mocked(getImagesByCrawl).mockReturnValueOnce([
      { pageUrl: 'http://example.com/', imageUrl: 'http://example.com/none.png', altText: null },
      { pageUrl: 'http://example.com/', imageUrl: 'http://example.com/spacer.png', altText: '' },
      { pageUrl: 'http://example.com/', imageUrl: 'http://example.com/photo.png', altText: 'A photo' },
    ] as unknown as ReturnType<typeof getImagesByCrawl>);
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'get_images', { crawl_id: 'x', missing_alt_only: true });
    const data = JSON.parse(r.text) as { missing_alt_count: number; decorative_alt_count: number; images: Array<{ src: string }> };
    expect(data.missing_alt_count).toBe(1);
    expect(data.decorative_alt_count).toBe(1);
    expect(data.images.map((i) => i.src)).toEqual(['http://example.com/none.png']);
  });

  it('export_csv neutralizes spreadsheet formula injection in page fields', async () => {
    const pages = [{
      url: 'http://example.com/evil',
      statusCode: 200,
      title: '=HYPERLINK("http://evil.example","click")',
      titleLength: 42, metaDescription: '+1234567890', metaDescLength: 11,
      h1: '@cmd', h2: null, h1Count: 1, h2Count: 0, wordCount: 500,
      canonicalUrl: null, isCanonicalized: false, isIndexable: true,
      responseTimeMs: 100, pageSizeBytes: 1000, crawlDepth: 0, costUsd: 0,
    }];
    vi.mocked(getPagesByCrawl).mockReturnValueOnce(pages as unknown as ReturnType<typeof getPagesByCrawl>);
    const sessionId = await initSession();
    const r = await callTool(sessionId, 'export_csv', { crawl_id: 'x' });
    const dataRow = r.text.split('\n')[1];
    expect(dataRow).toContain(`"'=HYPERLINK("`);
    expect(dataRow).toContain(`'+1234567890`);
    expect(dataRow).toContain(`'@cmd`);
    expect(dataRow).not.toMatch(/(^|,)=HYPERLINK/);
  });
});
