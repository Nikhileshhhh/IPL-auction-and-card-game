'use client';

import { useState } from 'react';
import type { AuctionLiveSnapshot } from '@stumps/contracts';
import { Button, Surface } from '@stumps/ui';
import type { LinkStatus } from '@/features/room/connection';
import { formatRupees } from '@/features/auction/setup/money';
import { OUTCOME_LABELS, teamById } from '@/features/auction/stage/model';

type Item = AuctionLiveSnapshot['history'][number];

/**
 * After a reconnect, the real results that happened while this tab was away
 * (confirmed by the server, never optimistic), with the viewer's own team's
 * purchases first and its purse now.
 */
export function MissedRecap({ live, status }: { live: AuctionLiveSnapshot; status: LinkStatus }) {
  const head = live.history[0]?.nominationId ?? null;
  // The last result seen while connected; frozen while this tab is away.
  const [seen, setSeen] = useState({ status, head, lastSeen: head });
  const [missed, setMissed] = useState<Item[] | null>(null);
  if (seen.status !== status || seen.head !== head) {
    // A reconnect delivers the snapshot together with `live`, so the new head is here now.
    if (status === 'live' && seen.status === 'reconnecting' && seen.lastSeen !== head) {
      const items: Item[] = [];
      for (const h of live.history) {
        if (h.nominationId === seen.lastSeen) break;
        items.push(h);
      }
      if (items.length) setMissed(items);
    }
    setSeen({ status, head, lastSeen: status === 'live' ? head : seen.lastSeen });
  }

  if (!missed) return null;
  const mine = missed.filter((m) => m.teamId === live.myTeamId);
  const team = teamById(live, live.myTeamId);
  return (
    <Surface aria-labelledby="missed-heading" className="border-auction/50 p-4">
      <h2 id="missed-heading" className="text-lg font-semibold">
        While you were away
      </h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {[...mine, ...missed.filter((m) => m.teamId !== live.myTeamId)].map((h) => (
          <li key={h.nominationId} className={h.teamId === live.myTeamId ? 'font-semibold' : ''}>
            #{h.lotNumber} {h.name} — {OUTCOME_LABELS[h.outcome]}
            {h.teamId ? ` · ${teamById(live, h.teamId)?.shortName ?? ''}` : ''}
            {h.priceRupees ? ` · ${formatRupees(h.priceRupees)}` : ''}
          </li>
        ))}
      </ul>
      {team ? (
        <p className="mt-2 text-sm text-ink-2">
          Your purse now: {formatRupees(team.remainingPurseRupees)} · {team.rosterCount} players
        </p>
      ) : null}
      <Button className="mt-3" size="touch" variant="secondary" onClick={() => setMissed(null)}>
        Got it
      </Button>
    </Surface>
  );
}
