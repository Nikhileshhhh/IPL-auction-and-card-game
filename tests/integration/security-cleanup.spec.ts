import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sweepSecurityTables } from '../../apps/server/src/jobs/security-cleanup';
import { ACCESS_CODE, createTestApi, onboardMember, type TestApi } from '../support/api';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_sweep');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());

describe('security TTL sweep', () => {
  it('deletes only expired security rows and is idempotent', async () => {
    const member = await onboardMember(api, 'sweep_user');
    await member.client.request('POST', '/v1/socket-tickets');
    await api.client('203.0.113.90').passGate('a-wrong-code-here');
    await api.admin.query(
      `UPDATE app_private.socket_tickets SET issued_at = now() - interval '1 hour', expires_at = now() - interval '1 hour' + interval '20 seconds'`,
    );
    await api.admin.query(
      `UPDATE app_private.access_attempts SET expires_at = now() - interval '1 second' WHERE kind = 'ip'`,
    );
    const first = await sweepSecurityTables(api.pool);
    expect(first.socket_tickets).toBe(1);
    expect(first.access_attempts).toBe(1);
    const second = await sweepSecurityTables(api.pool);
    expect(Object.values(second).every((n) => n === 0)).toBe(true);
    // Live member state is untouched.
    expect((await member.client.request('GET', '/v1/me')).status).toBe(200);
  });
});
