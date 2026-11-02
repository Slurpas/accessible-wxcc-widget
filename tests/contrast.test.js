/**
 * WCAG contrast check for every text/background pair defined in themes.css.
 * Requirement: 4.5:1 for all text (AA normal text), even though status
 * labels are large text where 3:1 would be enough. Non-text UI (borders,
 * focus ring) must reach 3:1 against the page background.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/themes.css', 'utf8');

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--awx-([\w-]+):\s*(#[0-9a-f]{6})/gi)) out[m[1]] = m[2];
  return out;
}

function block(re) {
  const m = css.match(re);
  if (!m) throw new Error(`theme block not found: ${re}`);
  return m[1];
}
const base = tokens(block(/:host \{([^}]*)\}/));
const dark = { ...base, ...tokens(block(/:host\(\[theme='dark'\]\) \{([^}]*)\}/)) };
const light = { ...base, ...tokens(block(/:host\(\[theme='light'\]\) \{([^}]*)\}/)) };

function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const chipPairs = ['ready', 'notready', 'busy', 'wrapup', 'offline', 'unknown', 'error', 'lunch', 'break', 'admin'];

for (const [name, t] of [['dark', dark], ['light', light]]) {
  describe(`${name} theme`, () => {
    it.each(chipPairs)('%s chip text >= 4.5:1', (k) => {
      expect(contrast(t[`${k}-bg`], t[`${k}-fg`])).toBeGreaterThanOrEqual(4.5);
    });
    it('body text >= 7:1 (AAA) on page and panels', () => {
      expect(contrast(t.text, t.bg)).toBeGreaterThanOrEqual(7);
      expect(contrast(t.text, t['panel-bg'])).toBeGreaterThanOrEqual(7);
      expect(contrast(t['text-muted'], t['panel-bg'])).toBeGreaterThanOrEqual(7);
    });
    it('message banners >= 4.5:1', () => {
      expect(contrast(t['warn-bg'], t['warn-fg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['error-msg-bg'], t['error-msg-fg'])).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t['btn-bg'], t['btn-fg'])).toBeGreaterThanOrEqual(4.5);
    });
    it('borders and focus ring >= 3:1 against the page', () => {
      expect(contrast(t.border, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.focus, t.bg)).toBeGreaterThanOrEqual(3);
      expect(contrast(t['current-ring'], t.bg)).toBeGreaterThanOrEqual(3);
    });
  });
}
