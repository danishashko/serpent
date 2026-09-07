import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import {
  auditAccessibility,
  scoreViolations,
  countByImpact,
  RULES,
  MAX_ELEMENTS_PER_VIOLATION,
} from '../main/accessibility';
import type { A11yViolation } from '../types/index';

function audit(html: string) {
  return auditAccessibility(cheerio.load(html));
}

function ids(html: string): string[] {
  return audit(html).violations.map(v => v.id).sort();
}

function violation(html: string, id: string): A11yViolation | undefined {
  return audit(html).violations.find(v => v.id === id);
}

// A document that passes every rule. Each test starts from a clean baseline so
// an assertion about one rule is not polluted by another.
const CLEAN = `<!doctype html><html lang="en"><head><title>Page</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body><h1>Heading</h1><p>Text</p></body></html>`;

describe('clean document', () => {
  it('reports no violations and scores 100', () => {
    const result = audit(CLEAN);
    expect(result.violations).toEqual([]);
    expect(result.score).toBe(100);
  });
});

describe('image-alt', () => {
  it('flags an img with no alt attribute', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<img src="a.png">'))).toContain('image-alt');
  });

  it('accepts alt="" as a valid decorative image', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<img src="a.png" alt="">'))).not.toContain('image-alt');
  });

  it('accepts role="presentation" without alt', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<img src="a.png" role="presentation">'))).not.toContain('image-alt');
  });

  it('counts every failing image', () => {
    const html = CLEAN.replace('<p>Text</p>', '<img src="a.png"><img src="b.png"><img src="c.png">');
    expect(violation(html, 'image-alt')?.count).toBe(3);
  });
});

describe('input-label', () => {
  it('flags a bare input', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<input type="text">'))).toContain('input-label');
  });

  it('accepts a label[for] pointing at the input id', () => {
    const html = CLEAN.replace('<p>Text</p>', '<label for="n">Name</label><input id="n" type="text">');
    expect(ids(html)).not.toContain('input-label');
  });

  it('accepts an input wrapped in its own label', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<label>Name <input type="text"></label>'))).not.toContain('input-label');
  });

  it('accepts aria-label', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<input type="text" aria-label="Name">'))).not.toContain('input-label');
  });

  it('exempts hidden and submit inputs', () => {
    const html = CLEAN.replace('<p>Text</p>', '<input type="hidden" name="t"><input type="submit" value="Go">');
    expect(ids(html)).not.toContain('input-label');
  });

  it('does not throw on an id containing CSS metacharacters', () => {
    const html = CLEAN.replace('<p>Text</p>', '<label for="a.b">L</label><input id="a.b" type="text">');
    expect(() => audit(html)).not.toThrow();
    expect(ids(html)).not.toContain('input-label');
  });
});

describe('button-name', () => {
  it('flags an empty button', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<button></button>'))).toContain('button-name');
  });

  it('accepts text content, aria-label, and a titled svg', () => {
    for (const markup of [
      '<button>Send</button>',
      '<button aria-label="Send"></button>',
      '<button><svg><title>Send</title></svg></button>',
      '<button><img src="i.png" alt="Send"></button>',
    ]) {
      expect(ids(CLEAN.replace('<p>Text</p>', markup))).not.toContain('button-name');
    }
  });
});

describe('meta-viewport', () => {
  it('flags user-scalable=no', () => {
    const html = CLEAN.replace('initial-scale=1', 'initial-scale=1, user-scalable=no');
    expect(ids(html)).toContain('meta-viewport');
  });

  it('flags maximum-scale below 2', () => {
    const html = CLEAN.replace('initial-scale=1', 'initial-scale=1, maximum-scale=1.0');
    expect(ids(html)).toContain('meta-viewport');
  });

  it('accepts maximum-scale of 5', () => {
    const html = CLEAN.replace('initial-scale=1', 'initial-scale=1, maximum-scale=5');
    expect(ids(html)).not.toContain('meta-viewport');
  });

  it('does not flag a page with no viewport tag at all', () => {
    const html = CLEAN.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '');
    expect(ids(html)).not.toContain('meta-viewport');
  });
});

describe('link-name', () => {
  it('flags an icon-only link', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<a href="/x"><svg></svg></a>'))).toContain('link-name');
  });

  it('accepts aria-labelledby resolving to an existing id', () => {
    const html = CLEAN.replace('<p>Text</p>', '<span id="lbl">Home</span><a href="/x" aria-labelledby="lbl"></a>');
    expect(ids(html)).not.toContain('link-name');
  });

  it('flags aria-labelledby pointing at nothing', () => {
    const html = CLEAN.replace('<p>Text</p>', '<a href="/x" aria-labelledby="missing"></a>');
    expect(ids(html)).toContain('link-name');
  });
});

describe('html lang', () => {
  it('flags a missing lang', () => {
    expect(ids(CLEAN.replace('<html lang="en">', '<html>'))).toContain('html-has-lang');
  });

  it('flags a malformed lang but does not double-report a missing one', () => {
    expect(ids(CLEAN.replace('lang="en"', 'lang="english!"'))).toContain('html-lang-valid');
    expect(ids(CLEAN.replace('<html lang="en">', '<html>'))).not.toContain('html-lang-valid');
  });

  it('accepts a region subtag', () => {
    expect(ids(CLEAN.replace('lang="en"', 'lang="en-GB"'))).not.toContain('html-lang-valid');
  });
});

describe('document-title', () => {
  it('flags an empty title', () => {
    expect(ids(CLEAN.replace('<title>Page</title>', '<title></title>'))).toContain('document-title');
  });
});

describe('frame-title', () => {
  it('flags an untitled iframe and accepts a titled one', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<iframe src="/a"></iframe>'))).toContain('frame-title');
    expect(ids(CLEAN.replace('<p>Text</p>', '<iframe src="/a" title="Map"></iframe>'))).not.toContain('frame-title');
  });
});

describe('tabindex-positive', () => {
  it('flags tabindex greater than zero only', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<div tabindex="3">x</div>'))).toContain('tabindex-positive');
    expect(ids(CLEAN.replace('<p>Text</p>', '<div tabindex="0">x</div>'))).not.toContain('tabindex-positive');
    expect(ids(CLEAN.replace('<p>Text</p>', '<div tabindex="-1">x</div>'))).not.toContain('tabindex-positive');
  });
});

describe('th-has-data-cells', () => {
  it('flags a multi-row table with no th', () => {
    const html = CLEAN.replace('<p>Text</p>', '<table><tr><td>a</td></tr><tr><td>b</td></tr></table>');
    expect(ids(html)).toContain('th-has-data-cells');
  });

  it('accepts a table with headers', () => {
    const html = CLEAN.replace('<p>Text</p>', '<table><tr><th>h</th></tr><tr><td>b</td></tr></table>');
    expect(ids(html)).not.toContain('th-has-data-cells');
  });

  it('skips single-row and presentational tables', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<table><tr><td>a</td></tr></table>'))).not.toContain('th-has-data-cells');
    const pres = '<table role="presentation"><tr><td>a</td></tr><tr><td>b</td></tr></table>';
    expect(ids(CLEAN.replace('<p>Text</p>', pres))).not.toContain('th-has-data-cells');
  });
});

describe('heading-order', () => {
  it('flags a skipped level', () => {
    const html = CLEAN.replace('<p>Text</p>', '<h2>a</h2><h4>b</h4>');
    expect(ids(html)).toContain('heading-order');
  });

  it('allows going back up multiple levels', () => {
    const html = CLEAN.replace('<p>Text</p>', '<h2>a</h2><h3>b</h3><h2>c</h2>');
    expect(ids(html)).not.toContain('heading-order');
  });
});

describe('empty-heading', () => {
  it('flags an empty heading but accepts one holding an image with alt', () => {
    expect(ids(CLEAN.replace('<p>Text</p>', '<h2></h2>'))).toContain('empty-heading');
    expect(ids(CLEAN.replace('<p>Text</p>', '<h2><img src="a.png" alt="Logo"></h2>'))).not.toContain('empty-heading');
  });
});

describe('duplicate-id', () => {
  it('flags a repeated id and reports the occurrence count', () => {
    const html = CLEAN.replace('<p>Text</p>', '<div id="x"></div><div id="x"></div><div id="x"></div>');
    const v = violation(html, 'duplicate-id');
    expect(v).toBeDefined();
    expect(v?.elements[0]).toContain('3 occurrences');
  });

  it('does not flag unique ids', () => {
    const html = CLEAN.replace('<p>Text</p>', '<div id="a"></div><div id="b"></div>');
    expect(ids(html)).not.toContain('duplicate-id');
  });
});

describe('scoring', () => {
  it('weights impact — one critical costs more than one minor', () => {
    const critical = scoreViolations([{ id: 'a', impact: 'critical', wcag: '', help: '', count: 1, elements: [] }]);
    const minor = scoreViolations([{ id: 'b', impact: 'minor', wcag: '', help: '', count: 1, elements: [] }]);
    expect(critical).toBeLessThan(minor);
  });

  it('scales with the number of failing elements', () => {
    const one = scoreViolations([{ id: 'a', impact: 'serious', wcag: '', help: '', count: 1, elements: [] }]);
    const five = scoreViolations([{ id: 'a', impact: 'serious', wcag: '', help: '', count: 5, elements: [] }]);
    expect(five).toBeLessThan(one);
  });

  it('floors at zero rather than going negative', () => {
    const score = scoreViolations([{ id: 'a', impact: 'critical', wcag: '', help: '', count: 500, elements: [] }]);
    expect(score).toBe(0);
  });
});

describe('countByImpact', () => {
  it('sums failing elements, not violation rows', () => {
    const violations: A11yViolation[] = [
      { id: 'a', impact: 'critical', wcag: '', help: '', count: 3, elements: [] },
      { id: 'b', impact: 'critical', wcag: '', help: '', count: 2, elements: [] },
      { id: 'c', impact: 'minor', wcag: '', help: '', count: 9, elements: [] },
    ];
    expect(countByImpact(violations, 'critical')).toBe(5);
    expect(countByImpact(violations, 'serious')).toBe(0);
  });
});

describe('element sampling', () => {
  it('caps the elements array but keeps count exact', () => {
    const imgs = Array.from({ length: 25 }, (_v, i) => `<img src="${i}.png">`).join('');
    const v = violation(CLEAN.replace('<p>Text</p>', imgs), 'image-alt');
    expect(v?.count).toBe(25);
    expect(v?.elements.length).toBe(MAX_ELEMENTS_PER_VIOLATION);
  });
});

describe('catalog integrity', () => {
  it('has unique rule ids and a WCAG reference on every rule', () => {
    const seen = new Set<string>();
    for (const rule of RULES) {
      expect(seen.has(rule.id)).toBe(false);
      seen.add(rule.id);
      expect(rule.wcag).toMatch(/^WCAG /);
      expect(rule.help.length).toBeGreaterThan(0);
    }
  });

  it('survives an empty document without throwing', () => {
    expect(() => audit('')).not.toThrow();
  });
});
