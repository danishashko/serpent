// URL filtering, rewriting, and cookie utilities for the crawl frontier.
// Pure module — no Electron/DB imports — so both the orchestrator and unit
// tests can use it directly.

import { URL } from 'url';

/** Compile user-supplied regex strings, silently dropping invalid ones. */
export function compilePatterns(patterns?: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const raw of patterns ?? []) {
    const src = raw.trim();
    if (!src) continue;
    try {
      out.push(new RegExp(src, 'i'));
    } catch {
      console.warn(`[FILTERS] invalid pattern skipped: ${src}`);
    }
  }
  return out;
}

/**
 * Include/exclude gate for discovered URLs. Exclude wins over include.
 * With include patterns present, a URL must match at least one.
 */
export function urlPassesFilters(url: string, include: RegExp[], exclude: RegExp[]): boolean {
  for (const re of exclude) {
    if (re.test(url)) return false;
  }
  if (include.length > 0) {
    return include.some(re => re.test(url));
  }
  return true;
}

/**
 * Strip matching query parameters from a URL. Param specs support a trailing
 * "*" wildcard ("utm_*") and the bare "*" (strip every param). Comparison is
 * case-insensitive. Returns the URL unchanged when nothing matches.
 */
export function stripQueryParams(url: string, params?: string[]): string {
  if (!params || params.length === 0) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (![...parsed.searchParams.keys()].length) return url;

  const specs = params.map(p => p.trim().toLowerCase()).filter(Boolean);
  if (specs.length === 0) return url;

  const matches = (name: string): boolean => {
    const n = name.toLowerCase();
    return specs.some(spec =>
      spec === '*' || (spec.endsWith('*') ? n.startsWith(spec.slice(0, -1)) : n === spec)
    );
  };

  const toDelete = [...parsed.searchParams.keys()].filter(matches);
  for (const name of toDelete) parsed.searchParams.delete(name);
  return parsed.toString();
}

/**
 * The folder prefix a spider crawl is scoped to when "crawl within start
 * folder" is enabled: the seed's directory (seed file itself always included).
 * e.g. /blog/post → "/blog/", /blog/ → "/blog/", / → "/".
 */
export function startPathPrefix(startUrl: string): string {
  try {
    const path = new URL(startUrl).pathname;
    if (path.endsWith('/')) return path;
    const idx = path.lastIndexOf('/');
    return path.slice(0, idx + 1);
  } catch {
    return '/';
  }
}

export function isWithinStartPath(pathname: string, prefix: string): boolean {
  return pathname.startsWith(prefix);
}

// ─── Minimal per-crawl cookie jar ─────────────────────────────────────────────
// Stores name=value per host, ignoring path/expiry/secure attributes — enough
// to hold a session across an authenticated crawl. Never persisted.

export class SimpleCookieJar {
  private jar = new Map<string, Map<string, string>>();

  storeFromResponse(url: string, setCookie: string | string[] | undefined): void {
    if (!setCookie) return;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    const headers = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const header of headers) {
      const pair = header.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq <= 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;
      let cookies = this.jar.get(host);
      if (!cookies) {
        cookies = new Map();
        this.jar.set(host, cookies);
      }
      cookies.set(name, value);
    }
  }

  getCookieHeader(url: string): string | null {
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return null;
    }
    const cookies = this.jar.get(host);
    if (!cookies || cookies.size === 0) return null;
    return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}
