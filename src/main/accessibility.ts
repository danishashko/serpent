// Accessibility auditor.
//
// Static WCAG 2.2 checks over the parsed document, run during extraction on the
// same cheerio handle the SEO extractors use. There is no second fetch and no
// render pass, so accessibility data exists for every crawled page regardless
// of whether `jsRender` was enabled.
//
// The deliberate limitation: rules that need computed style or layout — colour
// contrast above all — cannot be evaluated from static markup and are not
// implemented. Everything here is decidable from the DOM tree alone.
//
// Rule ids and impact levels follow axe-core's vocabulary so results are
// comparable with the tooling people already run.

import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { A11yImpact, A11yViolation, A11yResult } from '../types/index';

// Impact weights for the 0-100 score. A single critical violation should hurt
// noticeably more than a pile of minor ones.
const IMPACT_WEIGHT: Record<A11yImpact, number> = {
  critical: 10,
  serious: 6,
  moderate: 3,
  minor: 1,
};

// Score floor. A page with 40 critical violations and a page with 400 are both
// simply broken; there is no useful signal in the difference.
const MAX_PENALTY = 100;

// Elements that take an accessible name from a <label>, aria-label,
// aria-labelledby or title. `type` values that render no user input are exempt.
const UNLABELLED_INPUT_TYPES_EXEMPT = new Set(['hidden', 'submit', 'reset', 'button', 'image']);

interface Rule {
  id: string;
  impact: A11yImpact;
  wcag: string;
  help: string;
  // Returns the selector-ish descriptions of each failing element.
  check: ($: CheerioAPI) => string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function describe($: CheerioAPI, el: Element): string {
  const $el = $(el);
  const tag = (el as { tagName?: string }).tagName ?? 'element';
  const id = $el.attr('id');
  const cls = $el.attr('class');
  if (id) return `${tag}#${id}`;
  if (cls) return `${tag}.${cls.trim().split(/\s+/)[0]}`;
  const text = $el.text().trim().slice(0, 40);
  return text ? `${tag} ("${text}")` : tag;
}

// An element has an accessible name if it has visible text, an aria-label, an
// aria-labelledby pointing at something, or a title.
function hasAccessibleName($: CheerioAPI, el: Element): boolean {
  const $el = $(el);
  if ($el.text().trim() !== '') return true;
  if (($el.attr('aria-label') ?? '').trim() !== '') return true;
  if (($el.attr('title') ?? '').trim() !== '') return true;
  const labelledBy = ($el.attr('aria-labelledby') ?? '').trim();
  if (labelledBy !== '') {
    // Any one of the referenced ids resolving is enough.
    for (const ref of labelledBy.split(/\s+/)) {
      if (ref && $(`#${CSS_ESCAPE(ref)}`).length > 0) return true;
    }
  }
  // An image with alt text inside a link/button names the control.
  const alt = $el.find('img[alt]').filter((_i, img) => ($(img).attr('alt') ?? '').trim() !== '');
  if (alt.length > 0) return true;
  // So does an <svg><title>.
  if ($el.find('svg > title').filter((_i, t) => $(t).text().trim() !== '').length > 0) return true;
  return false;
}

// cheerio's selector engine chokes on ids containing CSS metacharacters. Ids
// like "field.name" are legal HTML, so escape before interpolating.
function CSS_ESCAPE(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

// BCP-47-ish: a 2-3 letter primary subtag, optional well-formed subtags.
const LANG_RE = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})*$/;

// ─── Rules ───────────────────────────────────────────────────────────────────

export const RULES: Rule[] = [
  {
    id: 'image-alt',
    impact: 'critical',
    wcag: 'WCAG 1.1.1',
    help: 'Images must have an alt attribute. Use alt="" for decorative images so screen readers skip them.',
    check: ($) =>
      $('img:not([alt])')
        .filter((_i, el) => ($(el).attr('role') ?? '').toLowerCase() !== 'presentation')
        .map((_i, el) => describe($, el))
        .get(),
  },
  {
    id: 'input-label',
    impact: 'critical',
    wcag: 'WCAG 1.3.1, 4.1.2',
    help: 'Every form control needs a programmatic label — a <label for>, aria-label, or aria-labelledby.',
    check: ($) => {
      const out: string[] = [];
      $('input, select, textarea').each((_i, el) => {
        const $el = $(el);
        const type = ($el.attr('type') ?? '').toLowerCase();
        if (UNLABELLED_INPUT_TYPES_EXEMPT.has(type)) return;
        if (($el.attr('aria-label') ?? '').trim() !== '') return;
        if (($el.attr('aria-labelledby') ?? '').trim() !== '') return;
        if (($el.attr('title') ?? '').trim() !== '') return;
        const id = $el.attr('id');
        if (id && $(`label[for="${CSS_ESCAPE(id)}"]`).length > 0) return;
        // A control wrapped in its own <label> is labelled implicitly.
        if ($el.parents('label').length > 0) return;
        out.push(describe($, el));
      });
      return out;
    },
  },
  {
    id: 'button-name',
    impact: 'critical',
    wcag: 'WCAG 4.1.2',
    help: 'Buttons must expose a name. Add text content, aria-label, or a titled icon.',
    check: ($) =>
      $('button, [role="button"]')
        .filter((_i, el) => !hasAccessibleName($, el))
        .map((_i, el) => describe($, el))
        .get(),
  },
  {
    id: 'meta-viewport',
    impact: 'critical',
    wcag: 'WCAG 1.4.4',
    help: 'The viewport meta tag must not block zooming. Remove user-scalable=no and allow maximum-scale of at least 2.',
    check: ($) => {
      const content = ($('meta[name="viewport"]').attr('content') ?? '').toLowerCase();
      if (content === '') return [];
      const blocksScaling = /user-scalable\s*=\s*(no|0)/.test(content);
      const maxScale = content.match(/maximum-scale\s*=\s*([\d.]+)/);
      const capped = maxScale != null && parseFloat(maxScale[1]) < 2;
      return blocksScaling || capped ? [`meta[name="viewport"] ("${content}")`] : [];
    },
  },
  {
    id: 'link-name',
    impact: 'serious',
    wcag: 'WCAG 2.4.4, 4.1.2',
    help: 'Links must have discernible text. An icon-only link needs an aria-label.',
    check: ($) =>
      $('a[href]')
        .filter((_i, el) => !hasAccessibleName($, el))
        .map((_i, el) => describe($, el))
        .get(),
  },
  {
    id: 'html-has-lang',
    impact: 'serious',
    wcag: 'WCAG 3.1.1',
    help: 'The <html> element must have a lang attribute so screen readers pick the right pronunciation.',
    check: ($) => {
      const lang = $('html').attr('lang');
      return lang == null || lang.trim() === '' ? ['html'] : [];
    },
  },
  {
    id: 'html-lang-valid',
    impact: 'serious',
    wcag: 'WCAG 3.1.1',
    help: 'The lang attribute must be a valid BCP-47 language tag, e.g. "en" or "en-GB".',
    check: ($) => {
      const lang = ($('html').attr('lang') ?? '').trim();
      if (lang === '') return []; // html-has-lang already reports this
      return LANG_RE.test(lang) ? [] : [`html[lang="${lang}"]`];
    },
  },
  {
    id: 'document-title',
    impact: 'serious',
    wcag: 'WCAG 2.4.2',
    help: 'Every document needs a non-empty <title> — it is the first thing a screen reader announces.',
    check: ($) => ($('title').first().text().trim() === '' ? ['title'] : []),
  },
  {
    id: 'frame-title',
    impact: 'serious',
    wcag: 'WCAG 2.4.1, 4.1.2',
    help: 'Each <iframe> needs a title attribute describing its contents.',
    check: ($) =>
      $('iframe, frame')
        .filter((_i, el) => ($(el).attr('title') ?? '').trim() === '')
        .map((_i, el) => describe($, el))
        .get(),
  },
  {
    id: 'tabindex-positive',
    impact: 'serious',
    wcag: 'WCAG 2.4.3',
    help: 'Avoid tabindex greater than zero — it overrides the natural focus order and is near-impossible to keep consistent.',
    check: ($) =>
      $('[tabindex]')
        .filter((_i, el) => {
          const raw = ($(el).attr('tabindex') ?? '').trim();
          const n = Number(raw);
          return Number.isFinite(n) && n > 0;
        })
        .map((_i, el) => describe($, el))
        .get(),
  },
  {
    id: 'th-has-data-cells',
    impact: 'serious',
    wcag: 'WCAG 1.3.1',
    help: 'Data tables need header cells. Add <th> (with scope) so the relationship between headers and cells is programmatic.',
    check: ($) => {
      const out: string[] = [];
      $('table').each((_i, el) => {
        const $t = $(el);
        // A presentational table declares itself as such.
        const role = ($t.attr('role') ?? '').toLowerCase();
        if (role === 'presentation' || role === 'none') return;
        // Single-row tables are usually layout, not data.
        if ($t.find('tr').length < 2) return;
        if ($t.find('th').length === 0) out.push(describe($, el));
      });
      return out;
    },
  },
  {
    id: 'heading-order',
    impact: 'moderate',
    wcag: 'WCAG 1.3.1',
    help: 'Heading levels must not skip — an h2 should not be followed directly by an h4.',
    check: ($) => {
      const out: string[] = [];
      let previous = 0;
      $('h1, h2, h3, h4, h5, h6').each((_i, el) => {
        const tag = (el as { tagName?: string }).tagName ?? 'h1';
        const level = Number(tag.slice(1));
        if (previous !== 0 && level > previous + 1) {
          out.push(`${tag} after h${previous} ("${$(el).text().trim().slice(0, 40)}")`);
        }
        previous = level;
      });
      return out;
    },
  },
  {
    id: 'empty-heading',
    impact: 'minor',
    wcag: 'WCAG 1.3.1',
    help: 'Headings must not be empty — they are the primary way screen reader users navigate a page.',
    check: ($) =>
      $('h1, h2, h3, h4, h5, h6')
        .filter((_i, el) => $(el).text().trim() === '' && $(el).find('img[alt]').length === 0)
        .map((_i, el) => describe($, el))
        .get(),
  },
  {
    id: 'duplicate-id',
    impact: 'minor',
    wcag: 'WCAG 4.1.1',
    help: 'id values must be unique — aria-labelledby and label[for] resolve to the first match only.',
    check: ($) => {
      const seen = new Map<string, number>();
      $('[id]').each((_i, el) => {
        const id = ($(el).attr('id') ?? '').trim();
        if (id === '') return;
        seen.set(id, (seen.get(id) ?? 0) + 1);
      });
      const out: string[] = [];
      for (const [id, count] of seen) {
        if (count > 1) out.push(`#${id} (${count} occurrences)`);
      }
      return out;
    },
  },
];

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Runs every static rule over a parsed document.
 *
 * `elements` on each violation is capped so a page with thousands of unlabelled
 * inputs does not write a megabyte of JSON per row; `count` stays exact.
 */
export const MAX_ELEMENTS_PER_VIOLATION = 10;

export function auditAccessibility($: CheerioAPI): A11yResult {
  const violations: A11yViolation[] = [];

  for (const rule of RULES) {
    let failing: string[];
    try {
      failing = rule.check($);
    } catch {
      // A malformed document should degrade one rule, not the whole audit.
      continue;
    }
    if (failing.length === 0) continue;
    violations.push({
      id: rule.id,
      impact: rule.impact,
      wcag: rule.wcag,
      help: rule.help,
      count: failing.length,
      elements: failing.slice(0, MAX_ELEMENTS_PER_VIOLATION),
    });
  }

  return { score: scoreViolations(violations), violations };
}

/**
 * 0-100, where 100 is "no static violations found". Penalty is per violating
 * element, weighted by impact, so ten missing alts cost more than one.
 */
export function scoreViolations(violations: A11yViolation[]): number {
  let penalty = 0;
  for (const v of violations) {
    penalty += IMPACT_WEIGHT[v.impact] * v.count;
  }
  return Math.max(0, 100 - Math.min(penalty, MAX_PENALTY));
}

export function countByImpact(violations: A11yViolation[], impact: A11yImpact): number {
  let n = 0;
  for (const v of violations) {
    if (v.impact === impact) n += v.count;
  }
  return n;
}
