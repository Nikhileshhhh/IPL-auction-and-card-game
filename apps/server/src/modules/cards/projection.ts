import { CARD_METRICS, type PermittedCardSnapshotDTO } from '@stumps/contracts';
import { RNG_VERSION, displayRating } from '@stumps/game-engines';
import type { Secrets } from '../../config/secrets';
import type { GameProjector } from '../../rooms/projection';
import { arenaCards, openSeed } from './apply';
import { lastResolved, loadMatch } from './store';

/**
 * Per-viewer card snapshot (DB spec §10). Built from the authoritative rows,
 * it carries every seat's deck count, the viewer's own deck in play order, and
 * never another player's deck or the seed; the seed is disclosed as
 * `auditSeed` only once the match has a result.
 */
export function cardProjector(secrets: Secrets): GameProjector {
  return async (tx, room, member): Promise<PermittedCardSnapshotDTO | null> => {
    if (room.game_type !== 'card') return null;
    const match = await loadMatch(tx, room.id);
    if (!match) return null;
    const { state, meta } = match;
    const roomRow = (
      await tx.query<{ seed_commitment: string; seed_ciphertext: Buffer | null }>(
        'SELECT seed_commitment, seed_ciphertext FROM app_private.rooms WHERE id = $1',
        [room.id],
      )
    ).rows[0];
    const open = state.comparison;
    // The viewer's own deck, front first (ADR-021 §5a). Never anyone else's.
    const myDeckIds = state.seats.find((s) => s.memberId === member.id)?.deck ?? [];
    const visibleIds = [
      ...myDeckIds,
      ...(open?.active ?? []).map((a) => a.instanceId),
      ...state.pot.map((p) => p.instanceId),
    ];
    const cards = await arenaCards(tx, state, visibleIds);
    const card = (id: string) => cards.get(id) as NonNullable<ReturnType<typeof cards.get>>;
    const last = await lastResolved(tx, room.id);
    const running = room.lifecycle === 'RUNNING' && !state.result;
    const seated = state.seats.some((s) => s.memberId === member.id);
    const myAllowedActions: PermittedCardSnapshotDTO['myAllowedActions'] = [];
    if (running && open && member.id === open.selector)
      myAllowedActions.push('card.selectCategory');
    if (running && open && seated) myAllowedActions.push('card.revealAcknowledged');

    return {
      totalCards: state.totalCards,
      seats: state.seats.map((s, seatOrder) => ({
        memberId: s.memberId,
        seatOrder,
        deckCount: s.deck.length,
        eliminationOrder: s.eliminationOrder,
        contestsWon: s.contestsWon,
      })),
      deckCountsBySeat: Object.fromEntries(state.seats.map((s) => [s.memberId, s.deck.length])),
      comparisonId: open?.id ?? null,
      comparisonIndex: open?.index ?? state.lastComparisonIndex,
      chainIndex: state.chainIndex,
      selectorSeat: open?.selector ?? null,
      eligibleSeats: open?.contributors ?? [],
      tiedSeats: state.tiedSeats,
      isTie: state.tiedSeats.length > 0,
      visibleCards: (open?.active ?? []).map((a) => ({
        memberId: a.memberId,
        card: card(a.instanceId),
      })),
      potCount: state.pot.length,
      myDeck: myDeckIds.map((id) => card(id)),
      contributions: state.pot.map((p) => ({ memberId: p.memberId, card: card(p.instanceId) })),
      allowedMetrics: open ? [...CARD_METRICS] : [],
      metric: last?.metric ?? null,
      deadline: open && meta.phaseDeadline ? meta.phaseDeadline.toISOString() : null,
      myAllowedActions,
      seedCommitment: roomRow?.seed_commitment ?? '',
      rngVersion: meta.rngVersion || RNG_VERSION,
      finishPending: meta.finishPending,
      completedContests: state.completedContests,
      lastComparison: last
        ? {
            comparisonId: last.id,
            metric: last.metric,
            byTimeout: last.by_timeout,
            submittedValues: last.values.map((v) => ({
              memberId: v.contributor_id,
              value: displayRating(v.metric_points),
            })),
            winnerId: last.winner_id,
            tiedSeats: last.tied_ids,
            reason: last.reason,
          }
        : null,
      result: state.result,
      auditSeed:
        state.result && roomRow?.seed_ciphertext
          ? openSeed(secrets, room, roomRow.seed_ciphertext)
          : null,
    };
  };
}
