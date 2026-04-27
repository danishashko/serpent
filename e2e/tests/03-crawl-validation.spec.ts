import { test, expect } from '../fixtures';

test.describe('Crawl form validation', () => {
  test('shows toast when starting without a seed URL', async ({ window }) => {
    // Make sure URL field is empty
    const urlInput = window.locator('input[type="url"]').first();
    await expect(urlInput).toBeVisible();
    await urlInput.fill('');

    await window.getByRole('button', { name: /Start Crawl/i }).click();

    await expect(window.getByText(/enter a seed URL/i)).toBeVisible({ timeout: 5_000 });
  });

  test('list mode requires at least one URL', async ({ window }) => {
    await window.getByRole('button', { name: /List$/ }).click();
    await window.getByRole('button', { name: /Start Crawl/i }).click();
    await expect(window.getByText(/at least one URL/i)).toBeVisible({ timeout: 5_000 });
  });

  test('Max URLs accepts numeric entry', async ({ window }) => {
    const maxUrls = window.locator('input[type="number"]').first();
    await maxUrls.fill('42');
    await expect(maxUrls).toHaveValue('42');
  });
});
