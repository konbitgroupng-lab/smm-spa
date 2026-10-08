import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Phase 5 hardening: helper text in the booking funnel and confirmation page
// meets WCAG 2.1 AA contrast (4.5:1 for normal text) on every panel it sits on.
// (The site-wide gold eyebrow labels are a separate, Phase 6 decision.)

const root = path.resolve(__dirname, '../..');
const css = readFileSync(path.join(root, 'src/index.css'), 'utf8');

function token(name: string): string {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`colour token ${name} not found`);
  return match[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.tsx') ? [full] : [];
  });
}

describe('booking funnel helper text contrast', () => {
  it('the helper-text colour reaches 4.5:1 on white, cream, linen and taupe panels', () => {
    const text = token('spa-clay-text');
    for (const background of ['#ffffff', token('spa-cream'), token('spa-linen'), token('spa-taupe')]) {
      expect(contrast(text, background), `${text} on ${background}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('the previous, too-light helper colour really did fail on linen (why this test exists)', () => {
    expect(contrast(token('spa-clay'), token('spa-linen'))).toBeLessThan(4.5);
  });

  it('funnel and confirmation text never uses the too-light colour again', () => {
    const offenders = files(path.join(root, 'src/booking')).flatMap((file) =>
      readFileSync(file, 'utf8').split('\n')
        .map((line, i) => ({ line, at: `${path.relative(root, file)}:${i + 1}` }))
        // Plain text-spa-clay (no suffix); placeholder hints inside empty inputs are not helper text.
        .filter(({ line }) => /(?<![\w:-])text-spa-clay(?![-\w])/.test(line))
        .map(({ at }) => at));
    expect(offenders).toEqual([]);
  });
});
