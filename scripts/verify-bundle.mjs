/**
 * Post-build checks on dist/accessible-wxcc-widget.js. Fails the build (exit 1) if:
 *  - the bundle is missing or unexpectedly large
 *  - mock/demo code leaked into production
 *  - something that looks like a secret is present
 *  - the widget's styles or element registration are missing
 * Also writes dist/build-info.json (version + SHA-384 for Subresource Integrity / change tracking).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FILE = 'dist/accessible-wxcc-widget.js';
const MAX_BYTES = 600 * 1024;
const failures = [];

if (!existsSync(FILE)) {
  console.error(`Missing ${FILE}. Run "npm run build" first.`);
  process.exit(1);
}
const code = readFileSync(FILE, 'utf8');
const bytes = Buffer.byteLength(code);

const check = (ok, msg) => {
  if (!ok) failures.push(msg);
};

check(bytes < MAX_BYTES, `Bundle is ${bytes} bytes (limit ${MAX_BYTES}).`);
check(code.includes('accessible-wxcc-widget'), 'Element name not found in bundle.');
check(code.includes('customElements'), 'customElements registration not found.');
check(code.includes('--awx-ready-bg'), 'Widget styles were not inlined.');
check(!/Demo Anna|createMockAdapter|mock-desktop|MOCK Desktop adapter/.test(code), 'Mock/demo code found in production bundle.');
check(!/client[_-]?secret/i.test(code), 'Possible client secret found.');
check(!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(code), 'Private key found.');
check(!/Bearer\s+[A-Za-z0-9._-]{20,}/.test(code), 'Hard-coded bearer token found.');

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const sri = `sha384-${createHash('sha384').update(code).digest('base64')}`;
writeFileSync(
  'dist/build-info.json',
  `${JSON.stringify({ name: pkg.name, version: pkg.version, file: 'accessible-wxcc-widget.js', bytes, integrity: sri, builtAt: new Date().toISOString() }, null, 2)}\n`,
);

if (failures.length) {
  console.error('Bundle verification FAILED:\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log(`Bundle verification passed: ${FILE} (${(bytes / 1024).toFixed(1)} KiB, ${sri})`);
