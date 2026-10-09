import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import { ACCESS_CODE, createTestApi, onboardMember, type TestApi } from '../support/api';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi('stumps_sec_auth');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());

describe('closed enrollment and invitation callback', () => {
  it('a new invited user can onboard end to end', async () => {
    const { client } = await onboardMember(api, 'new_player');
    const me = await client.request<{
      username: string;
      onboarded: boolean;
      gate: { status: string };
    }>('GET', '/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({
      username: 'new_player',
      onboarded: true,
      gate: { status: 'bound' },
    });
  });

  it('enrollment requires the gate and answers generically for existing accounts', async () => {
    const noGate = api.client('203.0.113.20');
    expect(
      (await noGate.request('POST', '/v1/auth/enroll', { email: 'a@example.test' })).body.error
        ?.code,
    ).toBe('GATE_REQUIRED');
    await onboardMember(api, 'existing_one');
    const gated = api.client('203.0.113.21');
    await gated.passGate();
    const res = await gated.request('POST', '/v1/auth/enroll', {
      email: 'existing_one@example.test',
    });
    expect(res.body).toMatchObject({ ok: true, data: { accepted: true } });
    // No second invitation email reveals or re-invites the existing account.
    expect(await api.outbox('existing_one@example.test')).toHaveLength(1);
  });

  it('an invitation callback cannot be replayed', async () => {
    const client = api.client('203.0.113.22');
    await client.passGate();
    await client.request('POST', '/v1/auth/enroll', { email: 'replay@example.test' });
    const [mail] = await api.outbox('replay@example.test');
    const link = new URL(mail!.link);
    const payload = {
      tokenHash: link.searchParams.get('token_hash'),
      enrollment: link.searchParams.get('enrollment'),
    };
    expect((await client.request('POST', '/v1/auth/callback', payload)).status).toBe(200);
    const again = api.client('203.0.113.23');
    await again.passGate();
    const replay = await again.request('POST', '/v1/auth/callback', payload);
    expect(replay.body.error?.code).toBe('CALLBACK_EXPIRED');
  });

  it('an invitation link only works with its own enrollment nonce (no cross-email swap)', async () => {
    const client = api.client('203.0.113.24');
    await client.passGate();
    await client.request('POST', '/v1/auth/enroll', { email: 'alice_swap@example.test' });
    await client.request('POST', '/v1/auth/enroll', { email: 'mallory_swap@example.test' });
    const alice = new URL((await api.outbox('alice_swap@example.test'))[0]!.link);
    const mallory = new URL((await api.outbox('mallory_swap@example.test'))[0]!.link);
    const res = await client.request('POST', '/v1/auth/callback', {
      tokenHash: mallory.searchParams.get('token_hash'),
      enrollment: alice.searchParams.get('enrollment'),
    });
    expect(res.body.error?.code).toBe('CALLBACK_EXPIRED');
  });

  it('enrollment invitations created before a revoking rotation are dead', async () => {
    const client = api.client('203.0.113.25');
    await client.passGate();
    await client.request('POST', '/v1/auth/enroll', { email: 'stale_invite@example.test' });
    const link = new URL((await api.outbox('stale_invite@example.test'))[0]!.link);
    await api.setAccessCode(ACCESS_CODE, { policy: 'REVOKE_EXISTING' });
    const fresh = api.client('203.0.113.26');
    await fresh.passGate();
    const res = await fresh.request('POST', '/v1/auth/callback', {
      tokenHash: link.searchParams.get('token_hash'),
      enrollment: link.searchParams.get('enrollment'),
    });
    expect(res.body.error?.code).toBe('CALLBACK_EXPIRED');
  });
});

describe('direct API bypass (E03) and session integrity', () => {
  it('a valid Auth JWT without a gate grant is denied', async () => {
    const { client } = await onboardMember(api, 'no_gate_user');
    const stripped = client.clone();
    stripped.gate = undefined;
    const res = await stripped.request('GET', '/v1/me');
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe('GATE_REQUIRED');
  });

  it("a gate grant bound to one user cannot authorize another user's session", async () => {
    const a = await onboardMember(api, 'grant_owner');
    const b = await onboardMember(api, 'grant_thief');
    const mixed = b.client.clone();
    mixed.gate = a.client.gate;
    expect((await mixed.request('GET', '/v1/me')).body.error?.code).toBe('GATE_REQUIRED');
  });

  it('a self-signed or metadata-forged token is rejected', async () => {
    const { client } = await onboardMember(api, 'forger');
    const forged = client.clone();
    forged.member = {
      accessToken: await new SignJWT({
        session_id: crypto.randomUUID(),
        aal: 'aal2',
        role: 'authenticated',
        user_metadata: { isAdmin: true },
      })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(crypto.randomUUID())
        .setIssuer('stumps-local-auth')
        .setAudience('authenticated')
        .setExpirationTime('5m')
        .sign(new TextEncoder().encode('attacker-chosen-secret-that-is-long-enough')),
      refreshToken: 'x',
    };
    expect((await forged.request('GET', '/v1/me')).body.error?.code).toBe('UNAUTHENTICATED');
  });

  it('login is generic on bad credentials and requires a gate', async () => {
    await onboardMember(api, 'login_target', 'the-right-password-1');
    const noGate = api.client('203.0.113.30');
    expect(
      (
        await noGate.request('POST', '/v1/auth/login', {
          email: 'login_target@example.test',
          password: 'the-right-password-1',
        })
      ).body.error?.code,
    ).toBe('GATE_REQUIRED');
    const client = api.client('203.0.113.31');
    await client.passGate();
    const bad = await client.request('POST', '/v1/auth/login', {
      email: 'login_target@example.test',
      password: 'nope-nope-nope',
    });
    const unknown = await client.request('POST', '/v1/auth/login', {
      email: 'nobody@example.test',
      password: 'nope-nope-nope',
    });
    expect(bad.body.error).toEqual(unknown.body.error);
    const good = await client.request('POST', '/v1/auth/login', {
      email: 'login_target@example.test',
      password: 'the-right-password-1',
    });
    expect(good.status).toBe(200);
    // Tokens never appear in browser-visible JSON.
    expect(JSON.stringify(good.body)).not.toContain(client.member!.accessToken);
  });

  it('logout revokes the session server-side even if the browser kept the token', async () => {
    const { client } = await onboardMember(api, 'logout_user');
    const kept = client.clone();
    await client.request('POST', '/v1/auth/logout', { scope: 'current' });
    expect((await kept.request('GET', '/v1/me')).body.error?.code).toBe('SESSION_REVOKED');
  });

  it('concurrent refreshes of one refresh token share a single result (E71)', async () => {
    const { client } = await onboardMember(api, 'refresh_racer');
    const tabs = [client.clone(), client.clone(), client.clone()];
    const refreshToken = client.member!.refreshToken;
    const results = await Promise.all(
      tabs.map((t) =>
        t.request('POST', '/v1/auth/refresh?scope=member', undefined, { refresh: refreshToken }),
      ),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(new Set(tabs.map((t) => t.member!.accessToken)).size).toBe(1);
    expect((await tabs[0]!.request('GET', '/v1/me')).status).toBe(200);
  });

  it('a suspended member is denied on the next request', async () => {
    const { client, userId } = await onboardMember(api, 'suspended_user');
    await api.admin.query(
      `UPDATE app_private.profiles SET suspended_until = now() + interval '1 day' WHERE user_id = $1`,
      [userId],
    );
    expect((await client.request('GET', '/v1/me')).body.error?.code).toBe('BANNED');
  });

  it('onboarding rejects taken and reserved usernames and offers an editable suggestion', async () => {
    await onboardMember(api, 'taken_name');
    const { client } = await onboardMember(api, 'second_user');
    const taken = await client.request('PATCH', '/v1/profiles/me', {
      username: 'taken_name',
      displayName: 'Second',
      visibility: 'members',
      activityVisible: true,
    });
    expect(taken.body.error?.code).toBe('USERNAME_TAKEN');
    expect(taken.body.error?.details?.suggestion).toMatch(/^taken_name_\d{3}$/);
    const reserved = await client.request('PATCH', '/v1/profiles/me', {
      username: 'admin',
      displayName: 'Admin',
      visibility: 'members',
      activityVisible: true,
    });
    expect(reserved.body.error?.code).toBe('USERNAME_TAKEN');
  });

  it('profile updates cannot smuggle counters or roles', async () => {
    const { client } = await onboardMember(api, 'smuggler');
    const res = await client.request('PATCH', '/v1/profiles/me', {
      username: 'smuggler',
      displayName: 'S',
      visibility: 'members',
      activityVisible: true,
      gold: 99,
      role: 'super_admin',
    });
    expect(res.body.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('signed BFF ingress', () => {
  it('rejects unsigned, tampered, stale and replayed requests', async () => {
    const client = api.client('192.0.2.200');
    client.attempt = 'A'.repeat(43);
    const unsigned = await api.app.inject({ method: 'GET', url: '/v1/access/status' });
    expect(unsigned.statusCode).toBe(403);

    const headers = client.signedHeaders(
      'POST',
      '/v1/auth/enroll',
      JSON.stringify({ email: 'a@example.test' }),
    );
    const tampered = await api.app.inject({
      method: 'POST',
      url: '/v1/auth/enroll',
      headers,
      payload: JSON.stringify({ email: 'b@example.test' }),
    });
    expect(tampered.statusCode).toBe(403);

    const spoofedIp = await api.app.inject({
      method: 'GET',
      url: '/v1/access/status',
      headers: {
        ...client.signedHeaders('GET', '/v1/access/status', ''),
        'x-stumps-ip': '10.0.0.1',
      },
    });
    expect(spoofedIp.statusCode).toBe(403);

    const once = client.signedHeaders('GET', '/v1/access/status', '');
    expect(
      (await api.app.inject({ method: 'GET', url: '/v1/access/status', headers: once })).statusCode,
    ).toBe(200);
    expect(
      (await api.app.inject({ method: 'GET', url: '/v1/access/status', headers: once })).statusCode,
    ).toBe(403);

    const stale = client.signedHeaders('GET', '/v1/access/status', '');
    stale['x-stumps-ts'] = String(Date.now() - 120_000);
    expect(
      (await api.app.inject({ method: 'GET', url: '/v1/access/status', headers: stale }))
        .statusCode,
    ).toBe(403);
  });

  it('a browser-supplied X-Forwarded-For is never trusted for rate limiting', async () => {
    const client = api.client('203.0.113.77');
    const res = await client.request('GET', '/v1/access/status', undefined, {
      rawHeaders: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.status).toBe(200);
  });
});
