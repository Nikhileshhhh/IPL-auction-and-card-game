import type { RoomMemberSummary } from '@stumps/contracts';
import { fallbackText, type Last } from './fallback';

/** Fallback explanation for the comparison sheet (S10/S11). */
export function FallbackExplanation({
  last,
  members,
}: {
  last: Last | null;
  members: readonly RoomMemberSummary[];
}) {
  const text = last ? fallbackText(last, members) : null;
  return text ? <p className="text-sm text-ink-2">{text}</p> : null;
}
