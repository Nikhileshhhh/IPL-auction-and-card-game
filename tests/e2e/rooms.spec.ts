import { expect, test, type Page } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
  withDb,
} from './support';

const CODE = 'e2e-rooms-gate-code';
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

async function createCardRoom(page: Page, name: string) {
  await page.goto('/play/cards');
  await page.getByRole('link', { name: 'Create a room' }).click();
  await expect(page).toHaveURL(/\/play\/cards\/create$/);
  await page.getByLabel('Room name').fill(name);
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/lobby$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  const code = (await page.getByText(ROOM_CODE).textContent()) ?? '';
  expect(code).toMatch(ROOM_CODE);
  return code;
}

test('two browser contexts share one authoritative lobby; start is gated by readiness', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'two-context flow runs once');
  const suffix = Date.now() % 100000;
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();
  await onboardThroughUi(host, CODE, `rhost_${suffix}`);
  await onboardThroughUi(guest, CODE, `rguest_${suffix}`);

  const code = await createCardRoom(host, 'E2E lobby');
  await expectNoSeriousA11yViolations(host);

  // The code travels by hand (never in a URL); lowercase with spaces is normalized.
  await guest.goto('/play/cards/join');
  await guest.getByLabel('Room code').fill(code.toLowerCase().replace(/-/g, ' '));
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(guest).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/lobby$/);
  expect(guest.url()).not.toContain(code);

  const guestName = `RGUEST_${suffix}`;
  const hostName = `RHOST_${suffix}`;
  // Both contexts converge on the same roster through realtime events.
  await expect(host.getByText(guestName, { exact: true })).toBeVisible();
  await expect(guest.getByText(hostName, { exact: true })).toBeVisible();
  await expect(host.getByText('2 of 4 joined · 0 ready')).toBeVisible();

  await guest.getByRole('button', { name: "I'm ready" }).click();
  await expect(host.getByText('2 of 4 joined · 1 ready')).toBeVisible();
  await expect(host.getByText(`Waiting for: ${hostName}`)).toBeVisible();

  // Host changes settings: rules version bumps and the guest's ready is cleared.
  await host.getByRole('button', { name: 'Change settings' }).click();
  await host.getByLabel('Time to choose').fill('30');
  await host.getByRole('button', { name: 'Save settings' }).click();
  await expect(guest.getByText('30 s to choose')).toBeVisible();
  await expect(host.getByText('2 of 4 joined · 0 ready')).toBeVisible();

  await guest.getByRole('button', { name: "I'm ready" }).click();
  await host.getByRole('button', { name: "I'm ready" }).click();
  await expect(host.getByText('2 of 4 joined · 2 ready')).toBeVisible();
  await expect(host.getByRole('button', { name: 'Start game' })).toBeEnabled();
  // Starting and playing a match is covered by card-match.spec.ts.

  // The lobby survives a reload (state is in PostgreSQL, not the socket).
  await guest.reload();
  await expect(guest.getByText(hostName, { exact: true })).toBeVisible();
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);
  await host.screenshot({ path: testInfo.outputPath('lobby-host.png'), fullPage: true });

  // Leaving hands the room over; the remaining member becomes host.
  await host.getByRole('button', { name: 'Leave room' }).click();
  await host.getByRole('dialog').getByRole('button', { name: 'Leave room' }).click();
  await expect(host).toHaveURL(/\/play\/cards$/);
  await expect(guest.getByRole('button', { name: 'Start game' })).toBeVisible();

  await hostContext.close();
  await guestContext.close();
});

test('wrong room code shows the generic failure and no membership', async ({ page }, testInfo) => {
  const username = `rwrong_${testInfo.project.name}_${Date.now() % 100000}`;
  await onboardThroughUi(page, CODE, username);
  await page.goto('/play/cards/join');
  await page.getByLabel('Room code').fill('ZZZZ-ZZZZ-ZZZZ');
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByText('Could not join. Check the room code and password.')).toBeVisible();
  const memberships = await withDb((c) =>
    c.query(
      `SELECT 1 FROM app_private.room_members m JOIN app_private.profiles p ON p.user_id = m.user_id
        WHERE p.username = $1`,
      [username],
    ),
  );
  expect(memberships.rowCount).toBe(0);
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalScroll(page);
});

test('auction room creation lands on franchise selection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'covered once');
  await onboardThroughUi(page, CODE, `rauct_${Date.now() % 100000}`);
  await page.goto('/play/auction/create');
  await expect(page.getByRole('heading', { name: 'Real IPL auction rules' })).toBeVisible();
  await page.getByLabel('Room name').fill('Auction night');
  await page.getByRole('button', { name: 'Create auction room' }).click();
  await expect(page).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/franchises$/);
  await expect(page.getByRole('heading', { name: 'Choose a franchise' })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});
