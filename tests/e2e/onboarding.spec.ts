import { expect, test } from '@playwright/test';
import {
  clearAttempts,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  latestMail,
  onboardThroughUi,
  setAccessCode,
} from './support';

const CODE = 'e2e-correct-access-code';

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

test('wrong codes count down server-side and survive a reload', async ({ page }) => {
  await page.goto('/access');
  await expect(page.getByText('You have 3 attempts.')).toBeVisible();
  await page.getByLabel('Invitation code').fill('definitely-wrong-code');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('2 attempts remaining.')).toBeVisible();
  await page.reload();
  await expect(page.getByText('2 attempts remaining.')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
});

test('third wrong code locks this browser with an exact unlock time', async ({ page }) => {
  await page.goto('/access');
  for (let i = 0; i < 3; i += 1) {
    await page.getByLabel('Invitation code').fill(`wrong-code-${i}-xyz`);
    await page.getByRole('button', { name: 'Continue' }).click();
    if (i < 2) await expect(page.getByText(`${2 - i} attempt`)).toBeVisible();
  }
  await expect(page.getByText(/Try again at/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
  await page.reload();
  await expect(page.getByText(/Try again at/)).toBeVisible();
});

test('a new invited user onboards end to end and can sign out and back in', async ({
  page,
}, testInfo) => {
  const username = `e2e_${testInfo.project.name}_${Date.now() % 100000}`;
  const { email, password } = await onboardThroughUi(page, CODE, username);
  await expect(page.getByText(username.toUpperCase()).first()).toBeVisible();
  await expectNoHorizontalScroll(page);

  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/auth/);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/play$/);
});

test('an invitation link cannot be used twice', async ({ page }, testInfo) => {
  const username = `twice_${testInfo.project.name}_${Date.now() % 100000}`;
  await onboardThroughUi(page, CODE, username);
  const link = new URL(await latestMail(`${username}@example.test`));
  await page.goto(link.pathname + link.search);
  await expect(page.getByText('This link cannot be used')).toBeVisible();
});

test('onboarding and auth screens pass automated accessibility checks', async ({
  page,
}, testInfo) => {
  await page.goto('/access');
  await page.getByLabel('Invitation code').fill(CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/auth/);
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalScroll(page);
  void testInfo;
});
