import { defineConfig } from '@playwright/test';

/**
 * Playwright config for Serpent Electron E2E tests.
 *
 * Strategy:
 *   - globalSetup builds the renderer + main once before any test runs.
 *   - Each test launches Electron via _electron.launch() with an isolated
 *     userData directory so SQLite/keytar state doesn't leak between tests.
 *   - We point the app at a Vite preview server (started below) so the
 *     prod-built renderer loads via http://localhost:5173 — matching the
 *     dev-mode branch in src/main/index.ts (isDev → loadURL).
 *   - Single worker: keytar + global app singleton + fixed port = serial.
 */
export default defineConfig({
  testDir: './e2e/tests',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  globalSetup: './e2e/global-setup.ts',
  webServer: {
    command: 'npx vite preview --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
