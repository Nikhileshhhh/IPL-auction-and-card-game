import sharp from 'sharp';
import { expect, test, type Page } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
  totp,
  withDb,
} from './support';

const CODE = 'e2e-cards-gate-code';

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

/** Every rendered card has its player photo(s) loaded — never omitted (ADR-017). */
async function expectPortraitsLoaded(page: Page) {
  const cards = page.locator('article[data-rarity]');
  await expect(cards.first()).toBeVisible();
  const count = await cards.count();
  for (let i = 0; i < count; i += 1) {
    const card = cards.nth(i);
    await card.scrollIntoViewIfNeeded(); // portraits below the fold load lazily
    const rarity = await card.getAttribute('data-rarity');
    const imgs = card.locator('img[data-portrait="photo"]');
    await expect(imgs).toHaveCount(rarity === 'dual_platinum' ? 2 : 1);
    for (let j = 0; j < (await imgs.count()); j += 1) {
      await expect
        .poll(() =>
          imgs.nth(j).evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0),
        )
        .toBe(true);
    }
  }
}

test('card pool shows six rarities with player photos and 0–100 Game ratings', async ({
  page,
}, testInfo) => {
  // Onboarding, every portrait load and two full-page axe scans.
  test.setTimeout(90_000);
  await onboardThroughUi(page, CODE, `cards_${testInfo.project.name}_${Date.now() % 100000}`);
  await page.goto('/play/cards');
  await page.getByRole('link', { name: 'Browse the card pool' }).click();
  await expect(page.getByRole('heading', { name: 'Card pool', level: 1 })).toBeVisible();
  const showcase = page.getByRole('region', { name: 'Six rarities' });
  for (const rarity of ['Normal', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Dual Platinum']) {
    await expect(showcase.getByText(rarity, { exact: true })).toBeVisible();
  }
  await expectPortraitsLoaded(page);
  // Ratings are definite whole numbers on a 0–100 scale (never estimated or blank).
  const values = await page.locator('article[data-rarity] dd').allTextContents();
  expect(values.length).toBeGreaterThan(30);
  for (const v of values) {
    expect(v.trim()).toMatch(/^\d{1,3}$/);
    const n = Number(v.trim());
    expect(n >= 0 && n <= 100).toBe(true);
  }
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalScroll(page);
  await page.screenshot({
    path: testInfo.outputPath(`card-pool-${testInfo.project.name}.png`),
    fullPage: true,
  });

  // S10 detail: raw statistics, scope and provenance.
  await showcase.getByRole('button', { name: /Open Gold card details/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByText('Raw statistics: Demo league 2023–2025 (fictional players)'),
  ).toBeVisible();
  await expect(dialog.getByRole('table').first()).toBeVisible();
  await expect(dialog.getByText(/not official ratings/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.screenshot({ path: testInfo.outputPath(`card-detail-${testInfo.project.name}.png`) });
});

test('administrator uploads a player photo with rights evidence in the catalog editor', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'admin flow runs once');
  test.setTimeout(120_000);
  const username = `catadmin_${Date.now() % 100000}`;
  const { email, password } = await onboardThroughUi(page, CODE, username);
  await withDb((c) =>
    c.query(
      `INSERT INTO app_private.admin_assignments (user_id, role, mfa_enrollment_until)
       SELECT user_id, 'super_admin', now() + interval '1 hour' FROM app_private.profiles WHERE username = $1`,
      [username],
    ),
  );
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const secret = (await page.getByLabel('Authenticator secret').textContent())!.replace(/\s/g, '');
  await page.getByLabel('Authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm authenticator' }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.getByRole('link', { name: 'Player catalog' }).click();
  await expect(page.getByRole('heading', { name: 'Player catalog', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Import demo pack' }).click();
  await expect(page.getByText(/Import succeeded/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByRole('heading', { name: /Demo pack/, level: 2 })).toBeVisible();

  // Upload a replacement photo for the first player.
  const firstRow = page.locator('tbody tr').first();
  await firstRow.getByRole('button', { name: 'Upload' }).click();
  const png = await sharp({
    create: { width: 600, height: 800, channels: 3, background: '#2d6a4f' },
  })
    .png()
    .toBuffer();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByLabel('Image file')
    .setInputFiles({ name: 'player.png', mimeType: 'image/png', buffer: png });
  const upload = dialog.getByRole('button', { name: 'Upload photo' });
  await dialog.getByLabel('Licence', { exact: true }).fill('Image licence agreement #E2E');
  await dialog.getByLabel('Licence holder / photographer').fill('E2E Photographer');
  await dialog.getByLabel('Credit line shown to players').fill('Photo: E2E Photographer, licensed');
  // The IPL jersey confirmation is mandatory.
  await expect(upload).toBeDisabled();
  await dialog
    .getByLabel('The photo shows this player wearing their IPL franchise jersey.')
    .check();
  await dialog.getByRole('button', { name: 'Upload photo' }).click();
  await expect(page.getByText('Photo uploaded and attached to draft versions.')).toBeVisible();
  await expect(firstRow.getByText('Photo: E2E Photographer, licensed')).toBeVisible();
  await expect(firstRow.getByText('Ready for publishing')).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('tab', { name: 'Card preview' }).click();
  await expectPortraitsLoaded(page);
  await page.screenshot({ path: testInfo.outputPath('admin-catalog.png'), fullPage: true });
});
