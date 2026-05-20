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
  initDatabase: vi.fn(),
}));

// ── Import after mocks are in place ────────────────────────────────────────
import { startMcpServer } from '../main/mcp-server';

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
});
