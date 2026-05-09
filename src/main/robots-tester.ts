// Standalone robots.txt parser + tester.
// Used by the crawler orchestrator AND the renderer "Robots Tester" panel
// (via IPC.ROBOTS_TEST). Implements a subset of Google's robots.txt spec:
//   - User-agent grouping (specific UA blocks override the wildcard block)
//   - Allow / Disallow with longest-match precedence; on a tie, Allow wins.
//   - Wildcards (*) and end-anchors ($) inside paths.
//   - Comments (#) and blank-line group terminators.

import { URL } from 'url';
import type { RobotsTestRequest, RobotsTestResult } from '../types/index';

export interface RobotsRule {
  type: 'allow' | 'disallow';
  pattern: string;          // raw pattern as written in robots.txt
  regex: RegExp;            // compiled matcher
  specificity: number;      // length of pattern (used for tie-breaking)
}

export interface RobotsRuleSet {
  agent: string;            // 'Serpent' | '*' | …
  rules: RobotsRule[];
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a robots.txt body into a rule set for the given user-agent.
 * If a specific UA group exists it is used exclusively, otherwise the wildcard
 * group is used. Returns a rule set with `agent` indicating which group matched.
 */
export function parseRobotsTxt(body: string, userAgent: string = '*'): RobotsRuleSet {
  const groups = parseGroups(body);
  const uaLower = userAgent.toLowerCase();

  // 1) Find the group with the longest matching UA token (Google semantics).
  let bestMatch: { agent: string; rules: RobotsRule[] } | null = null;
  let bestLen = -1;

  for (const g of groups) {
    for (const agent of g.agents) {
      const aLower = agent.toLowerCase();
      // Specific match: UA string starts with the declared agent token.
      if (aLower !== '*' && uaLower.startsWith(aLower)) {
        if (aLower.length > bestLen) {
          bestLen = aLower.length;
          bestMatch = { agent, rules: g.rules };
        }
      }
    }
  }
  if (bestMatch) return bestMatch;

  // 2) Fall back to wildcard group.
  for (const g of groups) {
    if (g.agents.some((a) => a === '*')) {
      return { agent: '*', rules: g.rules };
    }
  }

  // 3) No applicable rules — everything allowed.
  return { agent: '*', rules: [] };
}

/**
 * Decide whether `urlPath` (a URL pathname incl. query) is allowed.
 * Returns the matched rule (longest pattern wins; allow beats disallow on ties).
 */
export function checkPath(urlPath: string, ruleSet: RobotsRuleSet): {
  allowed: boolean;
  matched: RobotsRule | null;
} {
  let bestAllow: RobotsRule | null = null;
  let bestDisallow: RobotsRule | null = null;

  for (const r of ruleSet.rules) {
    if (r.regex.test(urlPath)) {
      if (r.type === 'allow') {
        if (!bestAllow || r.specificity > bestAllow.specificity) bestAllow = r;
      } else {
        if (!bestDisallow || r.specificity > bestDisallow.specificity) bestDisallow = r;
      }
    }
  }

  if (!bestDisallow) return { allowed: true, matched: bestAllow };
  if (bestAllow && bestAllow.specificity >= bestDisallow.specificity) {
    return { allowed: true, matched: bestAllow };
  }
  return { allowed: false, matched: bestDisallow };
}

/**
 * High-level helper used by IPC.ROBOTS_TEST. Accepts a robots.txt body, a full
 * URL, and an optional user-agent; returns a serialisable verdict.
 */
export function testRobots(req: RobotsTestRequest): RobotsTestResult {
  const ua = req.userAgent && req.userAgent.trim() ? req.userAgent.trim() : '*';
  const ruleSet = parseRobotsTxt(req.robotsTxt, ua);

  let pathAndQuery: string;
  try {
    const u = new URL(req.url);
    pathAndQuery = u.pathname + (u.search || '');
  } catch {
    // Treat as a relative path.
    pathAndQuery = req.url.startsWith('/') ? req.url : '/' + req.url;
  }

  const { allowed, matched } = checkPath(pathAndQuery, ruleSet);
  return {
    allowed,
    matchedRule: matched ? `${matched.type === 'allow' ? 'Allow' : 'Disallow'}: ${matched.pattern}` : null,
    ruleType: matched ? matched.type : 'none',
    appliedAgent: ruleSet.agent,
  };
}

// ─── Internal: group parser + pattern compiler ────────────────────────────────

interface RawGroup {
  agents: string[];
  rules: RobotsRule[];
}

function parseGroups(body: string): RawGroup[] {
  const lines = body.split(/\r?\n/);
  const groups: RawGroup[] = [];
  let current: RawGroup | null = null;
  let lastWasAgent = false;

  for (const rawLine of lines) {
    // Strip inline comments.
    const hashIdx = rawLine.indexOf('#');
    const noComment = hashIdx >= 0 ? rawLine.slice(0, hashIdx) : rawLine;
    const line = noComment.trim();
    if (!line) {
      // Blank line ends the current group.
      current = null;
      lastWasAgent = false;
      continue;
    }

    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const directive = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (directive === 'user-agent') {
      // Consecutive user-agents stack into the same group.
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value);
      lastWasAgent = true;
    } else if (directive === 'allow' || directive === 'disallow') {
      if (!current) continue; // directive without preceding UA — ignore
      lastWasAgent = false;
      // An empty Disallow means "allow everything" — represent by a no-op.
      if (directive === 'disallow' && value === '') continue;
      // An empty Allow has no effect.
      if (directive === 'allow' && value === '') continue;
      current.rules.push({
        type: directive,
        pattern: value,
        regex: compilePattern(value),
        specificity: value.length,
      });
    }
    // Other directives (Sitemap, Crawl-delay, …) are ignored for path matching.
  }

  return groups;
}

function compilePattern(pattern: string): RegExp {
  // Convert a robots.txt pattern to a regex.
  //   '*' → '.*'
  //   '$' at end → end-of-string anchor
  //   everything else is literal (regex-escaped)
  let re = '^';
  let endAnchor = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      re += '.*';
    } else if (ch === '$' && i === pattern.length - 1) {
      endAnchor = true;
    } else {
      // Escape regex metacharacters.
      re += ch.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  if (endAnchor) re += '$';
  return new RegExp(re);
}
