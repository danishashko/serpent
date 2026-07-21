import { describe, it, expect } from 'vitest';
import {
  compilePatterns,
  urlPassesFilters,
  stripQueryParams,
  startPathPrefix,
  isWithinStartPath,
  SimpleCookieJar,
} from '../main/crawl-filters';

describe('compilePatterns', () => {
  it('compiles valid patterns case-insensitively', () => {
    const res = compilePatterns(['/blog/.*', 'PRODUCTS']);
    expect(res).toHaveLength(2);
    expect(res[0].test('https://x.com/blog/post')).toBe(true);
    expect(res[1].test('https://x.com/products/1')).toBe(true);
  });

  it('drops invalid regexes and blank lines instead of throwing', () => {
    const res = compilePatterns(['[unclosed', '', '   ', 'valid']);
    expect(res).toHaveLength(1);
    expect(res[0].source).toBe('valid');
  });

  it('handles undefined input', () => {
    expect(compilePatterns(undefined)).toEqual([]);
  });
});

describe('urlPassesFilters', () => {
  const inc = compilePatterns(['/blog/']);
  const exc = compilePatterns(['/blog/private']);

  it('passes everything with no patterns', () => {
    expect(urlPassesFilters('https://x.com/anything', [], [])).toBe(true);
  });

  it('requires an include match when include patterns exist', () => {
    expect(urlPassesFilters('https://x.com/blog/post', inc, [])).toBe(true);
    expect(urlPassesFilters('https://x.com/shop/item', inc, [])).toBe(false);
  });

  it('exclude wins over include', () => {
    expect(urlPassesFilters('https://x.com/blog/private/x', inc, exc)).toBe(false);
    expect(urlPassesFilters('https://x.com/blog/public', inc, exc)).toBe(true);
  });
});

describe('stripQueryParams', () => {
  it('strips exact param names case-insensitively', () => {
    expect(stripQueryParams('https://x.com/p?fbclid=1&keep=2', ['FBCLID'])).toBe('https://x.com/p?keep=2');
  });

  it('supports trailing-* wildcards', () => {
    expect(stripQueryParams('https://x.com/p?utm_source=a&utm_medium=b&id=5', ['utm_*']))
      .toBe('https://x.com/p?id=5');
  });

  it('bare * strips all params', () => {
    expect(stripQueryParams('https://x.com/p?a=1&b=2', ['*'])).toBe('https://x.com/p');
  });

  it('returns URL unchanged with no matches, no params, or invalid URL', () => {
    expect(stripQueryParams('https://x.com/p?id=5', ['utm_*'])).toBe('https://x.com/p?id=5');
    expect(stripQueryParams('https://x.com/p', ['utm_*'])).toBe('https://x.com/p');
    expect(stripQueryParams('not a url', ['utm_*'])).toBe('not a url');
    expect(stripQueryParams('https://x.com/p?utm_a=1', undefined)).toBe('https://x.com/p?utm_a=1');
  });
});

describe('start-folder scoping', () => {
  it('derives the folder prefix from the seed', () => {
    expect(startPathPrefix('https://x.com/blog/post')).toBe('/blog/');
    expect(startPathPrefix('https://x.com/blog/')).toBe('/blog/');
    expect(startPathPrefix('https://x.com/')).toBe('/');
    expect(startPathPrefix('https://x.com')).toBe('/');
  });

  it('checks pathname membership', () => {
    expect(isWithinStartPath('/blog/post-2', '/blog/')).toBe(true);
    expect(isWithinStartPath('/shop/item', '/blog/')).toBe(false);
    expect(isWithinStartPath('/blog', '/blog/')).toBe(false);
  });
});

describe('SimpleCookieJar', () => {
  it('stores cookies from single and array Set-Cookie headers and replays them per host', () => {
    const jar = new SimpleCookieJar();
    jar.storeFromResponse('http://a.test/login', 'session=abc; Path=/; HttpOnly');
    jar.storeFromResponse('http://a.test/login', ['pref=dark; Max-Age=60', 'seen=1']);
    expect(jar.getCookieHeader('http://a.test/page')).toBe('session=abc; pref=dark; seen=1');
  });

  it('isolates cookies between hosts and updates existing names', () => {
    const jar = new SimpleCookieJar();
    jar.storeFromResponse('http://a.test/', 'id=1');
    jar.storeFromResponse('http://b.test/', 'id=2');
    jar.storeFromResponse('http://a.test/', 'id=3');
    expect(jar.getCookieHeader('http://a.test/')).toBe('id=3');
    expect(jar.getCookieHeader('http://b.test/')).toBe('id=2');
    expect(jar.getCookieHeader('http://c.test/')).toBeNull();
  });

  it('ignores malformed headers and URLs', () => {
    const jar = new SimpleCookieJar();
    jar.storeFromResponse('not a url', 'x=1');
    jar.storeFromResponse('http://a.test/', 'noequals');
    jar.storeFromResponse('http://a.test/', undefined);
    expect(jar.getCookieHeader('http://a.test/')).toBeNull();
    expect(jar.getCookieHeader('not a url')).toBeNull();
  });
});
