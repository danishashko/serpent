import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Build renderer + main once before the suite.
 * Also wipes the e2e tmp dir so userData isolation starts clean.
 */
export default async function globalSetup(): Promise<void> {
  const root = join(__dirname, '..');
  const tmpDir = join(root, 'e2e', '.tmp');

  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });

  if (process.env.SKIP_BUILD === '1') {
    console.log('[e2e] SKIP_BUILD=1 — reusing existing dist/');
    return;
  }

  console.log('[e2e] Building renderer + main...');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });
  console.log('[e2e] Build complete.');
}
