import { defineConfig } from '@playwright/test';

/**
 * Installer / packed-app E2E config.
 *
 * Separate from the main playwright.config.ts because these tests:
 *   - Do NOT need the Vite preview server (the packed/installed app loads
 *     dist/renderer/index.html via file://).
 *   - Do NOT need globalSetup (no rebuild — they use a pre-built artifact).
 *   - Are SLOW and meant to be run on demand / pre-release, not on every push.
 *
 * Run with:
 *   npm run test:installer            # packed-only (fast, ~30s)
 *   npm run test:installer:full       # includes silent installer + uninstall
 *
 * Prereq: `npm run dist` has been run at least once so that
 *   release/win-unpacked/GhostFrog.exe  exists, and
 *   release/GhostFrog Setup 1.0.0.exe   exists.
 */
export default defineConfig({
  testDir: './e2e-installer/tests',
  timeout: 300_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
