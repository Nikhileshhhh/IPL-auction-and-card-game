import { expect, test } from '@playwright/test';
import {
  clearAttempts,
  onboardThroughUi,
  setAccessCode,
  totp,
  withDb,
  expectNoSeriousA11yViolations,
} from './support';

const CODE = 'e2e-admin-gate-code';

test('an administrator enrolls MFA and rotates the access code securely', async ({
  page,
}, testInfo) => {
  await setAccessCode(CODE);
  await clearAttempts();
  const username = `admin_${testInfo.project.name}_${Date.now() % 100000}`;
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
  const secretText = await page.getByLabel('Authenticator secret').textContent();
  const secret = secretText!.replace(/\s/g, '');
  await page.getByLabel('Authenticator code').fill(totp(secret));
  await page.getByRole('button', { name: 'Confirm authenticator' }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Website access code' })).toBeVisible();
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'Rotate access code' }).click();
  await expect(page.getByText(/shown once/)).toBeVisible();
  const generated = await page.locator('code').first().textContent();
  expect(generated).toMatch(/^[A-Za-z0-9_-]{22}$/);

  // The member session in this browser must now re-verify with the new code.
  await page.goto('/play');
  await expect(page).toHaveURL(/\/access/);
  await page.getByLabel('Invitation code').fill(generated!);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/auth/);
});
