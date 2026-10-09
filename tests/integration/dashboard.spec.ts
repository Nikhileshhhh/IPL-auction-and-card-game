import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_CODE, createTestApi, onboardMember, type TestApi } from '../support/api';

let api: TestApi;
beforeAll(async () => {
  api = await createTestApi('stumps_it_dashboard');
  await api.setAccessCode(ACCESS_CODE);
});
afterAll(async () => api?.close());

describe('member summary (S04)', () => {
  it('reports zero medals for a new member and requires gate + session', async () => {
    const { client } = await onboardMember(api, 'fresh_member');
    const res = await client.request<{ medals: Record<string, number>; recentMedals: unknown[] }>(
      'GET',
      '/v1/me/summary',
    );
    expect(res.status).toBe(200);
    expect(res.body.data!.medals).toEqual({
      gold: 0,
      silver: 0,
      bronze: 0,
      games: 0,
      cardWins: 0,
      auctionWins: 0,
    });
    expect(res.body.data!.recentMedals).toEqual([]);
    const anonymous = await api.client('192.0.2.44').request('GET', '/v1/me/summary');
    expect(anonymous.status).toBe(401);
  });

  it('medal counts come only from the server summary and receipts', async () => {
    const { client, userId } = await onboardMember(api, 'medal_member');
    await api.admin.query(
      `INSERT INTO app_private.achievement_receipts
         (award_batch, user_id, game_type, rank, medal_place, medal, scope, credited_role, completion_day, ruleset_version, qualifies)
       VALUES (gen_random_uuid(), $1, 'card', 1, 1, 'gold', 'personal', 'player', '2026-10-01', 'card-v1', true),
              (gen_random_uuid(), $1, 'auction', 2, 2, 'silver', 'franchise', 'advisor', '2026-10-05', 'auction-v1', true)`,
      [userId],
    );
    await api.admin.query(
      `UPDATE app_private.achievement_summaries SET gold = 1, silver = 1, games = 2, card_wins = 1 WHERE user_id = $1`,
      [userId],
    );
    const res = await client.request<{
      medals: Record<string, number>;
      recentMedals: { medal: string; scope: string }[];
    }>('GET', '/v1/me/summary');
    expect(res.body.data!.medals).toMatchObject({
      gold: 1,
      silver: 1,
      bronze: 0,
      games: 2,
      cardWins: 1,
    });
    expect(res.body.data!.recentMedals.map((m) => [m.medal, m.scope])).toEqual([
      ['silver', 'franchise'],
      ['gold', 'personal'],
    ]);
    // A client cannot write counters through any profile endpoint.
    const forged = await client.request('PATCH', '/v1/profiles/me', {
      username: 'medal_member',
      displayName: 'M',
      visibility: 'members',
      activityVisible: true,
      medals: { gold: 99 },
    });
    expect(forged.body.error?.code).toBe('VALIDATION_FAILED');
  });

  it('announcements show only active, unarchived items as plain text', async () => {
    const { client, userId } = await onboardMember(api, 'announce_reader');
    await api.admin.query(
      `INSERT INTO app_private.announcements (title, body, starts_at, ends_at, author_id, archived_at) VALUES
        ('Live', '<script>alert(1)</script> season starts', now() - interval '1 hour', now() + interval '1 day', $1, NULL),
        ('Future', 'later', now() + interval '1 day', now() + interval '2 days', $1, NULL),
        ('Archived', 'old', now() - interval '1 hour', now() + interval '1 day', $1, now())`,
      [userId],
    );
    const res = await client.request<{ items: { title: string; body: string }[] }>(
      'GET',
      '/v1/announcements',
    );
    expect(res.body.data!.items.map((i) => i.title)).toEqual(['Live']);
    expect(res.body.data!.items[0]!.body).toContain('<script>');
  });
});
