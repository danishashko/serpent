// llms.txt analyzer.
//
// Fetches and validates /llms.txt against the llmstxt.org proposal, plus the
// companion /llms-full.txt convention. Site-level, like sitemap-analyzer, and
// built the same way: injectable fetch, regex parsing, no new dependencies.
//
// The spec (llmstxt.org) defines a markdown file with a fixed shape:
//   # Project name            (required, exactly one H1)
//   > Short summary           (optional blockquote, immediately after the H1)
//   Free prose                (optional, no headings)
//   ## Section                (zero or more H2s)
//   - [name](url): notes      (link list under each H2)
// An H2 named "Optional" is special: its links are the ones a consumer may
// skip when it needs a shorter context.
//
// Validation is deliberately about structure and link integrity, not content
// quality. We report what a machine reading the file would trip over.

import axios from 'axios';
import { URL } from 'url';
import type { PageData, LlmsTxtResult, LlmsTxtSection, LlmsTxtIssue } from '../types/index';

// llms.txt is meant to be small enough to drop into a context window. Anything
// past this is either not an llms.txt or is unusable as one.
export const MAX_BYTES = 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

// The spec names this section explicitly; its links are skippable by consumers.
const OPTIONAL_SECTION = 'optional';

export interface LlmsTxtDeps {
  fetch: (url: string) => Promise<{ status: number; body: string; contentType: string }>;
}

export const defaultDeps: LlmsTxtDeps = {
  async fetch(url: string) {
    const resp = await axios.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      responseType: 'text',
      maxContentLength: MAX_BYTES,
      transformResponse: [(d) => d],
      validateStatus: (s) => s < 600,
    });
    return {
      status: resp.status,
      body: typeof resp.data === 'string' ? resp.data : String(resp.data ?? ''),
      contentType: String(resp.headers['content-type'] || '').toLowerCase(),
    };
  },
};

// ─── Parsing ─────────────────────────────────────────────────────────────────

const H1_RE = /^#\s+(.+?)\s*$/;
const H2_RE = /^##\s+(.+?)\s*$/;
const DEEPER_HEADING_RE = /^#{3,}\s+/;
const BLOCKQUOTE_RE = /^>\s*(.*)$/;
// - [name](url): optional notes
const LINK_ITEM_RE = /^[-*]\s*\[([^\]]*)\]\(([^)]+)\)\s*(?::\s*(.*))?$/;

interface Parsed {
  title: string | null;
  summary: string | null;
  sections: LlmsTxtSection[];
  /** Non-link, non-heading lines that appear before the first H2. */
  hasFreeProse: boolean;
  /** Count of list items under an H2 that are not well-formed markdown links. */
  malformedItems: number;
  /** True when a second H1 appears — the spec allows exactly one. */
  multipleH1: boolean;
  deeperHeadings: boolean;
}

export function parseLlmsTxt(body: string): Parsed {
  const lines = body.split(/\r?\n/);
  const sections: LlmsTxtSection[] = [];

  let title: string | null = null;
  let summary: string | null = null;
  let multipleH1 = false;
  let deeperHeadings = false;
  let hasFreeProse = false;
  let malformedItems = 0;

  let current: LlmsTxtSection | null = null;
  // The blockquote summary only counts if it directly follows the H1, allowing
  // blank lines between. Once real content starts, a later blockquote is prose.
  let awaitingSummary = false;
  const summaryLines: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();

    const h1 = H1_RE.exec(line);
    if (h1) {
      if (title === null) {
        title = h1[1].trim();
        awaitingSummary = true;
      } else {
        multipleH1 = true;
      }
      continue;
    }

    const h2 = H2_RE.exec(line);
    if (h2) {
      awaitingSummary = false;
      current = { name: h2[1].trim(), links: [] };
      sections.push(current);
      continue;
    }

    if (DEEPER_HEADING_RE.test(line)) {
      deeperHeadings = true;
      continue;
    }

    if (line === '') continue;

    const bq = BLOCKQUOTE_RE.exec(line);
    if (bq && awaitingSummary && current === null) {
      summaryLines.push(bq[1].trim());
      continue;
    }

    const item = LINK_ITEM_RE.exec(line);
    if (item) {
      awaitingSummary = false;
      const entry = { name: item[1].trim(), url: item[2].trim(), notes: (item[3] ?? '').trim() || null };
      if (current) {
        current.links.push(entry);
      } else {
        // A link list before any H2 is out of shape but still useful data;
        // park it in an implicit section so the URLs are not silently dropped.
        current = { name: '', links: [entry] };
        sections.push(current);
      }
      continue;
    }

    // Anything else is prose.
    awaitingSummary = false;
    if (current === null) hasFreeProse = true;
    else if (/^[-*]\s+/.test(line)) malformedItems++;
  }

  if (summaryLines.length > 0) summary = summaryLines.join(' ').trim() || null;

  return { title, summary, sections, hasFreeProse, malformedItems, multipleH1, deeperHeadings };
}

// ─── Analysis ────────────────────────────────────────────────────────────────

function issue(
  issues: LlmsTxtIssue[],
  severity: LlmsTxtIssue['severity'],
  message: string,
  recommendation: string,
): void {
  issues.push({ severity, message, recommendation });
}

/**
 * Fetches /llms.txt for an origin and validates it.
 *
 * `crawledPages` is used only to report how much of the file's link list the
 * crawl actually reached — a link in llms.txt that 404s or was never crawled is
 * the failure mode worth surfacing.
 */
export async function analyzeLlmsTxt(
  siteUrl: string,
  crawledPages: PageData[],
  deps: LlmsTxtDeps = defaultDeps,
): Promise<LlmsTxtResult> {
  const origin = new URL(siteUrl).origin;
  const llmsUrl = `${origin}/llms.txt`;
  const fullUrl = `${origin}/llms-full.txt`;
  const issues: LlmsTxtIssue[] = [];

  let resp: { status: number; body: string; contentType: string };
  try {
    resp = await deps.fetch(llmsUrl);
  } catch (err) {
    return {
      url: llmsUrl,
      found: false,
      statusCode: null,
      error: (err as Error).message,
      title: null,
      summary: null,
      sections: [],
      linkCount: 0,
      optionalLinkCount: 0,
      linksCrawled: 0,
      linksNotCrawled: [],
      hasLlmsFullTxt: false,
      score: 0,
      issues: [
        {
          severity: 'warning',
          message: `Could not fetch ${llmsUrl}.`,
          recommendation: 'Confirm the host is reachable, then publish an llms.txt at the site root.',
        },
      ],
    };
  }

  if (resp.status !== 200) {
    return {
      url: llmsUrl,
      found: false,
      statusCode: resp.status,
      error: null,
      title: null,
      summary: null,
      sections: [],
      linkCount: 0,
      optionalLinkCount: 0,
      linksCrawled: 0,
      linksNotCrawled: [],
      hasLlmsFullTxt: await exists(fullUrl, deps),
      score: 0,
      issues: [
        {
          severity: 'opportunity',
          message: `No llms.txt at ${llmsUrl} (HTTP ${resp.status}).`,
          recommendation:
            'Publish /llms.txt: an H1 with the site name, a blockquote summary, then H2 sections listing your most useful pages as markdown links.',
        },
      ],
    };
  }

  // A root-level SPA that 200s on everything will hand back HTML here.
  if (/^\s*<(!doctype|html)/i.test(resp.body)) {
    issue(issues, 'critical', 'The response at /llms.txt is HTML, not markdown.',
      'The server is likely returning the SPA fallback for unknown paths. Serve llms.txt as a real file with Content-Type: text/plain or text/markdown.');
  }

  const parsed = parseLlmsTxt(resp.body);

  if (!parsed.title) {
    issue(issues, 'critical', 'No H1 title.',
      'The spec requires exactly one H1 naming the project or site. Add "# Your Site Name" as the first line.');
  }
  if (parsed.multipleH1) {
    issue(issues, 'warning', 'More than one H1.',
      'Keep a single H1 and demote the rest to H2 sections.');
  }
  if (!parsed.summary) {
    issue(issues, 'warning', 'No blockquote summary.',
      'Add a "> one-sentence summary" line directly under the H1. This is the part most likely to be quoted verbatim.');
  }
  if (parsed.sections.length === 0) {
    issue(issues, 'critical', 'No H2 sections with links.',
      'Group your key pages under H2 headings, e.g. "## Docs", each followed by a markdown link list.');
  }
  if (parsed.sections.some((s) => s.name === '')) {
    issue(issues, 'warning', 'Links appear before any H2 section.',
      'Move every link under a named H2 so consumers can tell what a link list is for.');
  }
  if (parsed.deeperHeadings) {
    issue(issues, 'info', 'Headings deeper than H2 are present.',
      'The format only defines H1 and H2. Deeper headings are ignored by spec-compliant parsers.');
  }
  if (parsed.malformedItems > 0) {
    issue(issues, 'warning', `${parsed.malformedItems} list item(s) are not markdown links.`,
      'Every bullet under an H2 should be "- [name](url): optional notes".');
  }
  if (resp.body.length > MAX_BYTES) {
    issue(issues, 'warning', 'File is over 1 MB.',
      'llms.txt is meant to fit in a context window. Move the long-form content to llms-full.txt.');
  }

  const allLinks = parsed.sections.flatMap((s) => s.links);
  const optionalLinkCount = parsed.sections
    .filter((s) => s.name.trim().toLowerCase() === OPTIONAL_SECTION)
    .reduce((n, s) => n + s.links.length, 0);

  if (allLinks.some((l) => !/^https?:\/\//i.test(l.url))) {
    issue(issues, 'warning', 'Some links are relative.',
      'Use absolute URLs — the file is read out of context, so a relative path cannot be resolved reliably.');
  }

  // Coverage against the crawl. Only meaningful when a crawl was supplied.
  const crawled = new Set(crawledPages.map((p) => normalize(p.url)));
  const linksNotCrawled: string[] = [];
  let linksCrawled = 0;
  if (crawled.size > 0) {
    for (const link of allLinks) {
      let abs: string;
      try {
        abs = new URL(link.url, origin).toString();
      } catch {
        continue;
      }
      if (crawled.has(normalize(abs))) linksCrawled++;
      else linksNotCrawled.push(abs);
    }
    if (linksNotCrawled.length > 0) {
      issue(issues, 'warning', `${linksNotCrawled.length} llms.txt link(s) were not reached by this crawl.`,
        'A link the crawler could not reach is one an LLM cannot fetch either. Check for 404s, noindex, or pages orphaned from your internal link graph.');
    }
  }

  const hasLlmsFullTxt = await exists(fullUrl, deps);
  if (!hasLlmsFullTxt) {
    issue(issues, 'opportunity', 'No /llms-full.txt.',
      'The companion file holds the full expanded content in one document. Publish it if your docs are worth reading in full.');
  }

  return {
    url: llmsUrl,
    found: true,
    statusCode: resp.status,
    error: null,
    title: parsed.title,
    summary: parsed.summary,
    sections: parsed.sections,
    linkCount: allLinks.length,
    optionalLinkCount,
    linksCrawled,
    linksNotCrawled: linksNotCrawled.slice(0, 50),
    hasLlmsFullTxt,
    score: scoreLlmsTxt(issues),
    issues,
  };
}

// Penalties mirror the GEO analyzer's shape: a critical structural failure
// should dominate a stack of opportunities.
const ISSUE_PENALTY: Record<LlmsTxtIssue['severity'], number> = {
  critical: 30,
  warning: 12,
  opportunity: 5,
  info: 2,
};

export function scoreLlmsTxt(issues: LlmsTxtIssue[]): number {
  let penalty = 0;
  for (const i of issues) penalty += ISSUE_PENALTY[i.severity];
  return Math.max(0, 100 - Math.min(penalty, 100));
}

async function exists(url: string, deps: LlmsTxtDeps): Promise<boolean> {
  try {
    const r = await deps.fetch(url);
    return r.status === 200 && !/^\s*<(!doctype|html)/i.test(r.body);
  } catch {
    return false;
  }
}

// Trailing-slash and fragment differences should not read as "not crawled".
function normalize(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
