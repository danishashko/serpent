import axios from "axios";
import PQueue from "p-queue";
import { getLinksByCrawl } from "./database";

const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; Serpent-SEO/1.0)";

/** Status recorded for a host that could not be reached at all. */
export const STATUS_UNREACHABLE = 0;

// Error codes that mean "there is no server here" rather than "the request
// timed out" or "the connection dropped". Only these become STATUS_UNREACHABLE.
const UNREACHABLE_CODES = new Set(["ENOTFOUND", "ECONNREFUSED"]);

const PRIVATE_HOST_RE =
  /^(localhost|0\.0\.0\.0|::1|\[::1\]|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|metadata\.google\.internal)$/i;

/** Loopback, RFC-1918, link-local and cloud-metadata hosts. */
export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_RE.test(hostname.toLowerCase().replace(/\.$/, ""));
}

export interface ProbeOptions {
  concurrency?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Minimum gap between request starts, for probes aimed at one host. 0 = none. */
  minIntervalMs?: number;
  /** Probe at most this many URLs; the rest are left unchecked. */
  maxUrls?: number;
  /** Stop starting new probes after this long. */
  budgetMs?: number;
  /**
   * Probe private/loopback targets too. Off by default: a public page can link
   * to http://192.168.0.1/… and a crawler that follows it is sending requests
   * into the user's own network. Turn on only when the crawled site itself
   * lives on a private host (a dev or staging crawl).
   */
  allowPrivateHosts?: boolean;
  /** Injectable for tests. */
  fetchStatus?: (url: string) => Promise<number | null>;
}

export interface ProbeResult {
  statuses: Map<string, number>;
  /** URLs eligible for probing (after the scheme / private-host filter). */
  total: number;
  /** URLs that got an answer. */
  checked: number;
  /** True when maxUrls or budgetMs cut the run short. */
  truncated: boolean;
}

/**
 * Probe the HTTP status of a list of URLs: HEAD first, GET when HEAD is
 * refused. Returns a status per URL that answered. A host with no server
 * behind it (DNS failure, connection refused) is recorded as
 * STATUS_UNREACHABLE; a timeout or dropped connection is left out entirely,
 * because "no answer this time" is not evidence the target is gone.
 */
export async function probeUrlStatuses(
  urls: Iterable<string>,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const eligible: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!opts.allowPrivateHosts && isPrivateHost(u.hostname)) continue;
    } catch {
      continue;
    }
    eligible.push(url);
  }

  const statuses = new Map<string, number>();
  const maxUrls = opts.maxUrls ?? Infinity;
  const toProbe = eligible.length > maxUrls ? eligible.slice(0, maxUrls) : eligible;
  let truncated = toProbe.length < eligible.length;
  if (toProbe.length === 0) {
    return { statuses, total: eligible.length, checked: 0, truncated };
  }

  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const userAgent = opts.userAgent ?? UA;
  const fetchStatus =
    opts.fetchStatus ?? ((url: string) => fetchUrlStatus(url, timeoutMs, userAgent));
  const deadline = opts.budgetMs ? Date.now() + opts.budgetMs : Infinity;
  const minIntervalMs = opts.minIntervalMs ?? 0;
  let nextSlot = 0;

  const queue = new PQueue({ concurrency: opts.concurrency ?? CONCURRENCY });
  const unreachable: string[] = [];

  for (const url of toProbe) {
    void queue.add(async () => {
      if (Date.now() > deadline) {
        truncated = true;
        return;
      }
      if (minIntervalMs > 0) {
        // Reserve the slot synchronously so concurrent workers space out.
        const now = Date.now();
        const slot = Math.max(now, nextSlot);
        nextSlot = slot + minIntervalMs;
        if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
      }
      const status = await fetchStatus(url);
      if (status === null) return;
      if (status === STATUS_UNREACHABLE) unreachable.push(url);
      statuses.set(url, status);
    });
  }

  await queue.onIdle();

  // When a large share of targets look unreachable the likelier explanation is
  // this machine's own connection (offline, DNS down, VPN dropped), not that a
  // third of the web died. Drop those rather than report them as broken links.
  if (unreachable.length > Math.max(5, toProbe.length * 0.3)) {
    for (const url of unreachable) statuses.delete(url);
  }

  return { statuses, total: eligible.length, checked: statuses.size, truncated };
}

/**
 * Checks HTTP status codes for all unique external links in a crawl.
 * Returns a Map of URL → status code for all successfully checked URLs.
 * Uses HEAD first, falls back to GET if HEAD fails.
 */
export async function checkExternalLinkStatuses(
  crawlId: string,
  opts: ProbeOptions = {},
): Promise<ProbeResult> {
  const links = getLinksByCrawl(crawlId);
  const externalUrls = new Set(
    links.filter((l) => !l.isInternal).map((l) => l.targetUrl),
  );

  console.log(
    `[EXTERNAL-LINKS] Checking ${externalUrls.size} unique external URLs for crawl ${crawlId}`,
  );
  const result = await probeUrlStatuses(externalUrls, opts);
  console.log(
    `[EXTERNAL-LINKS] Done — ${result.checked}/${result.total} URLs checked`,
  );
  return result;
}

async function fetchUrlStatus(
  url: string,
  timeoutMs: number,
  userAgent: string,
): Promise<number | null> {
  // Try HEAD first (avoids downloading the body)
  try {
    const res = await axios.head(url, {
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": userAgent },
    });
    // Many CDNs/WAFs reject HEAD outright — treat those as "try GET" rather
    // than recording a false broken-link status. A 404 on HEAD is retried too:
    // some servers route HEAD differently and only answer GET correctly, and a
    // 404 is exactly the status we report as a broken link.
    if (![403, 404, 405, 501].includes(res.status)) {
      return res.status;
    }
  } catch {
    // HEAD failed — fall through to GET
  }

  // GET fallback: stream so we can read the status line without buffering the
  // body (maxContentLength would reject nearly any real page and lose the
  // status entirely).
  try {
    const res = await axios.get(url, {
      timeout: timeoutMs,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": userAgent },
      responseType: "stream",
    });
    (res.data as { destroy?: () => void })?.destroy?.();
    return res.status;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    return code && UNREACHABLE_CODES.has(code) ? STATUS_UNREACHABLE : null;
  }
}
