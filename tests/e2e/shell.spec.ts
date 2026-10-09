import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('branded shell (phase 01)', () => {
  test('root redirects to the access gate', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/access$/);
    await expect(page.getByRole('heading', { name: 'Private club access' })).toBeVisible();
  });

  test('feature-flagged areas say they are unavailable instead of faking success', async ({
    page,
  }) => {
    await page.goto('/play/cards');
    await expect(page.getByRole('heading', { name: 'Card Battle' })).toBeVisible();
    await expect(page.getByText(/not available yet/)).toBeVisible();
  });

  test('access page has no serious automated accessibility violations', async ({ page }) => {
    await page.goto('/access');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const serious = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });

  test('no horizontal page scroll at the current viewport', async ({ page }) => {
    await page.goto('/play');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
});
