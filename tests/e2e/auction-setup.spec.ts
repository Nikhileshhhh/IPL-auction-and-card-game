import { expect, test } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
} from './support';

const CODE = 'e2e-auction-setup-code';
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

test('two captains claim franchises, lock retentions and run the live auction', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'two-context flow runs once (guest at 360 px)');
  test.setTimeout(180_000);
  const suffix = Date.now() % 100000;
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const guestContext = await browser.newContext({
    viewport: { width: 360, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await onboardThroughUi(host, CODE, `ahost_${suffix}`);
  await onboardThroughUi(guest, CODE, `aguest_${suffix}`);

  // S14: real IPL rules, retention format by default.
  await host.goto('/play/auction/create');
  await expect(host.getByText('₹120 crore per franchise')).toBeVisible();
  await host.getByLabel('Room name').fill('E2E auction');
  await host.getByRole('button', { name: 'Create auction room' }).click();
  await expect(host).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/franchises$/);
  const roomCode = (await host.getByText(ROOM_CODE).first().textContent()) ?? '';

  await guest.goto('/play/auction/join');
  await guest.getByLabel('Room code').fill(roomCode);
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(guest).toHaveURL(/\/franchises$/);

  // S16: each claims a franchise and becomes its captain.
  await host
    .getByRole('button', { name: /^Claim / })
    .first()
    .click();
  await expect(host.getByRole('heading', { name: /^Your team: / })).toBeVisible();
  await expect(host.getByText('Team invitation code (not the room code)')).toBeVisible();
  await expect(guest.getByText(/^Captain AHOST_/).first()).toBeVisible();
  await guest
    .getByRole('button', { name: /^Claim / })
    .first()
    .click();
  await expect(guest.getByRole('heading', { name: /^Your team: / })).toBeVisible();
  await expectNoSeriousA11yViolations(host);
  await expectNoHorizontalScroll(guest);

  await host.getByRole('button', { name: 'Close selection with 2 teams' }).click();
  for (const page of [host, guest]) await expect(page).toHaveURL(/\/retentions$/);

  // S18: the host keeps two players at the real slab rates; the guest keeps nobody.
  const retain = host.getByRole('button', { name: /^Retain / });
  await retain.first().click();
  await retain.first().click();
  await expect(host.getByText('Selected: 2 of 6')).toBeVisible();
  await host.getByRole('button', { name: 'Save proposal' }).click();
  await expect(host.getByText('Charged to the purse')).toBeVisible();
  for (const card of await host
    .getByRole('list', { name: 'Players you retain, in order' })
    .locator('img')
    .all()) {
    await expect(card).toBeVisible(); // portraits on every player row (ADR-017)
  }
  await expectNoSeriousA11yViolations(host);
  await host.getByRole('button', { name: 'Lock retentions' }).click();
  await host.getByRole('button', { name: /^Lock for ₹/ }).click();
  await expect(host.getByText('Retentions locked')).toBeVisible();

  await guest.getByRole('button', { name: 'Keep nobody' }).click();
  await expect(guest.getByText('Right-to-match cards')).toBeVisible();
  await guest.getByRole('button', { name: 'Lock retentions' }).click();
  await guest.getByRole('button', { name: /^Lock for ₹/ }).click();

  // S19: both reach the auction lobby with locked squads and public purses.
  for (const page of [host, guest]) {
    await expect(page).toHaveURL(/\/auction-lobby$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Teams and purses' })).toBeVisible();
    await expect(page.getByText('What happens at the start')).toBeVisible();
  }
  await expect(guest.getByText('₹120 cr').first()).toBeVisible(); // the guest kept nobody
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);

  // S22: anyone can look at a team's squad.
  await host.getByRole('link', { name: 'Squads' }).click();
  await expect(host).toHaveURL(/\/squad$/);
  await expect(host.getByText('Kept for minimum squad')).toBeVisible();
  await expect(host.getByText('Need 16 more players')).toBeVisible();
  await expectNoSeriousA11yViolations(host);

  // S17: the captain's team page with explicit rights and the invitation code.
  await host.goto(host.url().replace(/\/squad$/, '/team/requests'));
  await expect(host.getByRole('heading', { name: 'Join requests' })).toBeVisible();
  await expect(host.getByRole('heading', { name: 'Team invitation code' })).toBeVisible();
  await expect(host.getByText('Teammates (1 of')).toBeVisible();
  await expectNoSeriousA11yViolations(host);
  // S23: a private target from the pool, with portraits (guest at 360 px).
  await guest.goto(host.url().replace(/\/team\/requests$/, '/shortlist'));
  await guest.getByRole('tab', { name: 'Find players' }).click();
  await guest
    .getByRole('button', { name: /^Add .* to the shortlist$/ })
    .first()
    .click();
  await expect(guest.getByText('On the list').first()).toBeVisible();
  await guest.getByRole('tab', { name: /^Targets/ }).click();
  await expect(
    guest.getByRole('list', { name: 'Targets in priority order' }).locator('img').first(),
  ).toBeVisible();
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);

  // S26: the captain saves automated limits (private; used only if everyone is away).
  await host.goto(host.url().replace(/\/team\/requests$/, '/auto'));
  await expect(host.getByRole('heading', { name: 'Control' })).toBeVisible();
  await expect(host.getByText('People are bidding for your team.')).toBeVisible();
  await host.getByLabel('Bid automatically while everyone is away').check();
  await host.getByLabel('Bowler').fill('2');
  await host.getByRole('button', { name: 'Save limits' }).click();
  await expect(host.getByText('Spent automatically')).toBeVisible();
  await expectNoSeriousA11yViolations(host);
  await host.goto(host.url().replace(/\/auto$/, '/team/requests'));

  // S20: both mark themselves ready, the host starts, and both land on the live stage.
  await host.goto(host.url().replace(/\/team\/requests$/, '/auction-lobby'));
  await guest.goto(host.url());
  for (const page of [guest, host]) {
    await page.getByRole('button', { name: "I'm ready" }).click();
  }
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const page of [host, guest]) {
    await expect(page).toHaveURL(/\/auction$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
    await expect(page.getByText(/^Lot 1/)).toBeVisible();
    // The player under the hammer shows a portrait (ADR-017).
    await expect(page.locator('[data-portrait]').first()).toBeVisible();
  }
  // The host opens at the base price; the guest sees the exact next step.
  const hostBid = host.getByRole('button', { name: /^Bid ₹/ });
  await expect(hostBid).toBeEnabled();
  await hostBid.click();
  await expect(host.getByText('Your team holds the highest bid.')).toBeVisible();
  const guestBid = guest.getByRole('button', { name: /^Bid ₹/ });
  await expect(guestBid).toBeEnabled();
  await guestBid.click();
  await expect(host.getByRole('button', { name: /^Bid ₹/ })).toBeEnabled();
  await expect(guest.getByText('Your team holds the highest bid.')).toBeVisible();
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);
  // The clock is the server's: the lot sells when it runs out, and the next one opens.
  await expect(host.getByText(/^(Sold|Right to match) · /).first()).toBeVisible({
    timeout: 45_000,
  });
  await expect(host.getByText(/^Lot 2/)).toBeVisible({ timeout: 20_000 });

  await hostContext.close();
  await guestContext.close();
});
