import axios from "axios";
import PQueue from "p-queue";
import { getLinksByCrawl } from "./database";

const CONCURRENCY = 5;
const TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (compatible; Serpent-SEO/1.0)";

/**
 * Checks HTTP status codes for all unique external links in a crawl.
 * Returns a Map of URL → status code for all successfully checked URLs.
 * Uses HEAD first, falls back to GET if HEAD fails.
 */
export async function checkExternalLinkStatuses(
  crawlId: string,
): Promise<Map<string, number>> {
  const links = getLinksByCrawl(crawlId);

  const externalUrls = [
    ...new Set(
      links
        .filter((l) => !l.isInternal)
        .map((l) => l.targetUrl)
        .filter((url) => {
          try {
            return ["http:", "https:"].includes(new URL(url).protocol);
          } catch {
            return false;
          }
        }),
    ),
  ];

  if (externalUrls.length === 0) return new Map();

  console.log(
    `[EXTERNAL-LINKS] Checking ${externalUrls.length} unique external URLs for crawl ${crawlId}`,
  );

  const queue = new PQueue({ concurrency: CONCURRENCY });
  const results = new Map<string, number>();

  for (const url of externalUrls) {
    void queue.add(async () => {
      const status = await fetchUrlStatus(url);
      if (status !== null) {
        results.set(url, status);
      }
    });
  }

  await queue.onIdle();

  console.log(
    `[EXTERNAL-LINKS] Done — ${results.size}/${externalUrls.length} URLs checked`,
  );
  return results;
}

async function fetchUrlStatus(url: string): Promise<number | null> {
  // Try HEAD first (avoids downloading the body)
  try {
    const res = await axios.head(url, {
      timeout: TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": UA },
    });
    // Many CDNs/WAFs reject HEAD outright — treat those as "try GET" rather
    // than recording a false broken-link status.
    if (![403, 405, 501].includes(res.status)) {
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
      timeout: TIMEOUT_MS,
      maxRedirects: 5,
      validateStatus: () => true,
      headers: { "User-Agent": UA },
      responseType: "stream",
    });
    (res.data as { destroy?: () => void })?.destroy?.();
    return res.status;
  } catch {
    return null;
  }
}
