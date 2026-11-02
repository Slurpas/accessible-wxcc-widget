/**
 * Static security checks over the widget source (src/).
 * These guard the rules in SECURITY.md so a later change cannot silently
 * break them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sanitize } from '../src/utils/logger.js';

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk('src').filter((f) => /\.(js|css)$/.test(f));
const prodFiles = files.filter((f) => !f.includes('mock'));
const read = (f) => readFileSync(f, 'utf8');

describe('source security rules', () => {
  it('contains no secrets, tokens or credentials', () => {
    const patterns = [/client[_-]?secret/i, /api[_-]?key\s*[:=]/i, /Bearer\s+[A-Za-z0-9._-]{20,}/, /access[_-]?token\s*[:=]\s*['"][^'"]+/i, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
    for (const f of files) for (const p of patterns) expect(read(f), `${f} matches ${p}`).not.toMatch(p);
  });

  it('makes no direct network calls (all Webex access goes through the Desktop SDK)', () => {
    for (const f of prodFiles) {
      expect(read(f), f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket\s*\(|navigator\.sendBeacon/);
    }
  });

  it('never requests the Desktop access token', () => {
    for (const f of prodFiles) expect(read(f), f).not.toMatch(/getToken\s*\(|STORE\.auth|accessToken/);
  });

  it('uses localStorage only in widget.js for display preferences, never sessionStorage', () => {
    for (const f of prodFiles) {
      const s = read(f);
      expect(s, f).not.toMatch(/sessionStorage|indexedDB/);
      if (!f.endsWith('widget.js')) expect(s, f).not.toMatch(/localStorage/);
    }
  });

  it('never writes HTML from data (no innerHTML / insertAdjacentHTML / eval)', () => {
    for (const f of prodFiles) expect(read(f), f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|\beval\s*\(|new Function\s*\(/);
  });

  it('loads no third-party scripts or analytics', () => {
    for (const f of prodFiles) expect(read(f), f).not.toMatch(/https?:\/\/(?!developer\.webex\.com|help\.webex\.com)/);
  });
});

describe('logger sanitising', () => {
  it('never writes objects (payloads) into logs', () => {
    const payload = { data: { interaction: { callProcessingDetails: { ani: '+46461234567' } } } };
    const out = sanitize(['event', payload, new Error('boom'), 3]);
    expect(out).toEqual(['event', '[object]', 'Error: boom', 3]);
    expect(JSON.stringify(out)).not.toContain('+4646');
  });
});
