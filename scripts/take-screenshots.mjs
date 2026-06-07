/**
 * Screenshot capture script — takes UI screenshots for the README.
 * Launches the app, runs a quick crawl on example.com, then captures tabs.
 *
 * Usage:  node scripts/take-screenshots.mjs
 */

import { _electron as electron } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = join(__dirname, '..');
const DOCS       = join(ROOT, 'docs');

mkdirSync(DOCS, { recursive: true });

// Fresh user-data dir so we don't touch real DB
const userDataDir = mkdtempSync(join(tmpdir(), 'serpent-screenshot-'));

console.log('Launching Serpent…');

const app = await electron.launch({
  args: ['.', `--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu'],
  cwd: ROOT,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  timeout: 30_000,
});

// Get the main app window (skip DevTools)
const isAppWindow = (p) => {
  const u = p.url();
  return !u.startsWith('devtools://') && !u.startsWith('chrome-devtools://');
};

const deadline = Date.now() + 30_000;
let win;
while (Date.now() < deadline) {
  const wins = app.windows();
  win = wins.find(isAppWindow);
  if (win) break;
  await app.waitForEvent('window', { timeout: 3_000 }).catch(() => undefined);
}
if (!win) throw new Error('App window never appeared');

await win.waitForLoadState('domcontentloaded');
await win.waitForTimeout(2500);
await win.setViewportSize({ width: 1440, height: 900 });
await win.waitForTimeout(500);

// ─── Start a quick crawl on example.com ──────────────────────────────────────
console.log('Starting crawl on example.com…');
await win.evaluate(async () => {
  await window.api.crawlStart({
    startUrl: 'https://ahrefs.com',
    engine: 'local',
    maxUrls: 100,
    maxDepth: 3,
    rateLimit: 300,
    extractTitles: true,
    extractMeta: true,
    extractLinks: true,
    extractImages: true,
    extractHreflang: false,
    respectRobots: true,
    customRobots: '',
    userAgent: 'Serpent',
    mode: 'spider',
    customSelectors: [],
  });
});

// Wait for crawl to complete (up to 5 min for a real site)
console.log('Waiting for crawl to finish… (this may take a few minutes)');
for (let i = 0; i < 300; i++) {
  await win.waitForTimeout(1000);
  const status = await win.evaluate(() => {
    const text = document.body.innerText;
    // Check for "Completed" status indicator
    if (text.includes('Completed')) return 'completed';
    // Check for progress count > 5 pages scanned
    const m = text.match(/Total:\s*(\d+)/);
    if (m && parseInt(m[1]) >= 5) return 'has_pages';
    // Check for crawl stopped or error state
    if (text.includes('Stopped') || text.includes('Error')) return 'stopped';
    return null;
  });
  if (status === 'completed' || status === 'stopped') {
    const total = await win.evaluate(() => {
      const m = document.body.innerText.match(/Total:\s*(\d+)/);
      return m ? parseInt(m[1]) : '?';
    });
    console.log(`Crawl ${status}: ${total} pages`);
    break;
  }
  if (status === 'has_pages' && i > 30) {
    // Crawl is taking too long — take screenshots with whatever we have
    console.log('Taking screenshots with in-progress data…');
    break;
  }
  if (i % 10 === 0) process.stdout.write(`  ${i}s elapsed…\n`);
}

await win.waitForTimeout(1500);

// ─── 1. Hero — full app with crawl results ────────────────────────────────────
console.log('Screenshot 1: hero (full crawl view)…');
await win.screenshot({ path: join(DOCS, 'screenshot-pages.png') });

// ─── 2. Issues tab ────────────────────────────────────────────────────────────
console.log('Screenshot 2: Issues tab…');
// Click the "Issues List" sub-tab (shows the detailed issue table with counts)
await win.evaluate(() => {
  const buttons = Array.from(document.querySelectorAll('button.btn-icon'));
  const issuesListBtn = buttons.find(b => b.textContent.trim().startsWith('Issues List'));
  if (issuesListBtn) issuesListBtn.click();
});
await win.waitForTimeout(1000);
await win.screenshot({ path: join(DOCS, 'screenshot-issues.png') });

// ─── 3. Settings view ─────────────────────────────────────────────────────────
console.log('Screenshot 3: Settings…');
const settingsBtn = win.getByText('⚙️ Settings');
if (await settingsBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await settingsBtn.click();
  await win.waitForTimeout(800);
}
// Mask sensitive field values before screenshot
await win.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('input[type="text"], input:not([type="password"]):not([type="number"]):not([type="checkbox"])'));
  for (const input of inputs) {
    const v = input.value.trim();
    // Zone names: short identifiers, not URLs, not numbers, not common config values
    if (v && !v.startsWith('http') && !v.match(/^\d/) && v !== 'Serpent' && v.length < 50 && v.includes('_')) {
      input.value = 'your-zone-name';
    }
  }
});
await win.screenshot({ path: join(DOCS, 'screenshot-settings.png') });

// ─── 4. Back to Crawl — Map/Treemap tab ───────────────────────────────────────
console.log('Screenshot 4: Crawl — Map tab (treemap)…');
const crawlBtn = win.getByText('🔍 Crawl');
if (await crawlBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
  await crawlBtn.click();
  await win.waitForTimeout(500);
}
const mapTab = win.locator('button').filter({ hasText: /^Map/ }).first();
if (await mapTab.isVisible({ timeout: 2000 }).catch(() => false)) {
  await mapTab.click();
  await win.waitForTimeout(1000);
} else {
  // fallback: click via evaluate
  await win.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button.btn-icon'));
    const mapBtn = buttons.find(b => b.textContent.trim().startsWith('Map'));
    if (mapBtn) mapBtn.click();
  });
  await win.waitForTimeout(1000);
}
await win.screenshot({ path: join(DOCS, 'screenshot-treemap.png') });

await app.close();
rmSync(userDataDir, { recursive: true, force: true });
console.log('Done! Screenshots saved to docs/');
