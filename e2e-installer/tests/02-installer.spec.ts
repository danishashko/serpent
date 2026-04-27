import { test, expect, _electron as electron, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * FULL install → launch → uninstall round-trip against the real NSIS installer.
 *
 * What this catches that 01-packed-app.spec.ts does not:
 *   - NSIS install script bugs (per-user vs per-machine, registry, shortcuts)
 *   - File-association registration
 *   - Files missing from the installer payload (vs win-unpacked/)
 *   - Uninstaller leaving artefacts behind
 *
 * Gated behind RUN_INSTALLER=1 so it does NOT run by default — a silent
 * install touches the user profile (Start Menu shortcuts, Add/Remove Programs,
 * %LOCALAPPDATA%\Programs) and we don't want to do that on every CI run.
 *
 * Run with:
 *   $env:RUN_INSTALLER='1'; npx playwright test --config playwright.installer.config.ts e2e-installer/tests/02-installer.spec.ts
 */

const RELEASE_DIR = resolve(__dirname, '..', '..', 'release');

function findInstaller(): string | null {
  if (!existsSync(RELEASE_DIR)) return null;
  const entries = readdirSync(RELEASE_DIR);
  const nsis = entries.find((f) => /^GhostFrog Setup .*\.exe$/i.test(f));
  return nsis ? join(RELEASE_DIR, nsis) : null;
}

const installer = findInstaller();

test.skip(
  process.env.RUN_INSTALLER !== '1',
  'Set RUN_INSTALLER=1 to run the silent install/uninstall round-trip.',
);
test.skip(
  !installer,
  `No "GhostFrog Setup *.exe" found in ${RELEASE_DIR}. Run "npm run dist" first.`,
);

test('NSIS installer: silent install → launch → smoke → silent uninstall', async () => {
  test.setTimeout(180_000);

  // Install into a disposable directory under tmp to avoid clobbering an
  // existing user-installed copy.
  const installDir = mkdtempSync(join(tmpdir(), 'ghostfrog-install-'));
  const exePath = join(installDir, 'GhostFrog.exe');
  const uninstallExe = join(installDir, 'Uninstall GhostFrog.exe');

  // ── INSTALL ────────────────────────────────────────────────────────────
  // electron-builder NSIS supports `/S` for silent + `/D=path` for install dir.
  // /D MUST be last and unquoted per NSIS docs.
  execFileSync(installer!, ['/S', `/D=${installDir}`], {
    stdio: 'inherit',
    timeout: 120_000,
    windowsHide: true,
  });

  expect(existsSync(exePath), `expected ${exePath} after silent install`).toBe(true);

  // ── LAUNCH INSTALLED BINARY ────────────────────────────────────────────
  const userDataDir = mkdtempSync(join(tmpdir(), 'ghostfrog-installed-userdata-'));
  const app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${userDataDir}`, '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
    timeout: 60_000,
  });

  try {
    const isAppWindow = (p: Page) => {
      const u = p.url();
      return !u.startsWith('devtools://') && !u.startsWith('chrome-devtools://');
    };

    const deadline = Date.now() + 30_000;
    let win: Page | undefined;
    while (Date.now() < deadline) {
      win = app.windows().find(isAppWindow);
      if (win) break;
      await app.waitForEvent('window', { timeout: 2_000 }).catch(() => undefined);
    }
    if (!win) throw new Error('Renderer window never appeared after install');

    await win.waitForLoadState('domcontentloaded');
    await expect(win.locator('text=GhostFrog').first()).toBeVisible({ timeout: 30_000 });
    await expect(win.getByRole('button', { name: /Crawl/ }).first()).toBeVisible();
  } finally {
    await app.close().catch(() => undefined);
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  // ── UNINSTALL ──────────────────────────────────────────────────────────
  if (existsSync(uninstallExe)) {
    execFileSync(uninstallExe, ['/S'], { stdio: 'inherit', timeout: 60_000, windowsHide: true });
  }

  // Best-effort cleanup if the uninstaller left files behind.
  try { rmSync(installDir, { recursive: true, force: true }); } catch { /* ignore */ }
});
