import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCESS_CODE,
  adminSignIn,
  createTestApi,
  makeAdmin,
  onboardMember,
  totpCode,
  verifyTotp,
  type TestApi,
} from '../support/api';

let api: TestApi;
const rotation = (version: string, extra: Record<string, unknown> = {}) => ({
  newCode: 'rotated-code-123456',
  expiresAt: null,
  windowSeconds: 900,
  lockoutSeconds: 900,
  rotationPolicy: 'REVOKE_EXISTING',
  version,
  ...extra,
});

beforeAll(async () => {
  api = await createTestApi('stumps_sec_admin');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());
beforeEach(async () => api.setAccessCode(ACCESS_CODE));

async function currentVersion(): Promise<string> {
  const res = await api.admin.query(
    'SELECT version::text FROM app_private.access_config WHERE id = 1',
  );
  return res.rows[0].version as string;
}

describe('administrator access (S32)', () => {
  it('non-admins cannot sign in to the admin area and get the generic credentials error', async () => {
    const member = await onboardMember(api, 'plain_member');
    const res = await api
      .client()
      .request('POST', '/v1/admin/auth/login', { email: member.email, password: member.password });
    expect(res.body.error?.code).toBe('BAD_CREDENTIALS');
  });

  it('an AAL1 admin session cannot use admin endpoints (MFA bypass)', async () => {
    const m = await onboardMember(api, 'aal1_admin');
    await makeAdmin(api, m.userId);
    const client = api.client('198.51.100.8');
    const login = await client.request('POST', '/v1/admin/auth/login', {
      email: m.email,
      password: m.password,
    });
    expect(login.body.data).toMatchObject({ mfaRequired: true, enrollmentAllowed: true });
    const res = await client.request('GET', '/v1/admin/access', undefined, { admin: true });
    expect(res.body.error?.code).toBe('MFA_REQUIRED');
    // A member token is not an admin token either.
    expect(
      (await m.client.request('GET', '/v1/admin/access', undefined, { admin: false })).body.error
        ?.code,
    ).toBe('SESSION_REVOKED');
  });

  it('enrollment is only possible inside the operator window and only once', async () => {
    const m = await onboardMember(api, 'window_admin');
    await api.admin.query(
      `INSERT INTO app_private.admin_assignments (user_id, role) VALUES ($1, 'operator')`,
      [m.userId],
    );
    const client = api.client('198.51.100.9');
    await client.request('POST', '/v1/admin/auth/login', { email: m.email, password: m.password });
    const res = await client.request('POST', '/v1/admin/auth/mfa/enroll', undefined, {
      admin: true,
      refresh: client.adminSession!.refreshToken,
    });
    expect(res.body.error?.code).toBe('FORBIDDEN');
  });

  it('a wrong TOTP code does not upgrade the session', async () => {
    const m = await onboardMember(api, 'wrong_totp');
    await makeAdmin(api, m.userId);
    const client = api.client('198.51.100.10');
    await client.request('POST', '/v1/admin/auth/login', { email: m.email, password: m.password });
    const enroll = await client.request<{ factorId: string }>(
      'POST',
      '/v1/admin/auth/mfa/enroll',
      undefined,
      {
        admin: true,
        refresh: client.adminSession!.refreshToken,
      },
    );
    const challenge = await client.request<{ challengeId: string }>(
      'POST',
      '/v1/admin/auth/mfa/challenge',
      { factorId: enroll.body.data!.factorId },
      { admin: true, refresh: client.adminSession!.refreshToken },
    );
    const res = await client.request(
      'POST',
      '/v1/admin/auth/mfa',
      {
        factorId: enroll.body.data!.factorId,
        challengeId: challenge.body.data!.challengeId,
        code: '000000',
      },
      { admin: true, refresh: client.adminSession!.refreshToken },
    );
    expect(res.body.error?.code).toBe('MFA_REQUIRED');
  });

  it('admin rotates the secret securely: AAL2 + step-up, version check, audit without the code', async () => {
    const m = await onboardMember(api, 'rotating_admin');
    await makeAdmin(api, m.userId);
    const { client, factorId, secret } = await adminSignIn(api, m.email, m.password);
    expect(
      (await client.request('GET', '/v1/admin/access', undefined, { admin: true })).status,
    ).toBe(200);

    const stale = await client.request('PUT', '/v1/admin/access', rotation('1'), { admin: true });
    expect(stale.body.error?.code).toBe('VERSION_CONFLICT');

    const version = await currentVersion();
    const rotated = await client.request<{ version: string; revokedGrants: number }>(
      'PUT',
      '/v1/admin/access',
      rotation(version),
      { admin: true },
    );
    expect(rotated.status).toBe(200);
    expect(rotated.body.data!.version).toBe((BigInt(version) + 1n).toString());

    // Members are forced to re-verify, then the new code works and the old one does not.
    expect((await m.client.request('GET', '/v1/me')).body.error?.code).toBe('GATE_REQUIRED');
    expect((await api.client('203.0.113.50').passGate(ACCESS_CODE)).body.error?.code).toBe(
      'GATE_INVALID',
    );
    expect((await api.client('203.0.113.51').passGate('rotated-code-123456')).status).toBe(200);

    const audit = await api.admin.query(
      `SELECT safe_diff FROM app_private.admin_audit WHERE action = 'access.rotated'`,
    );
    expect(JSON.stringify(audit.rows)).not.toContain('rotated-code-123456');
    const stored = await api.admin.query('SELECT code_hash FROM app_private.access_config');
    expect(stored.rows[0].code_hash).toMatch(/^\$argon2id\$/);

    // Step-up expires after 5 minutes.
    await api.admin.query(
      `UPDATE app_private.app_sessions SET step_up_at = now() - interval '6 minutes' WHERE scope = 'admin'`,
    );
    const late = await client.request('PUT', '/v1/admin/access', rotation(await currentVersion()), {
      admin: true,
    });
    expect(late.body.error?.code).toBe('STEP_UP_REQUIRED');
    await verifyTotp(client, factorId, secret);
    const generated = await client.request<{ generatedCode: string }>(
      'PUT',
      '/v1/admin/access',
      rotation(await currentVersion(), { newCode: undefined, generate: true }),
      { admin: true },
    );
    expect(generated.body.data!.generatedCode).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(totpCode(secret)).toMatch(/^\d{6}$/);
  });

  it('revoking the admin assignment takes effect on the next request', async () => {
    const m = await onboardMember(api, 'revoked_admin');
    await makeAdmin(api, m.userId);
    const { client } = await adminSignIn(api, m.email, m.password);
    await api.admin.query(
      'UPDATE app_private.admin_assignments SET revoked_at = now() WHERE user_id = $1',
      [m.userId],
    );
    expect(
      (await client.request('GET', '/v1/admin/me', undefined, { admin: true })).body.error?.code,
    ).toBe('ADMIN_REQUIRED');
  });

  it('idle admin sessions expire after 30 minutes', async () => {
    const m = await onboardMember(api, 'idle_admin');
    await makeAdmin(api, m.userId);
    const { client } = await adminSignIn(api, m.email, m.password);
    await api.admin.query(
      `UPDATE app_private.app_sessions SET last_seen_at = now() - interval '31 minutes'
        WHERE scope = 'admin' AND user_id = $1`,
      [m.userId],
    );
    expect(
      (await client.request('GET', '/v1/admin/me', undefined, { admin: true })).body.error?.code,
    ).toBe('SESSION_REVOKED');
  });
});
