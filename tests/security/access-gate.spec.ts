import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCESS_CODE, createTestApi, type TestApi } from '../support/api';

let api: TestApi;

beforeAll(async () => {
  api = await createTestApi('stumps_sec_gate');
});
afterAll(async () => api?.close());
beforeEach(async () => {
  await api.admin.query(
    'TRUNCATE app_private.access_attempts, app_private.access_request_receipts CASCADE',
  );
  await api.setAccessCode(ACCESS_CODE);
});

describe('website access gate (E01)', () => {
  it('fails closed before any code is configured', async () => {
    await api.admin.query('UPDATE app_private.access_config SET code_hash = NULL');
    const client = api.client();
    const status = await client.request<{ gateStatus: string }>('GET', '/v1/access/status');
    expect(status.body.data!.gateStatus).toBe('closed');
    const res = await client.passGate('anything-at-all');
    expect(res.body.error?.code).toBe('GATE_INVALID');
  });

  it('counts exactly three failures and locks immediately on the third', async () => {
    const client = api.client();
    const remaining: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await client.passGate('wrong-code-attempt');
      remaining.push(
        (res.body.error!.details!.status as { remainingAttempts: number }).remainingAttempts,
      );
      if (i < 2) expect(res.body.error?.code).toBe('GATE_INVALID');
      else expect(res.body.error?.code).toBe('ACCESS_LOCKED');
    }
    expect(remaining).toEqual([2, 1, 0]);
  });

  it('a correct code while locked does not unlock, and lockout survives refresh/new tabs', async () => {
    const client = api.client();
    for (let i = 0; i < 3; i += 1) await client.passGate('wrong-code-attempt');
    const correct = await client.passGate(ACCESS_CODE);
    expect(correct.status).toBe(429);
    expect(correct.body.error?.code).toBe('ACCESS_LOCKED');
    expect(correct.headers['retry-after']).toBeDefined();
    const newTab = client.clone();
    const status = await newTab.request<{ gateStatus: string; lockedUntil: string }>(
      'GET',
      '/v1/access/status',
    );
    expect(status.body.data).toMatchObject({ gateStatus: 'locked', remainingAttempts: 0 });
    expect(Date.parse(status.body.data!.lockedUntil)).toBeGreaterThan(Date.now());
  });

  it('four concurrent wrong guesses in two tabs evaluate at most three (no fourth authorized guess)', async () => {
    const tab1 = api.client();
    await tab1.request('GET', '/v1/access/status');
    const tab2 = tab1.clone();
    const results = await Promise.all([
      tab1.passGate('wrong-1-abcdefg'),
      tab2.passGate('wrong-2-abcdefg'),
      tab1.passGate('wrong-3-abcdefg'),
      tab2.passGate('wrong-4-abcdefg'),
    ]);
    const codes = results.map((r) => r.body.error?.code).sort();
    expect(codes).toEqual(['ACCESS_LOCKED', 'ACCESS_LOCKED', 'GATE_INVALID', 'GATE_INVALID']);
    const row = await api.admin.query(
      'SELECT failures FROM app_private.access_attempts WHERE kind = $1',
      ['cookie'],
    );
    expect(row.rows[0]).toEqual({ failures: 3 });
  });

  it('a concurrent correct code racing three failures is either granted before the lock or refused after it', async () => {
    const tab = api.client();
    await tab.request('GET', '/v1/access/status');
    const results = await Promise.all([
      tab.passGate('wrong-a-abcdefg'),
      tab.passGate('wrong-b-abcdefg'),
      tab.passGate('wrong-c-abcdefg'),
      tab.clone().passGate(ACCESS_CODE),
    ]);
    const correct = results[3]!;
    const failures = results.slice(0, 3).filter((r) => r.body.error?.code !== undefined).length;
    expect(failures).toBe(3);
    if (correct.status === 200) {
      // Granted while fewer than three failures had been recorded.
      expect(results.slice(0, 3).some((r) => r.body.error?.code === 'GATE_INVALID')).toBe(true);
    } else {
      expect(correct.body.error?.code).toBe('ACCESS_LOCKED');
    }
  });

  it('retrying the same requestId replays the outcome without counting again', async () => {
    const client = api.client();
    await client.request('GET', '/v1/access/status');
    const requestId = randomUUID();
    const first = await client.request('POST', '/v1/access/verify', {
      code: 'wrong-once-xyz',
      requestId,
    });
    const replay = await client.request('POST', '/v1/access/verify', {
      code: 'wrong-once-xyz',
      requestId,
    });
    const changedBody = await client.request('POST', '/v1/access/verify', {
      code: ACCESS_CODE,
      requestId,
    });
    expect(first.body.error?.details).toEqual(replay.body.error?.details);
    // A replayed failed ID never re-runs the comparison: no free extra guess.
    expect(changedBody.body.error?.code).toBe('GATE_INVALID');
    const row = await api.admin.query(
      `SELECT failures FROM app_private.access_attempts WHERE kind = 'cookie'`,
    );
    expect(row.rows[0]).toEqual({ failures: 1 });
  });

  it('a successful replay re-binds the same grant instead of minting new ones', async () => {
    const client = api.client();
    await client.request('GET', '/v1/access/status');
    const requestId = randomUUID();
    await client.request('POST', '/v1/access/verify', { code: ACCESS_CODE, requestId });
    const first = client.gate;
    client.gate = undefined;
    await client.request('POST', '/v1/access/verify', { code: ACCESS_CODE, requestId });
    expect(client.gate).toBe(first);
    const grants = await api.admin.query(`SELECT count(*)::int AS n FROM app_private.gate_grants`);
    expect(grants.rows[0]!.n).toBeGreaterThanOrEqual(1);
  });

  it('success issues an opaque preauth grant and resets only the cookie bucket', async () => {
    const client = api.client();
    await client.passGate('wrong-before-success');
    const ok = await client.passGate(ACCESS_CODE);
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ gateStatus: 'preauth', remainingAttempts: 3 });
    expect(JSON.stringify(ok.body)).not.toContain(client.gate!);
    const ip = await api.admin.query(
      `SELECT failures FROM app_private.access_attempts WHERE kind = 'ip'`,
    );
    expect(ip.rows[0]).toEqual({ failures: 1 });
  });

  it('the attempt token cannot be replaced by a browser-invented value', async () => {
    const client = api.client();
    client.attempt = 'short';
    const res = await client.request('POST', '/v1/access/verify', {
      code: ACCESS_CODE,
      requestId: randomUUID(),
    });
    expect(res.status).toBe(400);
  });
});

describe('code rotation modes (E02)', () => {
  it('REVOKE_EXISTING invalidates old grants; PRESERVE_EXISTING keeps them until expiry', async () => {
    const preserved = api.client();
    await preserved.passGate();
    await api.setAccessCode('second-code-value-123', { policy: 'PRESERVE_EXISTING' });
    const stillValid = await preserved.request<{ gateStatus: string }>('GET', '/v1/access/status');
    expect(stillValid.body.data!.gateStatus).toBe('preauth');
    // The old code no longer admits new visitors.
    expect((await api.client('203.0.113.99').passGate(ACCESS_CODE)).body.error?.code).toBe(
      'GATE_INVALID',
    );

    await api.setAccessCode('third-code-value-456', { policy: 'REVOKE_EXISTING' });
    const revoked = await preserved.request<{ gateStatus: string }>('GET', '/v1/access/status');
    expect(revoked.body.data!.gateStatus).not.toBe('preauth');
    const enroll = await preserved.request('POST', '/v1/auth/enroll', { email: 'x@example.test' });
    expect(enroll.body.error?.code).toBe('GATE_REQUIRED');
  });
});
