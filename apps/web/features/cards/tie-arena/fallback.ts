import type { RoomMemberSummary } from '@stumps/contracts';
import { seatName, type CardGame } from '../arena/model';

export type Last = NonNullable<CardGame['lastComparison']>;

/** Plain-language explanation of how a fallback settled a pot (rules §6). */
export function fallbackText(last: Last, members: readonly RoomMemberSummary[]): string | null {
  const f = last.fallback;
  if (!f) return null;
  const why =
    last.reason === 'TIE_CAP'
      ? 'The tie limit was reached, so no more cards were played.'
      : 'The tied players had no cards left.';
  const sums = f.sums.map((x) => `${seatName(members, x.memberId)} ${x.sum}`).join(' vs ');
  if (!f.byPermutation) {
    return `${why} The pot went to the higher total of their last card's stats (${sums}, internal points).`;
  }
  return `${why} Their last cards had equal totals (${sums}), so the committed seat order decided: ${f.rotatedOrder
    .map((id) => seatName(members, id))
    .join(' before ')}. You can check it with the seed after the match.`;
}
