import { createHmac } from 'node:crypto';
import type { CompletionReason } from '@stumps/contracts';
import {
  EVALUATOR_VERSION,
  RNG_VERSION,
  gameQualifies,
  maskIds,
  medalPlacements,
  prepare,
  presentEnough,
  rankSquads,
  scoreReport,
  squadDeficits,
  type Deficit,
  type Placement,
  type Rational,
  type RankEntry,
} from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { Tx } from '../../db/transaction';
import type { RoomRow } from '../../rooms/room-tx';
import type { EventDraft } from '../../rooms/streams';
import { openAuctionSeed } from '../auctions/live';
import { poolPlayers } from '../auctions/setup';
import type { EvaluationInput } from './auction-input';
import { closeParticipation, completeRoom, type Award, type PublicResult } from './finalize';

/**
 * Auction results (rules §10, §13). Legal squads are ranked by their exact
 * optimal-XI score; the first three legal squads take the medals, credited
 * once to each teammate who was on the roster at the start and present for
 * at least half the auction ("Team gold"). Ineligible squads are listed below
 * with what they lack; with no legal squad there is no champion.
 */

export interface BestXi {
  bestObjective: number | null;
  bestMask: number | null;
}

/** Display value of a points-scale rational on the 0–100 scale, two decimals. */
const display = (r: Rational) => Number((r.n * 100n) / (r.d * 10n)) / 100;

const LABELS: Record<string, string> = {
  players: '11 players',
  keeper: 'a wicketkeeper',
  bowlers: '5 bowling options',
  pace: '2 pace bowlers',
  spin: 'a spinner',
  batters: '6 batting options',
  domestic: 'at least 7 Indian players',
};

export function deficitText(d: Deficit): string {
  switch (d.code) {
    case 'SQUAD_TOO_SMALL':
      return `Needs ${d.need} more player${d.need === 1 ? '' : 's'} for a full squad`;
    case 'SQUAD_TOO_LARGE':
      return `${d.over} player${d.over === 1 ? '' : 's'} over the squad limit`;
    case 'OVERSEAS_OVER_CAP':
      return `${d.over} overseas player${d.over === 1 ? '' : 's'} over the limit`;
    case 'NO_LEGAL_XI':
      return d.missing.length
        ? `No legal XI: needs ${d.missing.map((m) => LABELS[m] ?? m).join(', ')}`
        : 'No legal XI can be picked from this squad';
  }
}

export async function finalizeAuctionRoom(
  tx: Tx,
  secrets: Secrets,
  room: RoomRow,
  input: EvaluationInput,
  best: Record<string, BestXi>,
  now: Date,
): Promise<EventDraft[]> {
  await closeParticipation(tx, room.id, now);
  const game = (
    await tx.query<{
      finished_reason: CompletionReason | null;
      seed_ciphertext: Buffer | null;
      seed_commitment: string | null;
    }>(
      `SELECT finished_reason, seed_ciphertext, seed_commitment FROM app_private.auction_games WHERE room_id = $1`,
      [room.id],
    )
  ).rows[0];
  const seed = game?.seed_ciphertext ? openAuctionSeed(secrets, room.id, game.seed_ciphertext) : '';
  const draw = (id: string) => createHmac('sha256', seed).update(`results:${id}`).digest('hex');

  const reports = new Map<
    string,
    { report: ReturnType<typeof scoreReport> | null; xi: string[] }
  >();
  const entries: RankEntry[] = input.squads.map((sq) => {
    const mask = best[sq.franchiseId]?.bestMask ?? null;
    const prep = prepare(sq.players, input.rules);
    const xi = mask === null ? [] : maskIds(prep, mask);
    const report =
      mask === null ? null : scoreReport(sq.players, new Set(xi), input.rules, input.ref);
    reports.set(sq.franchiseId, { report, xi });
    const deficits = squadDeficits(sq.players, input.rules, mask !== null);
    const inXi = new Set(xi);
    return {
      id: sq.franchiseId,
      legal: deficits.length === 0,
      total: report?.total ?? null,
      b: report?.b ?? null,
      w: report?.w ?? null,
      c: report?.c ?? null,
      completeness: sq.players
        .filter((p) => inXi.has(p.id))
        .reduce((s, p) => s + p.completeness, 0),
      draw: draw(sq.franchiseId),
      deficits,
    };
  });
  const ranked = rankSquads(entries);
  const settled = Number(
    (
      await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM app_private.auction_nominations
          WHERE room_id = $1 AND status IN ('sold', 'unsold')`,
        [room.id],
      )
    ).rows[0]?.n ?? 0,
  );
  const qualifies = gameQualifies(input.squads.length, settled);
  const legal = new Set(ranked.filter((r) => r.legal).map((r) => r.id));
  const placements = qualifies
    ? medalPlacements(
        ranked.map((r) => r.id),
        legal,
      )
    : new Map<string, Placement>();

  // Teammates credited with their franchise's result.
  const meta = (
    await tx.query<{ started_at: Date | null; paused_ms: string; data_version: string | null }>(
      `SELECT r.started_at, r.paused_ms::text, v.label AS data_version
         FROM app_private.rooms r LEFT JOIN app_private.data_versions v ON v.id = r.data_version_id
        WHERE r.id = $1`,
      [room.id],
    )
  ).rows[0];
  const startedAt = meta?.started_at ?? now;
  const activeMs = now.getTime() - startedAt.getTime() - Number(meta?.paused_ms ?? 0);
  const members = await tx.query<{
    auction_franchise_id: string;
    member_id: string;
    user_id: string;
    display_name: string;
    role: Award['creditedRole'];
    eligible_at_start: boolean;
    approved_at: Date;
    participation_ms: string;
  }>(
    `SELECT fm.auction_franchise_id, fm.member_id, m.user_id, p.display_name, fm.role,
            fm.eligible_at_start, fm.approved_at, m.participation_ms::text
       FROM app_private.franchise_members fm
       JOIN app_private.room_members m ON m.id = fm.member_id
       JOIN app_private.profiles p ON p.user_id = m.user_id
      WHERE fm.room_id = $1
      ORDER BY fm.auction_franchise_id, fm.role, p.display_name`,
    [room.id],
  );
  const credit = (
    m: (typeof members.rows)[number],
  ): 'late_join' | 'not_ready' | 'low_presence' | null => {
    if (!m.eligible_at_start) {
      return m.approved_at.getTime() > startedAt.getTime() ? 'late_join' : 'not_ready';
    }
    return presentEnough(Number(m.participation_ms), activeMs) ? null : 'low_presence';
  };

  const xiPlayers = await poolPlayers(tx, room, {
    playerIds: [...reports.values()].flatMap((r) => r.xi),
  });
  const byId = new Map(xiPlayers.map((p) => [p.playerId, p]));
  const squadOf = new Map(input.squads.map((s) => [s.franchiseId, s]));

  const rankings = ranked.map((r) => {
    const place = placements.get(r.id);
    const rep = reports.get(r.id)?.report;
    return {
      competitorId: r.id,
      displayName: squadOf.get(r.id)?.name ?? 'Franchise',
      rank: r.rank,
      medalPlacement: place?.medalPlace ?? null,
      medal: place?.medal ?? null,
      eligible: r.legal,
      summary:
        r.legal && rep
          ? `Score ${display(rep.total).toFixed(2)}`
          : deficitText(r.deficits[0] as Deficit),
      members: members.rows
        .filter((m) => m.auction_franchise_id === r.id)
        .map((m) => {
          const reason = credit(m);
          return {
            memberId: m.member_id,
            displayName: m.display_name,
            role: m.role,
            credited: reason === null,
            reason,
          };
        }),
    };
  });
  const awards: Award[] = qualifies
    ? ranked.flatMap((r) => {
        const place = placements.get(r.id);
        return members.rows
          .filter((m) => m.auction_franchise_id === r.id && credit(m) === null)
          .map((m) => ({
            userId: m.user_id,
            rank: r.rank,
            medalPlace: place?.medalPlace ?? null,
            medal: place?.medal ?? null,
            scope: 'franchise' as const,
            creditedRole: m.role,
            win: place?.medalPlace === 1,
          }));
      })
    : [];
  const publicResult: PublicResult = {
    gameType: 'auction',
    completionReason: game?.finished_reason ?? 'pool_complete',
    qualificationStatus: !qualifies ? 'practice' : legal.size === 0 ? 'no_champion' : 'qualifying',
    rankings,
    publicScoreReports: ranked.map((r) => {
      const entry = reports.get(r.id);
      const rep = entry?.report;
      return {
        franchiseId: r.id,
        legal: r.legal,
        total: rep ? display(rep.total) : null,
        components: rep
          ? {
              batting: display(rep.b),
              bowling: display(rep.w),
              allRound: display(rep.a),
              composition: display(rep.c),
              depth: display(rep.d),
              value: display(rep.v),
            }
          : null,
        xi: (entry?.xi ?? []).flatMap((id) => {
          const p = byId.get(id);
          return p
            ? [
                {
                  playerId: id,
                  name: p.name,
                  role: p.role,
                  overseas: p.overseas,
                  portraitUrl: p.portraitUrl,
                },
              ]
            : [];
        }),
        squadSize: squadOf.get(r.id)?.players.length ?? 0,
        deficits: r.deficits.map(deficitText),
      };
    }),
    rulesVersion: input.rulesetName,
    dataVersion: meta?.data_version ?? '',
    evaluatorVersion: EVALUATOR_VERSION,
    seedAudit: seed
      ? { seed, commitment: game?.seed_commitment ?? '', rngVersion: RNG_VERSION }
      : null,
  };
  const done = await completeRoom(
    tx,
    room,
    publicResult,
    awards,
    { ruleset: input.rulesetName, evaluator: EVALUATOR_VERSION },
    { input: input.hash, ranked: ranked.map((r) => r.id) },
    now,
  );
  const champion = ranked.find((r) => placements.get(r.id)?.medalPlace === 1)?.id ?? null;
  return [
    {
      audience: { kind: 'public' },
      type: 'game.completed',
      payload: {
        publicResult: {
          reason: game?.finished_reason ?? 'pool_complete',
          standings: ranked.map((r) => r.id),
          champion,
        },
        medalStatus: done.medalStatus,
        resultsExpiresAt: done.resultsExpiresAt,
        auditSeed: seed,
        rngVersion: RNG_VERSION,
      },
    },
    ...(done.expiring ? [done.expiring] : []),
  ];
}
