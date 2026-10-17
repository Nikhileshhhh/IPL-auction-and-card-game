import { expect, test, type Page, type TestInfo } from '@playwright/test';
import {
  clearAttempts,
  expectNoSeriousA11yViolations,
  onboardThroughUi,
  setAccessCode,
  totp,
  withDb,
} from '../e2e/support';

/**
 * Phase 16 visual and accessibility review (UI spec §4, §8; docs/design-review.md).
 * Every reachable screen is opened at each target viewport, at 320 CSS px
 * reflow and at 200% zoom, and must keep: no horizontal page scroll, a
 * visible first heading, readable control text (≥ 14 px), touch targets of
 * at least 44 px and no serious axe violations. Screenshots are attached to
 * the run for human review; they are not baselines, because a pixel diff is
 * not a substitute for that review.
 */

const CODE = 'e2e-visual-code';
const ROOM_CODE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800 },
  { name: '390x844', width: 390, height: 844 },
  { name: '768x1024', width: 768, height: 1024 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '1440x900', width: 1440, height: 900 },
  // WCAG 1.4.10 reflow: 1280 px at 400% is 320 CSS px.
  { name: 'reflow-320', width: 320, height: 640 },
  // 200% zoom of a 1440×900 window: half the CSS pixels.
  { name: 'zoom-200', width: 720, height: 450 },
] as const;

test.beforeEach(async () => {
  await setAccessCode(CODE);
  await clearAttempts();
});

type Problem = { screen: string; viewport: string; issue: string };

/** Layout checks that hold at every size; returns problems instead of failing early. */
async function inspect(page: Page, screen: string, viewport: string): Promise<Problem[]> {
  const problems: Problem[] = [];
  const found = await page.evaluate(() => {
    const doc = document.documentElement;
    const out: string[] = [];
    if (doc.scrollWidth > window.innerWidth + 1) {
      // Name the innermost elements that stick out, to make the fix obvious.
      // Content clipped by its own scroll container does not widen the page.
      const clipped = (el: Element) => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
          if (getComputedStyle(n).overflowX !== 'visible') return true;
        }
        return false;
      };
      const wide = Array.from(document.querySelectorAll('body *')).filter(
        (el) => el.getBoundingClientRect().right > window.innerWidth + 1 && !clipped(el),
      );
      const leaves = wide.filter((el) => !wide.some((o) => o !== el && el.contains(o)));
      const describe = (el: Element) =>
        `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}[${Math.round(el.getBoundingClientRect().width)}]`;
      const chain = (el: Element) => {
        const parts: string[] = [];
        for (let n: Element | null = el; n && parts.length < 6; n = n.parentElement) {
          parts.push(describe(n));
        }
        return parts.join(' < ');
      };
      // Also elements whose content spills out of them (overflow: visible).
      const spill = Array.from(document.querySelectorAll('body *')).filter(
        (el) =>
          el.scrollWidth > el.clientWidth + 1 &&
          el.clientWidth > 0 &&
          getComputedStyle(el).overflowX === 'visible' &&
          !clipped(el),
      );
      const innermost = spill.filter((el) => !spill.some((o) => o !== el && el.contains(o)));
      const names = [...leaves.slice(0, 2), ...innermost.slice(0, 2)].map(chain);
      out.push(
        `horizontal scroll: ${doc.scrollWidth} > ${window.innerWidth} (${names.join(' | ')})`,
      );
    }
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
    };
    const label = (el: Element) =>
      (el.getAttribute('aria-label') ?? el.textContent ?? el.tagName).trim().slice(0, 40);
    const scope = document.querySelector('main') ?? document.body;
    for (const el of Array.from(
      scope.querySelectorAll(
        'button, input:not([type=radio]):not([type=checkbox]):not([type=file]), select, textarea',
      ),
    )) {
      if (!visible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 14) out.push(`control text ${size}px: "${label(el)}"`);
    }
    for (const el of Array.from(scope.querySelectorAll('button, [role=button], a[href]'))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      // Inline text links inside a sentence are exempt (WCAG 2.5.8 inline exception).
      const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline';
      if (!inline && (r.height < 44 || r.width < 24)) {
        out.push(`target ${Math.round(r.width)}×${Math.round(r.height)}: "${label(el)}"`);
      }
    }
    if (!document.querySelector('h1')) out.push('no h1');
    return out;
  });
  for (const issue of found) problems.push({ screen, viewport, issue });
  return problems;
}

async function sweep(
  page: Page,
  screens: readonly { name: string; path: string; ready: (p: Page) => Promise<unknown> }[],
  testInfo: TestInfo,
) {
  const problems: Problem[] = [];
  for (const v of VIEWPORTS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const s of screens) {
      await page.goto(s.path);
      await s.ready(page);
      await page.waitForLoadState('networkidle').catch(() => undefined);
      problems.push(...(await inspect(page, s.name, v.name)));
      await testInfo.attach(`${s.name}@${v.name}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: 'image/png',
      });
      // axe once per screen at the smallest and largest sizes (it is slow).
      if (v.name === '360x800' || v.name === '1440x900') await expectNoSeriousA11yViolations(page);
    }
  }
  return problems;
}

const heading = (name: string | RegExp) => (p: Page) =>
  expect(p.getByRole('heading', { name, level: 1 })).toBeVisible();

test('member screens hold up at every target size, at 320 px reflow and at 200% zoom', async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const suffix = Date.now() % 100000;
  const username = `vis_${suffix}`;
  await onboardThroughUi(page, CODE, username);

  // A card lobby and an auction setup room to review.
  await page.goto('/play/cards/create');
  await page.getByLabel('Room name').fill('A deliberately long room name for review');
  await page.getByRole('button', { name: 'Create room' }).click();
  await expect(page).toHaveURL(/\/lobby$/);
  const cardLobby = new URL(page.url()).pathname;
  await expect(page.getByText(ROOM_CODE)).toBeVisible();

  const screens = [
    { name: 'S04 dashboard', path: '/play', ready: heading(/./) },
    { name: 'S05 card create', path: '/play/cards/create', ready: heading(/./) },
    { name: 'S06 card join', path: '/play/cards/join', ready: heading(/./) },
    { name: 'card collection', path: '/play/cards/collection', ready: heading(/./) },
    { name: 'S07 card lobby', path: cardLobby, ready: heading(/./) },
    { name: 'S14 auction create', path: '/play/auction/create', ready: heading(/./) },
    { name: 'S15 auction join', path: '/play/auction/join', ready: heading(/./) },
    { name: 'S29 profile', path: `/players/${username}`, ready: heading(/./) },
    { name: 'S30 friends', path: '/friends', ready: heading(/./) },
    { name: 'S31 notifications', path: '/notifications', ready: heading(/./) },
    { name: 'S35 status', path: '/status', ready: heading('Service status') },
  ] as const;
  const problems = await sweep(page, screens, testInfo);
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
});

test('admin screens and the design-review gallery hold up at every size', async ({
  page,
}, testInfo) => {
  test.setTimeout(900_000);
  const suffix = Date.now() % 100000;
  const username = `visadm_${suffix}`;
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

  const screens = [
    { name: 'S33 operations', path: '/admin', ready: heading('Operations') },
    { name: 'S33 access', path: '/admin/access', ready: heading('Access') },
    { name: 'S33 users', path: '/admin/users', ready: heading('Users') },
    { name: 'S33 announcements', path: '/admin/announcements', ready: heading('Announcements') },
    { name: 'S33 cleanup', path: '/admin/cleanup', ready: heading(/cleanup/i) },
    { name: 'S34 catalog', path: '/admin/catalog', ready: heading('Player catalog') },
    { name: 'design review', path: '/admin/design-review', ready: heading('Design review') },
  ] as const;
  const problems = await sweep(page, screens, testInfo);
  expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);

  // Image errors fall back to the original silhouette with a text label.
  await page.goto('/admin/design-review');
  const fallback = page.locator('img[data-portrait="fallback"]:visible').first();
  await expect(fallback).toBeVisible();
  await expect(fallback).toHaveAttribute('alt', /photo not available/);
  // Long names wrap instead of overflowing; 101 and ₹ amounts render in full.
  await expect(page.getByText('₹99,99,99,99,999')).toBeVisible();
});

test('motion follows the device unless the member overrides it; low data drops effects', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const suffix = Date.now() % 100000;
  const ctx = await browser.newContext({ reducedMotion: 'no-preference' });
  const page = await ctx.newPage();
  const username = `vismot_${suffix}`;
  await onboardThroughUi(page, CODE, username);

  const shineAnimation = () =>
    page.evaluate(() => {
      const el = document.querySelector('.stumps-card-shine');
      return el ? getComputedStyle(el, '::after').animationName : 'missing';
    });

  await page.goto('/play/cards/collection');
  await expect(page.locator('.stumps-card').first()).toBeVisible();
  expect(await shineAnimation()).not.toBe('none');

  // The member asks for reduced motion on a device that does not.
  await page.goto(`/players/${username}`);
  await page.getByRole('radio', { name: /Reduce motion/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.goto('/play/cards/collection');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduce');
  await expect(page.locator('.stumps-card').first()).toBeVisible();
  expect(['none', 'missing']).toContain(await shineAnimation());

  // Full motion wins over a device that asks for less.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`/players/${username}`);
  await page.getByRole('radio', { name: /Full motion/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.goto('/play/cards/collection');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'full');
  expect(await shineAnimation()).not.toBe('none');

  // Low data: static frames and 320 px portraits.
  await page.goto(`/players/${username}`);
  await page.getByRole('checkbox', { name: /Low data/ }).check();
  await expect(page.getByRole('status').filter({ hasText: 'Saved.' })).toBeVisible();
  await page.goto('/play/cards/collection');
  await expect(page.locator('html')).toHaveAttribute('data-low-data', 'true');
  const photo = page.locator('img[data-portrait="photo"]').first();
  await expect(photo).toBeVisible();
  expect(await photo.getAttribute('src')).toMatch(/\/320$/);
  expect(['none', 'missing']).toContain(await shineAnimation());
  await ctx.close();
});

test('portraits are private and cached privately; slow networks keep layout stable', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const suffix = Date.now() % 100000;
  await onboardThroughUi(page, CODE, `visnet_${suffix}`);
  await page.goto('/play/cards/collection');
  const photo = page.locator('img[data-portrait="photo"]').first();
  await expect(photo).toBeVisible();
  const src = (await photo.getAttribute('src'))!;
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toMatch(/^private/);
  expect(res.headers()['content-type']).toBe('image/webp');
  // Without the member session, no bytes.
  const anon = await page.context().browser()!.newContext();
  const denied = await anon.request.get(new URL(src, page.url()).toString());
  expect(denied.status()).toBeGreaterThanOrEqual(400);
  await anon.close();

  // Slow 3G-like network: the primary action does not move once shown.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 400,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
  });
  await page.goto('/play/cards/create');
  const action = page.getByRole('button', { name: 'Create room' });
  await expect(action).toBeVisible({ timeout: 60_000 });
  const first = await action.boundingBox();
  await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => undefined);
  const settled = await action.boundingBox();
  expect(settled).toEqual(first);
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
});

test('the dashboard stays within its transfer budget', async ({ page }) => {
  test.setTimeout(300_000);
  const suffix = Date.now() % 100000;
  await onboardThroughUi(page, CODE, `visbud_${suffix}`);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // A cold load: onboarding already cached the app's scripts in this context.
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e) => {
    bytes += e.encodedDataLength;
  });
  await page.goto('/play', { waitUntil: 'networkidle' });
  // UI spec §7 target: ≤ 1.5 MB compressed on desktop for the initial dashboard.
  test.info().annotations.push({ type: 'dashboard-bytes', description: String(bytes) });
  process.stdout.write(`dashboard initial transfer: ${bytes} bytes\n`);
  expect(bytes).toBeLessThan(1.5 * 1024 * 1024);
});
