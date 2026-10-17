'use client';

import { useCue } from '@/features/audio/useCue';
import type { AuctionLiveSnapshot as LiveAuction } from '@stumps/contracts';

/**
 * Sound cues for the stage (ADR-031): a tick for each accepted bid and a tone
 * for each settled lot. Keys come from the server's bid version and
 * nomination ID, so a duplicate or replayed event stays silent, and the state
 * on screen at mount (refresh or reconnect) never plays.
 */
export function AuctionCues({ live }: { live: LiveAuction }) {
  const lot = live.lot;
  useCue('bid', lot?.highBidRupees ? `${lot.id}:${lot.bidVersion}` : null);
  const latest = live.history.reduce<(typeof live.history)[number] | null>(
    (best, h) =>
      !best || h.pass * 10_000 + h.lotNumber > best.pass * 10_000 + best.lotNumber ? h : best,
    null,
  );
  const settled = latest && latest.outcome !== 'skipped' && latest.outcome !== 'cancelled';
  useCue(
    latest?.outcome === 'unsold' ? 'unsold' : 'sold',
    settled ? `${latest.nominationId}:${latest.outcome}` : null,
  );
  return null;
}
