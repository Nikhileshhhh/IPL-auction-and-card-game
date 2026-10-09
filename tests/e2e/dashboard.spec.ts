import { expect, test } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
  withDb,
} from './support';

const CODE = 'e2e-dashboard-gate-code';

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

test('dashboard shows both game entry points, medal summary and works by keyboard', async ({
  page,
}, testInfo) => {
  const username = `dash_${testInfo.project.name}_${Date.now() % 100000}`;
  await onboardThroughUi(page, CODE, username);
  await expect(
    page.getByRole('heading', { name: new RegExp(`Welcome back, ${username.toUpperCase()}`, 'i') }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /Card Battle.*Play Card Battle/s })).toBeVisible();
  await expect(page.getByRole('link', { name: /Mega Auction.*Enter Auction/s })).toBeVisible();
  await expect(page.getByText('Gold', { exact: true })).toBeVisible();
  await expect(page.getByText(/No completed games yet/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath(`dashboard-${testInfo.project.name}.png`),
    fullPage: true,
  });

  // Keyboard: tab to the Card Battle tile and open it.
  const cardTile = page.getByRole('link', { name: /Play Card Battle/ });
  for (
    let i = 0;
    i < 20 && !(await cardTile.evaluate((el) => el === document.activeElement));
    i += 1
  ) {
    await page.keyboard.press('Tab');
  }
  await expect(cardTile).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/play\/cards$/);
  await expect(page.getByRole('heading', { name: 'Card Battle', level: 1 })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.goto('/play/auction');
  await expect(page.getByRole('heading', { name: 'Mega Auction', level: 1 })).toBeVisible();
  await page.goto(`/players/${username}`);
  await expect(page.getByRole('heading', { name: 'Medals' })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('dashboard reflows at 320px and 200% zoom without horizontal scrolling', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'viewport matrix runs once');
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const username = `zoom_${Date.now() % 100000}`;
  await onboardThroughUi(page, CODE, username);
  for (const viewport of [
    { width: 390, height: 844, label: '390' },
    { width: 768, height: 1024, label: '768' },
    { width: 640, height: 400, label: 'zoom200-1280' }, // 1280×800 at 200% zoom ≈ 640×400 CSS px
    { width: 320, height: 640, label: '320-reflow' },
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/play');
    await expect(page.getByRole('link', { name: /Play Card Battle/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${viewport.label}.png`),
      fullPage: true,
    });
  }
  await context.close();
});

test('going offline shows a persistent text banner; a stale gate redirects to access', async ({
  page,
  context,
}, testInfo) => {
  const username = `stale_${testInfo.project.name}_${Date.now() % 100000}`;
  await onboardThroughUi(page, CODE, username);
  await context.setOffline(true);
  await expect(page.getByRole('alert').filter({ hasText: 'Offline.' })).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText('Back online.')).toBeVisible();

  // Revoke every gate grant (as a revoking rotation would): the next navigation must re-verify.
  await withDb((c) =>
    c.query('UPDATE app_private.gate_grants SET revoked_at = now() WHERE revoked_at IS NULL'),
  );
  await page.goto('/play');
  await expect(page).toHaveURL(/\/access/);
});
