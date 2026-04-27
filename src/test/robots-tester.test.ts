import { describe, it, expect } from 'vitest';
import { parseRobotsTxt, checkPath, testRobots } from '../main/robots-tester';

describe('robots-tester', () => {
  describe('parseRobotsTxt + checkPath', () => {
    it('wildcard * matches anything', () => {
      const rs = parseRobotsTxt('User-agent: *\nDisallow: /', '*');
      expect(checkPath('/anything', rs).allowed).toBe(false);
    });

    it('$ end-anchor matches exact suffix', () => {
      const rs = parseRobotsTxt('User-agent: *\nDisallow: /*.pdf$', 'GhostFrog');
      expect(checkPath('/file.pdf', rs).allowed).toBe(false);
      expect(checkPath('/file.pdfx', rs).allowed).toBe(true);
    });

    it('allow beats disallow on tie (same specificity)', () => {
      const rs = parseRobotsTxt('User-agent: *\nDisallow: /admin\nAllow: /admin', 'GhostFrog');
      expect(checkPath('/admin', rs).allowed).toBe(true);
    });

    it('GPTBot specific block overrides *', () => {
      const body = [
        'User-agent: *',
        'Disallow:',
        '',
        'User-agent: GPTBot',
        'Disallow: /',
      ].join('\n');
      const rsOther = parseRobotsTxt(body, 'Googlebot');
      const rsGpt = parseRobotsTxt(body, 'GPTBot');
      expect(checkPath('/', rsOther).allowed).toBe(true);
      expect(checkPath('/', rsGpt).allowed).toBe(false);
      expect(rsGpt.agent).toBe('GPTBot');
    });

    it('multiple UAs stack into one group', () => {
      const body = [
        'User-agent: GPTBot',
        'User-agent: ClaudeBot',
        'Disallow: /',
      ].join('\n');
      expect(checkPath('/x', parseRobotsTxt(body, 'GPTBot')).allowed).toBe(false);
      expect(checkPath('/x', parseRobotsTxt(body, 'ClaudeBot')).allowed).toBe(false);
      expect(checkPath('/x', parseRobotsTxt(body, 'Bingbot')).allowed).toBe(true); // no wildcard
    });

    it('longest-startsWith UA token wins', () => {
      const body = [
        'User-agent: Googlebot',
        'Disallow: /a',
        '',
        'User-agent: Googlebot-Image',
        'Disallow: /b',
      ].join('\n');
      const rsImg = parseRobotsTxt(body, 'Googlebot-Image');
      expect(rsImg.agent).toBe('Googlebot-Image');
      expect(checkPath('/b', rsImg).allowed).toBe(false);
      expect(checkPath('/a', rsImg).allowed).toBe(true);
    });

    it('longest-pattern wins', () => {
      const rs = parseRobotsTxt('User-agent: *\nDisallow: /a\nAllow: /a/public', 'GhostFrog');
      expect(checkPath('/a/private', rs).allowed).toBe(false);
      expect(checkPath('/a/public/x', rs).allowed).toBe(true);
    });

    it('comments and blank lines are ignored', () => {
      const body = [
        '# comment',
        'User-agent: *',
        '',
        'Disallow: /admin   # inline comment',
      ].join('\n');
      // The blank line ends the group, so Disallow has no UA — should be ignored.
      const rs = parseRobotsTxt(body, '*');
      expect(checkPath('/admin', rs).allowed).toBe(true);
    });

    it('empty Disallow is a no-op (allow all)', () => {
      const rs = parseRobotsTxt('User-agent: *\nDisallow:', '*');
      expect(checkPath('/anything', rs).allowed).toBe(true);
      expect(rs.rules).toHaveLength(0);
    });
  });

  describe('testRobots()', () => {
    it('returns full verdict for absolute URL', () => {
      const r = testRobots({
        robotsTxt: 'User-agent: *\nDisallow: /admin',
        url: 'https://example.com/admin/dashboard',
        userAgent: 'GhostFrog',
      });
      expect(r.allowed).toBe(false);
      expect(r.ruleType).toBe('disallow');
      expect(r.matchedRule).toMatch(/Disallow: \/admin/);
    });

    it('handles relative paths', () => {
      const r = testRobots({
        robotsTxt: 'User-agent: *\nDisallow: /x',
        url: '/x/y',
      });
      expect(r.allowed).toBe(false);
    });

    it('returns ruleType="none" when nothing matches', () => {
      const r = testRobots({
        robotsTxt: 'User-agent: *\nDisallow: /admin',
        url: 'https://example.com/about',
      });
      expect(r.allowed).toBe(true);
      expect(r.ruleType).toBe('none');
      expect(r.matchedRule).toBeNull();
    });
  });
});
