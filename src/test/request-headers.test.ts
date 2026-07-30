import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => {
  const app = { getPath: () => '/tmp/serpent-test', on: () => {}, quit: () => {}, whenReady: () => Promise.resolve() };
  const BrowserWindow = class {};
  const session = { defaultSession: { webRequest: { onHeadersReceived: () => {} } } };
  return { app, BrowserWindow, session, ipcMain: { handle: () => {} }, default: { app, BrowserWindow, session } };
});

import { buildRequestHeaders, isSameAuthScope, DEFAULT_USER_AGENT } from '../main/crawler-local';
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

  it('drops Basic auth when a redirect leaves the credentialed host', () => {
    const c = cfg({ authUser: 'admin', authPass: 's3cret' });
    const expected = 'Basic ' + Buffer.from('admin:s3cret').toString('base64');
    // Same host (including a different path) keeps the credentials
    expect(buildRequestHeaders(c, 'http://a.test/deep', undefined, 'http://a.test/')['Authorization']).toBe(expected);
    // http → https upgrade on the same host keeps them
    expect(buildRequestHeaders(c, 'https://a.test/', undefined, 'http://a.test/')['Authorization']).toBe(expected);
    // Foreign host, subdomain, port change and https → http downgrade drop them
    expect(buildRequestHeaders(c, 'http://evil.test/', undefined, 'http://a.test/')['Authorization']).toBeUndefined();
    expect(buildRequestHeaders(c, 'http://sub.a.test/', undefined, 'http://a.test/')['Authorization']).toBeUndefined();
    expect(buildRequestHeaders(c, 'http://a.test:8080/', undefined, 'http://a.test/')['Authorization']).toBeUndefined();
    expect(buildRequestHeaders(c, 'http://a.test/', undefined, 'https://a.test/')['Authorization']).toBeUndefined();
  });

  it('scopes auth to the request URL itself when no scope is passed', () => {
    const c = cfg({ authUser: 'admin', authPass: 's3cret' });
    expect(buildRequestHeaders(c, 'http://anything.test/')['Authorization']).toBeDefined();
  });

  it('isSameAuthScope refuses unparseable URLs', () => {
    expect(isSameAuthScope('http://a.test/', 'not a url')).toBe(false);
    expect(isSameAuthScope('', 'http://a.test/')).toBe(false);
  });

  it('replays cookies from the jar for the matching host only', () => {
    const jar = new SimpleCookieJar();
    jar.storeFromResponse('http://a.test/', 'sid=42');
    expect(buildRequestHeaders(cfg({ enableCookies: true }), 'http://a.test/p', jar)['Cookie']).toBe('sid=42');
    expect(buildRequestHeaders(cfg({ enableCookies: true }), 'http://b.test/p', jar)['Cookie']).toBeUndefined();
  });
});
