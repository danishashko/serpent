import { describe, it, expect } from 'vitest';
import { analyzeLlmsTxt, parseLlmsTxt, scoreLlmsTxt, type LlmsTxtDeps } from '../main/llms-txt';
import type { PageData, LlmsTxtIssue } from '../types/index';

// Minimal PageData — the analyzer only reads `url`.
function page(url: string): PageData {
  return { url } as PageData;
}

/** Stub fetch backed by a path → response map. Anything unmapped is a 404. */
function deps(routes: Record<string, { status?: number; body?: string; contentType?: string }>): LlmsTxtDeps {
  return {
    async fetch(url: string) {
      const r = routes[url];
      if (!r) return { status: 404, body: 'Not found', contentType: 'text/plain' };
      return {
        status: r.status ?? 200,
        body: r.body ?? '',
        contentType: r.contentType ?? 'text/markdown',
      };
    },
  };
}

const WELL_FORMED = `# Acme Docs

> Everything you need to integrate Acme.

Some intro prose about the product.

## Docs

- [Quickstart](https://acme.test/quickstart): Get running in five minutes
- [API Reference](https://acme.test/api): Every endpoint

## Optional

- [Changelog](https://acme.test/changelog)
`;

describe('parseLlmsTxt', () => {
  it('pulls out the title, summary and sections', () => {
    const p = parseLlmsTxt(WELL_FORMED);
    expect(p.title).toBe('Acme Docs');
    expect(p.summary).toBe('Everything you need to integrate Acme.');
    expect(p.sections.map(s => s.name)).toEqual(['Docs', 'Optional']);
    expect(p.sections[0].links).toHaveLength(2);
    expect(p.sections[0].links[0]).toEqual({
      name: 'Quickstart',
      url: 'https://acme.test/quickstart',
      notes: 'Get running in five minutes',
    });
  });

  it('treats a link with no notes as notes: null', () => {
    const p = parseLlmsTxt(WELL_FORMED);
    expect(p.sections[1].links[0].notes).toBeNull();
  });

  it('joins a multi-line blockquote summary', () => {
    const p = parseLlmsTxt('# T\n\n> line one\n> line two\n');
    expect(p.summary).toBe('line one line two');
  });

  it('does not treat a blockquote after content as the summary', () => {
    const p = parseLlmsTxt('# T\n\n## S\n\n> not a summary\n');
    expect(p.summary).toBeNull();
  });

  it('records a second H1', () => {
    expect(parseLlmsTxt('# One\n# Two\n').multipleH1).toBe(true);
    expect(parseLlmsTxt('# One\n').multipleH1).toBe(false);
  });

  it('flags headings deeper than H2', () => {
    expect(parseLlmsTxt('# T\n### Deep\n').deeperHeadings).toBe(true);
  });

  it('parks links that appear before any H2 in an unnamed section', () => {
    const p = parseLlmsTxt('# T\n\n- [A](https://a.test/)\n');
    expect(p.sections).toHaveLength(1);
    expect(p.sections[0].name).toBe('');
    expect(p.sections[0].links[0].url).toBe('https://a.test/');
  });

  it('counts bullets under an H2 that are not markdown links', () => {
    const p = parseLlmsTxt('# T\n\n## S\n\n- just text, no link\n- [Real](https://a.test/)\n');
    expect(p.malformedItems).toBe(1);
    expect(p.sections[0].links).toHaveLength(1);
  });

  it('handles an empty file without throwing', () => {
    const p = parseLlmsTxt('');
    expect(p.title).toBeNull();
    expect(p.sections).toEqual([]);
  });
});

describe('analyzeLlmsTxt — file present', () => {
  it('reports a clean file with a high score and no critical issues', async () => {
    const d = deps({
      'https://acme.test/llms.txt': { body: WELL_FORMED },
      'https://acme.test/llms-full.txt': { body: '# Acme Docs\n\nfull text' },
    });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);

    expect(r.found).toBe(true);
    expect(r.title).toBe('Acme Docs');
    expect(r.linkCount).toBe(3);
    expect(r.optionalLinkCount).toBe(1);
    expect(r.hasLlmsFullTxt).toBe(true);
    expect(r.issues.filter(i => i.severity === 'critical')).toHaveLength(0);
    expect(r.score).toBe(100);
  });

  it('flags a missing llms-full.txt as an opportunity, not a failure', async () => {
    const d = deps({ 'https://acme.test/llms.txt': { body: WELL_FORMED } });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);
    expect(r.hasLlmsFullTxt).toBe(false);
    expect(r.issues.some(i => i.severity === 'opportunity' && /llms-full/.test(i.message))).toBe(true);
    expect(r.found).toBe(true);
  });

  it('flags a missing H1 and missing summary', async () => {
    const d = deps({ 'https://acme.test/llms.txt': { body: '## Docs\n\n- [A](https://acme.test/a)\n' } });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);
    expect(r.issues.some(i => /No H1 title/.test(i.message))).toBe(true);
    expect(r.issues.some(i => /No blockquote summary/.test(i.message))).toBe(true);
  });

  it('flags an HTML response served at /llms.txt', async () => {
    const d = deps({ 'https://acme.test/llms.txt': { body: '<!doctype html><html><body>SPA</body></html>' } });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);
    expect(r.issues.some(i => i.severity === 'critical' && /HTML, not markdown/.test(i.message))).toBe(true);
  });

  it('does not count an HTML llms-full.txt as present', async () => {
    const d = deps({
      'https://acme.test/llms.txt': { body: WELL_FORMED },
      'https://acme.test/llms-full.txt': { body: '<!doctype html><html></html>' },
    });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);
    expect(r.hasLlmsFullTxt).toBe(false);
  });

  it('flags relative links', async () => {
    const body = '# T\n\n> S\n\n## Docs\n\n- [A](/relative)\n';
    const d = deps({ 'https://acme.test/llms.txt': { body } });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);
    expect(r.issues.some(i => /relative/.test(i.message))).toBe(true);
  });
});

describe('analyzeLlmsTxt — crawl coverage', () => {
  it('separates links the crawl reached from those it did not', async () => {
    const d = deps({ 'https://acme.test/llms.txt': { body: WELL_FORMED } });
    const pages = [page('https://acme.test/quickstart'), page('https://acme.test/api')];
    const r = await analyzeLlmsTxt('https://acme.test/', pages, d);

    expect(r.linksCrawled).toBe(2);
    expect(r.linksNotCrawled).toEqual(['https://acme.test/changelog']);
    expect(r.issues.some(i => /not reached by this crawl/.test(i.message))).toBe(true);
  });

  it('ignores trailing-slash and fragment differences when matching', async () => {
    const body = '# T\n\n> S\n\n## Docs\n\n- [A](https://acme.test/docs/)\n';
    const d = deps({ 'https://acme.test/llms.txt': { body } });
    const r = await analyzeLlmsTxt('https://acme.test/', [page('https://acme.test/docs')], d);
    expect(r.linksCrawled).toBe(1);
    expect(r.linksNotCrawled).toEqual([]);
  });

  it('skips coverage entirely when no pages are supplied', async () => {
    const d = deps({ 'https://acme.test/llms.txt': { body: WELL_FORMED } });
    const r = await analyzeLlmsTxt('https://acme.test/', [], d);
    expect(r.linksCrawled).toBe(0);
    expect(r.linksNotCrawled).toEqual([]);
    expect(r.issues.some(i => /not reached by this crawl/.test(i.message))).toBe(false);
  });
});

describe('analyzeLlmsTxt — file absent', () => {
  it('returns found:false with an opportunity issue on 404', async () => {
    const r = await analyzeLlmsTxt('https://acme.test/', [], deps({}));
    expect(r.found).toBe(false);
    expect(r.statusCode).toBe(404);
    expect(r.score).toBe(0);
    expect(r.issues[0].severity).toBe('opportunity');
  });

  it('derives the origin from a deep page URL', async () => {
    const d = deps({ 'https://acme.test/llms.txt': { body: WELL_FORMED } });
    const r = await analyzeLlmsTxt('https://acme.test/blog/post/1?a=b', [], d);
    expect(r.url).toBe('https://acme.test/llms.txt');
    expect(r.found).toBe(true);
  });

  it('surfaces a transport failure as an error rather than throwing', async () => {
    const failing: LlmsTxtDeps = {
      async fetch() { throw new Error('ECONNREFUSED'); },
    };
    const r = await analyzeLlmsTxt('https://acme.test/', [], failing);
    expect(r.found).toBe(false);
    expect(r.error).toBe('ECONNREFUSED');
    expect(r.issues[0].severity).toBe('warning');
  });
});

describe('scoreLlmsTxt', () => {
  const iss = (severity: LlmsTxtIssue['severity']): LlmsTxtIssue => ({ severity, message: '', recommendation: '' });

  it('penalises a critical issue more than an opportunity', () => {
    expect(scoreLlmsTxt([iss('critical')])).toBeLessThan(scoreLlmsTxt([iss('opportunity')]));
  });

  it('returns 100 for no issues and floors at 0', () => {
    expect(scoreLlmsTxt([])).toBe(100);
    expect(scoreLlmsTxt(Array(20).fill(iss('critical')))).toBe(0);
  });
});
