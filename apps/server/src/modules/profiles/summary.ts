import type pg from 'pg';
import type { MemberContext } from '../auth/service';

export interface MedalSummary {
  gold: number;
  silver: number;
  bronze: number;
  games: number;
  cardWins: number;
  auctionWins: number;
}

export interface RecentMedal {
  medal: 'gold' | 'silver' | 'bronze';
  gameType: 'card' | 'auction';
  scope: 'personal' | 'franchise';
  completionDay: string;
}

/**
 * S04/S29 summary. Counters come only from the receipt-derived summary row
 * (never from client input); recent medals come from immutable receipts.
 */
export async function memberSummary(pool: pg.Pool, ctx: MemberContext) {
  const [summary, recent, friends] = await Promise.all([
    pool.query<{
      gold: string;
      silver: string;
      bronze: string;
      games: string;
      card_wins: string;
      auction_wins: string;
    }>(
      `SELECT gold, silver, bronze, games, card_wins, auction_wins
         FROM app_private.achievement_summaries WHERE user_id = $1`,
      [ctx.userId],
    ),
    pool.query<{
      medal: RecentMedal['medal'];
      game_type: RecentMedal['gameType'];
      scope: RecentMedal['scope'];
      completion_day: Date;
    }>(
      `SELECT medal, game_type, scope, completion_day FROM app_private.achievement_receipts
        WHERE user_id = $1 AND medal IS NOT NULL ORDER BY completion_day DESC, created_at DESC LIMIT 5`,
      [ctx.userId],
    ),
    pool.query<{ accepted: string; pending: string }>(
      `SELECT count(*) FILTER (WHERE status = 'accepted') AS accepted,
              count(*) FILTER (WHERE status = 'pending' AND requested_by <> $1) AS pending
         FROM app_private.friendships WHERE low_user_id = $1 OR high_user_id = $1`,
      [ctx.userId],
    ),
  ]);
  const row = summary.rows[0];
  const medals: MedalSummary = {
    gold: Number(row?.gold ?? 0),
    silver: Number(row?.silver ?? 0),
    bronze: Number(row?.bronze ?? 0),
    games: Number(row?.games ?? 0),
    cardWins: Number(row?.card_wins ?? 0),
    auctionWins: Number(row?.auction_wins ?? 0),
  };
  return {
    profile: {
      userId: ctx.userId,
      username: ctx.profile.username,
      displayName: ctx.profile.displayName,
    },
    medals,
    recentMedals: recent.rows.map((r): RecentMedal => ({
      medal: r.medal,
      gameType: r.game_type,
      scope: r.scope,
      completionDay: r.completion_day.toISOString().slice(0, 10),
    })),
    friends: {
      accepted: Number(friends.rows[0]?.accepted ?? 0),
      pendingIncoming: Number(friends.rows[0]?.pending ?? 0),
    },
  };
}

export async function activeAnnouncements(pool: pg.Pool) {
  const res = await pool.query<{
    id: string;
    title: string;
    body: string;
    starts_at: Date;
    ends_at: Date;
  }>(
    `SELECT id, title, body, starts_at, ends_at FROM app_private.announcements
      WHERE archived_at IS NULL AND starts_at <= now() AND ends_at > now()
      ORDER BY starts_at DESC LIMIT 3`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    startsAt: r.starts_at.toISOString(),
    endsAt: r.ends_at.toISOString(),
  }));
}
