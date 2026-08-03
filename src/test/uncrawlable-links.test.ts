import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { extractUncrawlableLinks } from '../main/uncrawlable-links';

const PAGE = 'https://example.com/page';
const ORIGIN = 'https://example.com';

function extract(html: string) {
  return extractUncrawlableLinks(cheerio.load(html), 'crawl-1', PAGE, ORIGIN);
}

describe('extractUncrawlableLinks', () => {
  it('flags href on a non-anchor element', () => {
    const links = extract('<div href="/products">Products</div><span href="/about">About</span>');
    expect(links).toHaveLength(2);
    expect(links.every(l => l.uncrawlableReason === 'href_on_non_anchor')).toBe(true);
    expect(links.map(l => l.targetUrl).sort()).toEqual([
      'https://example.com/about',
      'https://example.com/products',
    ]);
  });

  it('flags javascript: hrefs and keeps the raw handler text', () => {
    const links = extract(`<a href="javascript:goTo('products')">Products</a>`);
    expect(links).toHaveLength(1);
    expect(links[0].uncrawlableReason).toBe('javascript_href');
    expect(links[0].targetUrl).toBe(`javascript:goTo('products')`);
    expect(links[0].anchorText).toBe('Products');
  });

  it('flags onclick anchors that have no usable href', () => {
    const links = extract(`<a onclick="goto('https://example.com/x')">Go</a>`);
    expect(links).toHaveLength(1);
    expect(links[0].uncrawlableReason).toBe('onclick_only');
  });

  it('treats "#" as no usable href', () => {
    const links = extract(`<a href="#" onclick="nav()">Go</a>`);
    expect(links).toHaveLength(1);
    expect(links[0].uncrawlableReason).toBe('onclick_only');
  });

  it('leaves a normal anchor alone, even with an onclick', () => {
    const links = extract('<a href="/real" onclick="track()">Real</a><a href="/plain">Plain</a>');
    expect(links).toHaveLength(0);
  });

  it('does not flag href on link, area or base elements', () => {
    const links = extract(`
      <link rel="canonical" href="https://example.com/page">
      <base href="https://example.com/">
      <area href="/map-region">
    `);
    expect(links).toHaveLength(0);
  });

  it('does not double-count a javascript: href that also has onclick', () => {
    const links = extract(`<a href="javascript:void(0)" onclick="nav()">Go</a>`);
    expect(links).toHaveLength(1);
    expect(links[0].uncrawlableReason).toBe('javascript_href');
  });

  it('marks an off-origin uncrawlable link as external', () => {
    const links = extract('<div href="https://other.com/x">Other</div>');
    expect(links).toHaveLength(1);
    expect(links[0].isInternal).toBe(false);
  });

  it('treats an unresolvable handler as an internal outlink', () => {
    // A JS handler is on-site navigation by nature, so it counts toward the
    // page's uncrawlable *internal* outlink total rather than being dropped.
    const links = extract(`<a href="javascript:goTo('x')">Go</a>`);
    expect(links[0].isInternal).toBe(true);
  });

  it('carries crawlId, sourceUrl and rel through', () => {
    const links = extract('<div href="/x" rel="nofollow">X</div>');
    expect(links[0].crawlId).toBe('crawl-1');
    expect(links[0].sourceUrl).toBe(PAGE);
    expect(links[0].relAttr).toBe('nofollow');
    expect(links[0].crawlability).toBe('uncrawlable');
  });

  it('returns nothing for a clean page', () => {
    const links = extract('<html><body><a href="/a">A</a><img src="/i.png"></body></html>');
    expect(links).toHaveLength(0);
  });
});
