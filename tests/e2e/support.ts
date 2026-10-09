import { createHmac } from 'node:crypto';
import argon2 from 'argon2';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import { expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DB = process.env.E2E_DB_NAME ?? 'stumps_e2e';

export function adminClientUrl() {
  const url = new URL(
    process.env.MIGRATION_ADMIN_URL ?? 'postgres://postgres@127.0.0.1:54329/postgres',
  );
  url.pathname = `/${DB}`;
  return url.toString();
}

export async function withDb<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: adminClientUrl() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Mirror of the server's peppered Argon2id hashing so tests can set the gate code. */
export async function setAccessCode(code: string) {
  const pepper = Buffer.from(process.env.E2E_ACCESS_CODE_PEPPER_V1!, 'base64url');
  const peppered = createHmac('sha256', pepper).update(code.normalize('NFKC')).digest();
  const hash = await argon2.hash(peppered, {
    type: argon2.argon2id,
    memoryCost: 19 * 1024,
    timeCost: 2,
    parallelism: 1,
  });
  await withDb((c) =>
    c.query(
      `UPDATE app_private.access_config SET code_hash = $1, version = version + 1, min_valid_version = version + 1`,
      [hash],
    ),
  );
}

export async function clearAttempts() {
  await withDb((c) =>
    c.query('TRUNCATE app_private.access_attempts, app_private.rate_counters CASCADE'),
  );
}

export async function latestMail(email: string): Promise<string> {
  return withDb(async (c) => {
    const res = await c.query<{ link: string }>(
      'SELECT link FROM auth_local.outbox WHERE email = lower($1) ORDER BY id DESC LIMIT 1',
      [email],
    );
    if (!res.rows[0]) throw new Error(`no mail for ${email}`);
    return res.rows[0].link;
  });
}

export function totp(secret: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
}

export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
}

/** Gate → invitation → callback → password → onboarding, through the real UI. */
export async function onboardThroughUi(
  page: Page,
  code: string,
  username: string,
  password = 'a-long-e2e-password',
) {
  const email = `${username}@example.test`;
  await page.goto('/access');
  await page.getByLabel('Invitation code').fill(code);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/auth/);
  await page.getByRole('tab', { name: 'Request invitation' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send invitation link' }).click();
  await expect(page.getByText(/sign-up link is on its way/)).toBeVisible();
  const link = new URL(await latestMail(email));
  await page.goto(link.pathname + link.search);
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm new password').fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel('Username').fill(username);
  await expect(page.getByText('Available.')).toBeVisible();
  await page.getByLabel('Display name').fill(username.toUpperCase());
  await page.getByRole('button', { name: 'Save and enter the club' }).click();
  await expect(page).toHaveURL(/\/play$/);
  return { email, password };
}
