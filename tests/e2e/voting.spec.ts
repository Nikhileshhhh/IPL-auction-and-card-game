import { expect, test } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
} from './support';

const CODE = 'e2e-voting-code';
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

test('the host asks to end; both vote within 15 s; the match ends and results show', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'two-context flow runs once (guest at 360 px)');
  test.setTimeout(180_000);
  const suffix = Date.now() % 100000;
  const host = await (
    await browser.newContext({ viewport: { width: 1440, height: 900 } })
  ).newPage();
  const guest = await (
    await browser.newContext({
      viewport: { width: 360, height: 800 },
      isMobile: true,
      hasTouch: true,
    })
  ).newPage();
  await onboardThroughUi(host, CODE, `vhost_${suffix}`);
  await onboardThroughUi(guest, CODE, `vguest_${suffix}`);

  await host.goto('/play/cards/create');
  await host.getByLabel('Room name').fill('Vote night');
  await host.getByLabel('Maximum players').fill('2');
  await host.getByLabel('Total cards').fill('8');
  await host.getByRole('button', { name: 'Create room' }).click();
  await expect(host).toHaveURL(/\/lobby$/);
  const code = (await host.getByText(ROOM_CODE).textContent()) ?? '';
  await guest.goto('/play/cards/join');
  await guest.getByLabel('Room code').fill(code);
  await guest.getByRole('button', { name: 'Join room' }).click();
  await expect(guest).toHaveURL(/\/lobby$/);
  await guest.getByRole('button', { name: "I'm ready" }).click();
  await host.getByRole('button', { name: "I'm ready" }).click();
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const page of [host, guest]) {
    await expect(page).toHaveURL(/\/cards$/, { timeout: 15_000 });
    await expect(page.getByRole('region', { name: 'Turn' })).toBeVisible();
  }

  // Only the host can ask; starting is never an automatic Yes.
  await expect(guest.getByRole('button', { name: 'End game early' })).toHaveCount(0);
  await host.getByRole('button', { name: 'End game early' }).click();
  await host.getByRole('button', { name: 'Start the vote' }).click();
  const hostSheet = host.getByRole('dialog', { name: 'End the game now?' });
  const guestSheet = guest.getByRole('dialog', { name: 'End the game now?' });
  await expect(hostSheet).toBeVisible();
  await expect(guestSheet).toBeVisible();
  await expect(hostSheet.getByText('2 of 2 must choose to end.', { exact: false })).toBeVisible();
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);

  await guestSheet.getByRole('button', { name: 'End the game' }).click();
  await expect(guestSheet.getByText('Your vote is recorded')).toBeVisible();
  // No running tally is shown before the vote closes.
  await expect(hostSheet.getByText(/1 of 2|1 vote/)).toHaveCount(0);
  await hostSheet.getByRole('button', { name: 'End the game' }).click();
  await expect(hostSheet.getByText('Your vote is recorded')).toBeVisible();

  // Exactly 15 seconds, then the server resolves it (the client never decides).
  for (const page of [host, guest]) {
    await expect(page.getByText('The room voted to end the game.')).toBeVisible({
      timeout: 25_000,
    });
    await expect(
      page.getByRole('heading', { name: /^(Match complete|You won the match!)$/ }),
    ).toBeVisible();
  }
  await guest.getByRole('link', { name: 'Results and medals' }).click();
  await expect(guest).toHaveURL(/\/results$/);
  await expect(guest.getByRole('heading', { name: 'Match results', level: 1 })).toBeVisible();
  await expect(guest.getByText('Ended by vote')).toBeVisible();
  await expect(guest.getByText('Practice game — no medals')).toBeVisible();
  await expect(guest.getByText(/Detailed results stay here for/)).toBeVisible();
  await expectNoSeriousA11yViolations(guest);
  await expectNoHorizontalScroll(guest);
  await guest.screenshot({ path: testInfo.outputPath('results-mobile.png'), fullPage: true });
});
