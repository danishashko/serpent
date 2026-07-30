import { describe, it, expect } from 'vitest';
import { robotsTokenForUserAgent, DEFAULT_ROBOTS_USER_AGENT } from '../main/robots-ua';

const GOOGLEBOT_DESKTOP =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/125.0.0.0 Safari/537.36';
const GOOGLEBOT_SMARTPHONE =
  'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const BINGBOT =
  'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/116.0.1938.76 Safari/537.36';
const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

describe('robotsTokenForUserAgent', () => {
  it('falls back to Serpent for empty, blank and undefined user-agents', () => {
    expect(robotsTokenForUserAgent(undefined)).toBe(DEFAULT_ROBOTS_USER_AGENT);
    expect(robotsTokenForUserAgent('')).toBe(DEFAULT_ROBOTS_USER_AGENT);
    expect(robotsTokenForUserAgent('   ')).toBe(DEFAULT_ROBOTS_USER_AGENT);
  });

  it('maps the shipped UA presets to their robots.txt group', () => {
    expect(robotsTokenForUserAgent(GOOGLEBOT_DESKTOP)).toBe('Googlebot');
    expect(robotsTokenForUserAgent(GOOGLEBOT_SMARTPHONE)).toBe('Googlebot');
    expect(robotsTokenForUserAgent(BINGBOT)).toBe('Bingbot');
  });

  it('treats browser and unknown user-agents as Serpent', () => {
    expect(robotsTokenForUserAgent(CHROME_WINDOWS)).toBe(DEFAULT_ROBOTS_USER_AGENT);
    expect(robotsTokenForUserAgent('MyCrawler/1.0')).toBe(DEFAULT_ROBOTS_USER_AGENT);
  });

  it('prefers the longest matching token', () => {
    expect(robotsTokenForUserAgent('Googlebot-Mobile/2.1')).toBe('Googlebot-Mobile');
    expect(robotsTokenForUserAgent('Googlebot-Image/1.0')).toBe('Googlebot-Image');
    expect(robotsTokenForUserAgent('AdsBot-Google (+http://www.google.com/adsbot.html)')).toBe('AdsBot-Google');
  });

  it('recognises AI and third-party crawlers case-insensitively', () => {
    expect(robotsTokenForUserAgent('gptbot/1.2')).toBe('GPTBot');
    expect(robotsTokenForUserAgent('Mozilla/5.0 (compatible; ClaudeBot/1.0)')).toBe('ClaudeBot');
    expect(robotsTokenForUserAgent('PerplexityBot/1.0')).toBe('PerplexityBot');
    expect(robotsTokenForUserAgent('Mozilla/5.0 (compatible; AhrefsBot/7.0)')).toBe('AhrefsBot');
  });
});
