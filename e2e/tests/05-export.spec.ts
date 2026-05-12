import { test, expect } from '../fixtures';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Export round-trip: write a tiny CSV/JSON via the export IPCs and verify
 * the file lands on disk with the expected contents.
 *
 * NOTE: The export IPC currently shows a save dialog. We stub electron.dialog
 * via main-process evaluation so the test can run headless.
 */
test.describe('Export', () => {
  test('exportCsv writes file to disk', async ({ electronApp, window }) => {
    const outPath = join(tmpdir(), `serpent-e2e-export-${Date.now()}.csv`);

    // Stub the save dialog inside the main process to return our path.
    await electronApp.evaluate(async ({ dialog }, savePath) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dialog as any).showSaveDialog = async () => ({ canceled: false, filePath: savePath });
    }, outPath);

    const result = await window.evaluate(async (filename) => {
      // @ts-expect-error
      return await window.api.exportCsv({
        rows: [
          { url: 'https://a.test', status: 200 },
          { url: 'https://b.test', status: 404 },
        ],
        filename,
      });
    }, outPath);

    expect(result).toMatchObject({ success: true });
    expect(existsSync(outPath)).toBe(true);

    const csv = readFileSync(outPath, 'utf8');
    expect(csv).toContain('url');
    expect(csv).toContain('https://a.test');
    expect(csv).toContain('404');

    rmSync(outPath, { force: true });
  });
});
