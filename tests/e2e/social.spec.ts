import { expect, test, type Page } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
} from './support';

const CODE = 'e2e-social-gate-code';
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
const XSS = '<img src=x onerror="window.__xss=1"> **bold** <script>alert(1)</script>';

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Chat', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Room chat' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('friends: request, accept, invite to a passworded room and chat as plain text', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'two-context flow runs once (friend at 360 px)');
  test.setTimeout(150_000);
  const suffix = Date.now() % 100000;
  const a = await (await browser.newContext()).newPage();
  const b = await (
    await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true })
  ).newPage();
  await onboardThroughUi(a, CODE, `sa_${suffix}`);
  await onboardThroughUi(b, CODE, `sb_${suffix}`);

  // S30: find by username (never e-mail) and send a request.
  await a.getByRole('link', { name: 'Friends', exact: true }).click();
  await expect(a.getByRole('heading', { name: 'Friends', level: 1 })).toBeVisible();
  await a.getByRole('tab', { name: 'Find people' }).click();
  await a.getByLabel('Username').fill('sb');
  await expect(a.getByRole('button', { name: 'Search' })).toBeDisabled();
  await a.getByLabel('Username').fill(`sb_${suffix}`);
  await a.getByRole('button', { name: 'Search' }).click();
  const results = a.getByRole('list', { name: 'Search results' });
  await expect(results.getByText(`SB_${suffix}`, { exact: true })).toBeVisible();
  await results.getByRole('button', { name: 'Add friend' }).click();
  await expect(a.getByText(`Friend request sent to SB_${suffix}.`)).toBeVisible();
  await expectNoSeriousA11yViolations(a);

  // S31: the request reaches B's inbox; B accepts it on the friends page.
  await b.goto('/notifications');
  await expect(b.getByText(`SA_${suffix} sent you a friend request.`)).toBeVisible();
  await expectNoSeriousA11yViolations(b);
  await expectNoHorizontalScroll(b);
  await b.goto('/friends');
  await b.getByRole('tab', { name: /^Requests/ }).click();
  await b.getByRole('button', { name: 'Accept' }).click();
  await expect(b.getByText(`You and SA_${suffix} are now friends.`)).toBeVisible();
  await b.getByRole('tab', { name: /^Friends/ }).click();
  await expect(
    b.getByRole('list', { name: 'Your friends' }).getByText(`SA_${suffix}`, { exact: true }),
  ).toBeVisible();

  // S29: B views A's profile; medal counters are read-only.
  await b.goto(`/players/sa_${suffix}`);
  await expect(b.getByRole('heading', { name: `SA_${suffix}`, level: 1 })).toBeVisible();
  await expect(b.getByRole('main').getByText('Friends', { exact: true })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Remove friend' })).toBeVisible();
  await expect(b.getByRole('button', { name: 'Edit profile' })).toHaveCount(0);

  // A creates a passworded card room and invites B from the lobby.
  await a.goto('/play/cards/create');
  await a.getByLabel('Room name').fill('Friends night');
  await a.getByLabel('Room password (optional)').fill('pitch-secret');
  await a.getByRole('button', { name: 'Create room' }).click();
  await expect(a).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/lobby$/);
  const roomCode = (await a.getByText(ROOM_CODE).textContent()) ?? '';
  await a.getByRole('link', { name: 'Invite friends' }).click();
  await expect(a.getByText('Inviting to your room')).toBeVisible();
  await a.getByRole('button', { name: 'Invite' }).click();
  await expect(a.getByText(`Invited SB_${suffix}.`)).toBeVisible();

  // The invite carries neither the code nor the password; the password still applies.
  await b.goto('/notifications');
  await expect(b.getByText('Friends night', { exact: true })).toBeVisible();
  expect(await b.content()).not.toContain(roomCode);
  await b.getByLabel('Room password').fill('wrong-password');
  await b.getByRole('button', { name: 'Join room' }).click();
  await expect(b.getByRole('alert').filter({ hasText: 'Problem' })).toBeVisible();
  await b.getByLabel('Room password').fill('pitch-secret');
  await b.getByRole('button', { name: 'Join room' }).click();
  await expect(b).toHaveURL(/\/rooms\/[0-9a-f-]{36}\/lobby$/);
  await a.goBack();
  await expect(a.getByRole('link', { name: 'Invite friends' })).toBeVisible();
  await expect(a.getByText(`SB_${suffix}`, { exact: true })).toBeVisible();

  // S24 public chat: markup is shown as text, never executed or rendered.
  const chatA = await openChat(a);
  await chatA.getByLabel('Message everyone in the room').fill(XSS);
  await chatA.getByRole('button', { name: 'Send', exact: true }).click();
  const chatB = await openChat(b);
  const logB = chatB.getByRole('log', { name: 'Public messages' });
  await expect(logB.getByText(XSS, { exact: true })).toBeVisible();
  await expect(logB.locator('img, script, strong')).toHaveCount(0);
  expect(await b.evaluate(() => (window as { __xss?: number }).__xss)).toBeUndefined();
  await chatB.getByLabel('Message everyone in the room').fill('Hello from the phone');
  await chatB.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    chatA.getByRole('log', { name: 'Public messages' }).getByText('Hello from the phone'),
  ).toBeVisible();
  // A card room has no team channel.
  await expect(chatA.getByRole('tab', { name: '🔒 Team' })).toHaveCount(0);
  await expectNoSeriousA11yViolations(b);
  await expectNoHorizontalScroll(b);
  await b.screenshot({ path: testInfo.outputPath('chat-mobile.png') });
  await chatB.getByRole('button', { name: 'Close chat' }).click();
  await expect(chatB).toHaveCount(0);
});

test('auction team chat is visible to the team only', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'two-context flow runs once');
  test.setTimeout(150_000);
  const suffix = Date.now() % 100000;
  const host = await (await browser.newContext()).newPage();
  const rival = await (await browser.newContext()).newPage();
  await onboardThroughUi(host, CODE, `th_${suffix}`);
  await onboardThroughUi(rival, CODE, `tr_${suffix}`);

  await host.goto('/play/auction/create');
  await host.getByLabel('Room name').fill('Team chat');
  await host.getByRole('button', { name: 'Create auction room' }).click();
  await expect(host).toHaveURL(/\/franchises$/);
  const roomCode = (await host.getByText(ROOM_CODE).first().textContent()) ?? '';
  await rival.goto('/play/auction/join');
  await rival.getByLabel('Room code').fill(roomCode);
  await rival.getByRole('button', { name: 'Join room' }).click();
  await expect(rival).toHaveURL(/\/franchises$/);
  await host
    .getByRole('button', { name: /^Claim / })
    .first()
    .click();
  await expect(host.getByRole('heading', { name: /^Your team: / })).toBeVisible();
  await rival
    .getByRole('button', { name: /^Claim / })
    .first()
    .click();
  await expect(rival.getByRole('heading', { name: /^Your team: / })).toBeVisible();

  const secret = `Max 6 cr for him ${suffix}`;
  const hostChat = await openChat(host);
  await hostChat.getByRole('tab', { name: '🔒 Team' }).click();
  await expect(hostChat.getByText(/only/i).first()).toBeVisible();
  await hostChat.getByLabel('Message your team').fill(secret);
  await hostChat.getByRole('button', { name: 'Send to team' }).click();
  await expect(
    hostChat.getByRole('log', { name: 'Team messages' }).getByText(secret),
  ).toBeVisible();
  // The public draft is separate: nothing was cross-posted.
  await hostChat.getByRole('tab', { name: 'Public' }).click();
  await expect(
    hostChat.getByRole('log', { name: 'Public messages' }).getByText(secret),
  ).toHaveCount(0);

  const rivalChat = await openChat(rival);
  await rivalChat.getByRole('tab', { name: '🔒 Team' }).click();
  await expect(rivalChat.getByRole('log', { name: 'Team messages' })).toBeVisible();
  await rivalChat.getByLabel('Message your team').fill('our own plan');
  await rivalChat.getByRole('button', { name: 'Send to team' }).click();
  await expect(rivalChat.getByText('our own plan')).toBeVisible();
  // The rival's views never contain the host team's message, even after a reload.
  await rival.reload();
  await expect(rival.getByRole('heading', { name: /^Your team: / })).toBeVisible();
  const again = await openChat(rival);
  await again.getByRole('tab', { name: '🔒 Team' }).click();
  await expect(again.getByText('our own plan')).toBeVisible();
  expect(await rival.content()).not.toContain(secret);
  await expect(hostChat.getByText('our own plan')).toHaveCount(0);
  await expectNoSeriousA11yViolations(host);
});
