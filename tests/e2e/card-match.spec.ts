import { expect, test, type Page } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
} from './support';

const CODE = 'e2e-card-match-code';
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const FINISHED = /^(Match complete|You won the match!)$/;

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

/** Click the first category if this page holds the selector's enabled controls. */
async function playIfSelector(page: Page): Promise<boolean> {
  const batting = page.getByRole('button', { name: /^Batting/ });
  if (!(await batting.isVisible().catch(() => false))) return false;
  if (!(await batting.isEnabled().catch(() => false))) return false;
  await batting.click();
  return true;
}

test('two players play an 8-card match to the end; photos on every revealed card', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'two-context flow runs once (guest at 360 px)');
  test.setTimeout(240_000);
  const suffix = Date.now() % 100000;
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await onboardThroughUi(host, CODE, `mhost_${suffix}`);
  await onboardThroughUi(guest, CODE, `mguest_${suffix}`);

  await host.goto('/play/cards/create');
  await host.getByLabel('Room name').fill('E2E match');
  await host.getByLabel('Maximum players').fill('2');
  await host.getByLabel('Total cards').fill('8');
  await host.getByRole('button', { name: 'Create room' }).click();
  await expect(host).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/lobby$/);
  const code = (await host.getByText(ROOM_CODE).textContent()) ?? '';

  await guest.goto('/play/cards/join');
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(guest).toHaveURL(/\/lobby$/);
  await guest.getByRole('button', { name: "I'm ready" }).click();
  await host.getByRole('button', { name: "I'm ready" }).click();
  await expect(host.getByText('2 of 2 joined · 2 ready')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Both browsers move to the arena through the preparation page (S08 → S09).
  for (const page of [host, guest]) {
    await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/(preparing|cards)$/);
    await expect(page).toHaveURL(/\/cards$/, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Turn' })).toBeVisible();
  }
  // Every revealed card shows its player photo (ADR-017); the 360 px guest sees its own card.
  const hostCards = host.getByTestId('revealed-card');
  await expect(hostCards).toHaveCount(2);
  for (const card of await hostCards.all()) {
    await expect(card.locator('img[data-portrait]').first()).toBeVisible();
  }
  await expect(
    guest.getByTestId('revealed-card').locator('img[data-portrait]').first(),
  ).toBeVisible();
  await expect(host.getByText(/\d+ in deck/).first()).toBeVisible();
  // The viewer's own deck is a queue: the card in play first, then the rest in order.
  const queue = host.getByRole('list', { name: 'Your deck in play order' });
  await expect(queue.getByRole('listitem')).toHaveCount(4);
  await expect(queue.getByText('In play')).toBeVisible();

  await expectNoSeriousA11yViolations(host);
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);
  await host.screenshot({ path: testInfo.outputPath('arena-host.png'), fullPage: true });
  await guest.screenshot({ path: testInfo.outputPath('arena-guest-360.png'), fullPage: true });

  // Only one browser ever holds enabled category buttons at a time.
  for (let i = 0; i < 300; i += 1) {
    if (await host.getByRole('heading', { name: FINISHED }).isVisible()) break;
    const hostTurn = await host
      .getByRole('button', { name: /^Batting/ })
      .isEnabled()
      .catch(() => false);
    const guestTurn = await guest
      .getByRole('button', { name: /^Batting/ })
      .isEnabled()
      .catch(() => false);
    expect(hostTurn && guestTurn).toBe(false);
    if (!(await playIfSelector(host))) await playIfSelector(guest);
    await host.waitForTimeout(200);
  }

  for (const page of [host, guest]) {
    await expect(page.getByRole('heading', { name: FINISHED })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Final standings').getByRole('listitem')).toHaveCount(2);
  }
  await host.getByText('Check the fair deal').click();
  await expect(host.getByText(/^[0-9a-f]{64}$/)).toHaveCount(2); // commitment and disclosed seed
  await expectNoSeriousA11yViolations(host);
  await host.screenshot({ path: testInfo.outputPath('arena-result.png'), fullPage: true });

  await hostContext.close();
  await guestContext.close();
});
