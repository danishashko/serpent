// Derives the robots.txt user-agent token from the HTTP User-Agent header.
// Keeps "crawl as Googlebot" honest: picking a bot UA for requests should also
// evaluate robots.txt against that bot's group, not Serpent's.
// Shared by the crawler orchestrator and the renderer config UI.

export const DEFAULT_ROBOTS_USER_AGENT = 'Serpent';

// Ordered longest-first so "Googlebot-Mobile" wins over "Googlebot".
const KNOWN_ROBOTS_TOKENS = [
  'Googlebot-Mobile',
  'Googlebot-Image',
  'Googlebot-News',
  'Googlebot-Video',
  'AdsBot-Google',
  'Googlebot',
  'PerplexityBot',
  'DuckDuckBot',
  'Baiduspider',
  'SemrushBot',
  'ClaudeBot',
  'YandexBot',
  'AhrefsBot',
  'Applebot',
  'Bingbot',
  'GPTBot',
];

/**
 * Map an HTTP User-Agent string to the robots.txt group it should be matched
 * against. Falls back to 'Serpent' (which matches only the `*` group) for
 * browser and unknown user-agents.
 */
export function robotsTokenForUserAgent(userAgent?: string): string {
  const ua = userAgent?.trim();
  if (!ua) return DEFAULT_ROBOTS_USER_AGENT;
  const lower = ua.toLowerCase();
  for (const token of KNOWN_ROBOTS_TOKENS) {
    if (lower.includes(token.toLowerCase())) return token;
  }
  return DEFAULT_ROBOTS_USER_AGENT;
}
