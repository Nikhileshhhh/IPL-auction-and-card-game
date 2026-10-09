import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, expectNoSeriousA11yViolations } from './support';

test.describe('public shell', () => {
  test('root redirects to the access gate', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/access/);
    await expect(page.getByRole('heading', { name: 'Private club access' })).toBeVisible();
  });

  test('protected member pages redirect to the gate without credentials', async ({ page }) => {
    await page.goto('/play/cards');
    await expect(page).toHaveURL(/\/access\?next=%2Fplay%2Fcards/);
  });

  test('admin pages redirect to admin sign in without an admin session', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('gate, auth and admin login have no serious accessibility violations or horizontal scroll', async ({
    page,
  }) => {
    for (const path of ['/access', '/admin/login']) {
      await page.goto(path);
      await expectNoSeriousA11yViolations(page);
      await expectNoHorizontalScroll(page);
    }
  });

  test('direct API calls without a gate cannot read member data', async ({ request }) => {
    const res = await request.get('/api/v1/me');
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  test('cross-site mutations are refused by the BFF', async ({ request }) => {
    const res = await request.post('/api/v1/access/verify', {
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      data: { code: 'x', requestId: crypto.randomUUID() },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.code).toBe('ORIGIN_FORBIDDEN');
  });
});
