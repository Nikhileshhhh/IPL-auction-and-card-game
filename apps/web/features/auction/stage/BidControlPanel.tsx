'use client';

import { useState } from 'react';
import type { AuctionLiveSnapshot, Nomination } from '@stumps/contracts';
import { Button } from '@stumps/ui';
import type { RoomConnection } from '@/features/room/connection';
import { formatRupees, fullRupees } from '../setup/money';
import { BLOCK_REASONS } from './model';

/**
 * The bid button, fixed at the bottom of the stage (56 px). It always shows
 * the exact amount the server will accept next; a stale bid is never raised
 * automatically — the new price is shown and the person decides again.
 */
export function BidControlPanel({
  live,
  lot,
  connection,
  disabled,
}: {
  live: AuctionLiveSnapshot;
  lot: Nomination;
  connection: RoomConnection;
  disabled: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ lot: string; version: string; text: string } | null>(null);
  const amount = lot.ownLegalNextBidRupees;
  const canBid = live.myAllowedActions.includes('auction.bid') && amount !== null && !disabled;
  // A notice belongs to the price it was about; a newer bid replaces it.
  const shown =
    notice && notice.lot === lot.id && notice.version === lot.bidVersion ? notice : null;

  async function bid() {
    if (!amount || pending) return;
    setPending(amount);
    setNotice(null);
    const res = await connection.command<{ acceptedAmountRupees: string }>('auction.bid', {
      nominationId: lot.id,
      nominationVersion: lot.bidVersion,
      amountRupees: amount,
    });
    setPending(null);
    if (res.ok) return;
    const details = res.error.details as { nextAmountRupees?: string; nominationVersion?: string };
    const text =
      res.error.code === 'STALE_BID' && details?.nextAmountRupees
        ? `Another bid came first. The next bid is now ${formatRupees(details.nextAmountRupees)}.`
        : res.error.code === 'LATE_BID'
          ? 'Too late: bidding on this player has closed.'
          : res.error.message;
    setNotice({ lot: lot.id, version: details?.nominationVersion ?? lot.bidVersion, text });
    connection.refresh();
  }

  if (lot.stage !== 'bidding') return null;
  const reason = lot.ownRejectionReason ? BLOCK_REASONS[lot.ownRejectionReason] : null;
  return (
    <div
      role="region"
      aria-label="Bid"
      className="sticky bottom-0 z-20 -mx-4 border-t border-line bg-midnight/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:-mx-6 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="key"
          variant="auction"
          className="min-w-[220px] flex-1 sm:flex-none"
          disabled={!canBid}
          pending={pending !== null}
          pendingLabel={pending ? `Submitting ${formatRupees(pending)}…` : undefined}
          onClick={() => void bid()}
          title={amount ? fullRupees(amount) : undefined}
        >
          {amount ? `Bid ${formatRupees(amount)}` : 'Bid'}
        </Button>
        <p className="min-w-0 flex-1 text-sm text-ink-2" aria-live="polite">
          {shown
            ? shown.text
            : reason && !canBid
              ? reason
              : amount
                ? 'Each bid is the next step on the auctioneer’s ladder.'
                : null}
        </p>
      </div>
    </div>
  );
}
