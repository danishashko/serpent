import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// Override the 'electron' alias for this test file so that BrowserWindow
// returns a fully rendered HTML string from executeJavaScript().
vi.mock('electron', () => {
  const RENDERED_HTML =
    '<html><head><title>SPA Title</title></head><body>' +
    '<h1>SPA Heading</h1>' +
    '<a href="/about">about</a>' +
    '<a href="/contact">contact</a>' +
    '<p>Rendered by JS — this content was injected by a script after load.</p>' +
    '</body></html>';

  class BrowserWindow {
    show = false;
    webContents = {
      on: (event: string, handler: (...a: unknown[]) => void) => {
        // Fire did-navigate immediately so the crawler captures status 200.
        if (event === 'did-navigate') {
          setTimeout(() => handler({}, 'https://example.test/', 200), 0);
        }
      },
      setWindowOpenHandler: () => {},
      loadURL: () => Promise.resolve(),
      executeJavaScript: (expr: string) => {
        if (expr.includes('querySelectorAll')) return Promise.resolve(2); // anchors present
        if (expr.includes('outerHTML')) return Promise.resolve(RENDERED_HTML);
        return Promise.resolve('');
      },
    };
    isDestroyed = () => false;
    destroy = () => {};
  }

  const app = {
    getPath: () => '/tmp/serpent-test',
    on: () => {},
    quit: () => {},
    whenReady: () => Promise.resolve(),
  };
  const ipcMain = { handle: () => {}, on: () => {} };
  const dialog = { showSaveDialog: () => Promise.resolve({ canceled: true }) };
  const shell = { openExternal: () => Promise.resolve() };
  const session = { defaultSession: { webRequest: { onHeadersReceived: () => {} } } };

  return { app, ipcMain, BrowserWindow, dialog, shell, session, default: { app, ipcMain, BrowserWindow, dialog, shell, session } };
});

// Stub axios so the non-JS branch isn't accidentally exercised.
vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    head: vi.fn(),
  },
}));

let crawlPageLocal: typeof import('../main/crawler-local').crawlPageLocal;

beforeAll(async () => {
  // Reset the module registry so crawler-local.ts is re-loaded with the
  // electron mock defined above (vi.mock('electron', ...)) rather than
  // a potentially cached version from an earlier test file.
  vi.resetModules();
  ({ crawlPageLocal } = await import('../main/crawler-local'));
});

afterAll(() => {
  // Remove the jsrender electron mock and clear the module cache so that
  // any test files running AFTER this one (regardless of order) use the
  // global path-alias mock instead of the jsrender factory.
  // Use vi.doUnmock (non-hoisted) to avoid undoing the vi.mock() above.
  vi.doUnmock('electron');
  vi.resetModules();
});

describe('crawler-local JS render', () => {
  it('returns rendered HTML when jsRender:true', async () => {
    const result = await crawlPageLocal(
      'https://example.test/',
      'crawl-1',
      0,
      {
        startUrl: 'https://example.test/',
        maxUrls: 10,
        maxDepth: 2,
        respectRobots: false,
        followRedirects: true,
        sameOriginOnly: true,
        renderingMode: 'auto',
        userAgent: 'Serpent-Test',
        timeout: 5000,
        crawlerType: 'local',
        jsRender: true,
        extractTitles: true,
        extractMeta: true,
        extractHeadings: true,
        extractCanonicals: true,
        extractStructuredData: true,
        extractOpenGraph: true,
        extractTwitterCard: true,
        extractSecurityHeaders: true,
        extractImages: true,
        extractLinks: true,
        extractHreflang: true,
      } as never,
      'https://example.test'
    );

    expect(result.page.statusCode).toBe(200);
    expect(result.page.title).toBe('SPA Title');
    expect(result.page.h1).toBe('SPA Heading');
    // Confirm the JS-injected anchors were extracted.
    const targets = result.links.map((l) => l.targetUrl);
    expect(targets).toEqual(
      expect.arrayContaining(['https://example.test/about', 'https://example.test/contact']),
    );
  });
});
