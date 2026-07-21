import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => {
  const app = { getPath: () => '/tmp/serpent-test', on: () => {}, quit: () => {}, whenReady: () => Promise.resolve() };
  const BrowserWindow = class {};
  const session = { defaultSession: { webRequest: { onHeadersReceived: () => {} } } };
  return { app, BrowserWindow, session, ipcMain: { handle: () => {} }, default: { app, BrowserWindow, session } };
});

import { buildRequestHeaders, DEFAULT_USER_AGENT } from '../main/crawler-local';
import { SimpleCookieJar } from '../main/crawl-filters';
import type { CrawlConfig } from '../types/index';

function cfg(over: Partial<CrawlConfig> = {}): CrawlConfig {
  return {
    startUrl: 'http://a.test/', mode: 'spider', engine: 'local', storageMode: 'database',
    maxUrls: 10, maxDepth: 3, concurrency: 1, respectRobots: false, followRedirects: true,
    restrictToSubdomain: false, timeout: 5000, extractTitles: true, extractMeta: true,
    extractHeadings: true, extractImages: false, extractLinks: true, extractCanonicals: true,
    maxCostUsd: 0, ...over,
  };
}

describe('buildRequestHeaders', () => {
  it('uses the default UA when none configured, custom UA when set', () => {
    expect(buildRequestHeaders(cfg(), 'http://a.test/')['User-Agent']).toBe(DEFAULT_USER_AGENT);
    expect(buildRequestHeaders(cfg({ userAgent: 'Googlebot/2.1' }), 'http://a.test/')['User-Agent']).toBe('Googlebot/2.1');
    expect(buildRequestHeaders(cfg({ userAgent: '   ' }), 'http://a.test/')['User-Agent']).toBe(DEFAULT_USER_AGENT);
  });

  it('merges custom headers, skipping unnamed rows', () => {
    const h = buildRequestHeaders(cfg({ customHeaders: [
      { name: 'X-Test', value: 'yes' },
      { name: '', value: 'ignored' },
    ] }), 'http://a.test/');
    expect(h['X-Test']).toBe('yes');
    expect(Object.values(h)).not.toContain('ignored');
  });

  it('adds HTTP Basic Authorization when authUser is set', () => {
    const h = buildRequestHeaders(cfg({ authUser: 'admin', authPass: 's3cret' }), 'http://a.test/');
    expect(h['Authorization']).toBe('Basic ' + Buffer.from('admin:s3cret').toString('base64'));
    expect(buildRequestHeaders(cfg(), 'http://a.test/')['Authorization']).toBeUndefined();
  });

  it('replays cookies from the jar for the matching host only', () => {
    const jar = new SimpleCookieJar();
    jar.storeFromResponse('http://a.test/', 'sid=42');
    expect(buildRequestHeaders(cfg({ enableCookies: true }), 'http://a.test/p', jar)['Cookie']).toBe('sid=42');
    expect(buildRequestHeaders(cfg({ enableCookies: true }), 'http://b.test/p', jar)['Cookie']).toBeUndefined();
  });
});
