// Uncrawlable link detection.
//
// Links that exist in the HTML but do not follow Google's crawlable-link
// guidance: https://developers.google.com/search/docs/crawling-indexing/links-crawlable
//
// Google will usually still *find* these (it parses anything that looks like a
// link), but they are not guaranteed to be followed or to pass link signals, so
// they should not be relied on for discovery or internal linking.
//
// Shared by the local and Bright Data crawlers so both engines report the same
// thing. These links are recorded for reporting only — they are never enqueued
// for crawling.

import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import { v4 as uuidv4 } from 'uuid';
import { LinkData, UncrawlableReason } from '../types/index';

/** Elements where an href attribute is legitimate and not a link-crawlability problem. */
const HREF_IS_VALID_ON = new Set(['a', 'link', 'area', 'base']);

/** True when an anchor's href cannot be followed by a crawler. */
function isDeadHref(href: string | undefined): boolean {
  if (!href) return true;
  const h = href.trim();
  return h === '' || h === '#' || h.toLowerCase().startsWith('javascript:');
}

/**
 * Extract links that appear in the HTML but do not conform to crawlable-link
 * best practice. `pageUrl` is the page being parsed; `baseOrigin` its origin.
 */
export function extractUncrawlableLinks(
  $: CheerioAPI,
  crawlId: string,
  pageUrl: string,
  baseOrigin: string,
): LinkData[] {
  const out: LinkData[] = [];

  const add = (el: Element, rawHref: string, reason: UncrawlableReason): void => {
    // Resolve when the value is a real URL so the Links tab shows something
    // useful; otherwise keep the raw attribute text (e.g. "javascript:goTo('x')").
    let targetUrl = rawHref;
    // A handler we cannot resolve is on-site navigation by nature, so it counts
    // as an internal outlink rather than being dropped from the internal report.
    let isInternal = true;
    try {
      const resolved = new URL(rawHref, pageUrl);
      if (resolved.protocol === 'http:' || resolved.protocol === 'https:') {
        resolved.hash = '';
        targetUrl = resolved.toString();
        isInternal = resolved.origin === baseOrigin;
      }
    } catch {
      // Not a resolvable URL — keep the raw text and treat it as internal.
    }
    out.push({
      id: uuidv4(),
      crawlId,
      sourceUrl: pageUrl,
      targetUrl,
      isInternal,
      anchorText: $(el).text().trim() || null,
      relAttr: $(el).attr('rel') || null,
      crawlability: 'uncrawlable',
      uncrawlableReason: reason,
    });
  };

  // <div href="…">, <span href="…"> — href on an element that is not a link.
  $('[href]').each((_i, el) => {
    const tag = (el as Element).tagName?.toLowerCase();
    if (!tag || HREF_IS_VALID_ON.has(tag)) return;
    const href = $(el).attr('href')?.trim();
    if (!href) return;
    add(el as Element, href, 'href_on_non_anchor');
  });

  // <a href="javascript:…">
  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href')?.trim() ?? '';
    if (href.toLowerCase().startsWith('javascript:')) {
      add(el as Element, href, 'javascript_href');
    }
  });

  // <a onclick="…"> with no crawlable href. Anchors that have both a real href
  // and an onclick are fine — the href is what gets crawled.
  $('a[onclick]').each((_i, el) => {
    const href = $(el).attr('href')?.trim();
    if (!isDeadHref(href)) return;
    // javascript: hrefs are already reported above; don't double-count.
    if (href && href.toLowerCase().startsWith('javascript:')) return;
    add(el as Element, $(el).attr('onclick')?.trim() || '#', 'onclick_only');
  });

  return out;
}
