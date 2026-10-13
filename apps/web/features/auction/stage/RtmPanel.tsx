'use client';

import { useState } from 'react';
import type { AuctionLiveSnapshot, Nomination } from '@stumps/contracts';
import { Button, StatusMessage, Surface, TextField } from '@stumps/ui';
import type { RoomConnection } from '@/features/room/connection';
import { formatRupees, fullRupees } from '../setup/money';
import { teamById } from './model';

const LAKH = 100_000n;

/**
 * Right to match (2025 regulations, S20). The previous franchise decides to
 * use a card; the highest bidder then makes one final offer (equal holds);
 * the previous franchise matches it or lets the player go. Only the team
 * whose turn it is sees controls; everyone else sees whose decision it is.
 */
export function RtmPanel({
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
  const [error, setError] = useState<string | null>(null);
  const standingRupees = lot.highBidRupees ?? '0';
  const [offerLakh, setOfferLakh] = useState('');
  const rtmTeam = teamById(live, lot.rtmFranchiseId);
  const bidder = teamById(live, lot.highFranchiseId);
  const allowed = (a: string) => live.myAllowedActions.includes(a) && !disabled;

  async function send(key: string, type: string, payload: Record<string, unknown>) {
    setPending(key);
    setError(null);
    const res = await connection.command(type, { nominationId: lot.id, ...payload });
    setPending(null);
    if (!res.ok) setError(res.error.message);
    connection.refresh();
  }

  if (lot.stage === 'bidding' || lot.stage === 'settled') return null;
  const final = lot.rtmFinalBidRupees ?? standingRupees;
  const offer = /^\d{1,5}$/.test(offerLakh.trim())
    ? (BigInt(offerLakh.trim()) * LAKH).toString()
    : null;

  return (
    <Surface aria-labelledby="rtm-heading" className="border-auction/50">
      <h2 id="rtm-heading" className="text-lg font-semibold">
        Right to match
      </h2>
      {lot.stage === 'rtm_intent' ? (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {rtmTeam?.name} may use a right-to-match card for {lot.player.name} at{' '}
            <span title={fullRupees(standingRupees)}>{formatRupees(standingRupees)}</span>.
          </p>
          {allowed('auction.rtm.intent') ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="auction"
                size="key"
                pending={pending === 'invoke'}
                disabled={pending !== null}
                onClick={() => void send('invoke', 'auction.rtm.intent', { invoke: true })}
              >
                Use right to match
              </Button>
              <Button
                variant="secondary"
                size="key"
                pending={pending === 'decline'}
                disabled={pending !== null}
                onClick={() => void send('decline', 'auction.rtm.intent', { invoke: false })}
              >
                Let {bidder?.shortName ?? 'them'} have him
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {lot.stage === 'rtm_raise' ? (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {rtmTeam?.name} wants to match. {bidder?.name} makes one final offer: the same amount
            holds, or raise it in whole lakhs.
          </p>
          {allowed('auction.rtm.finalOffer') ? (
            <div className="mt-3 flex flex-col gap-3">
              <TextField
                label="Final offer in lakh"
                inputMode="numeric"
                value={offerLakh}
                onChange={(e) => setOfferLakh(e.target.value)}
                hint={`At least ${formatRupees(standingRupees)} (${(BigInt(standingRupees) / LAKH).toString()} lakh)`}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="auction"
                  size="key"
                  pending={pending === 'raise'}
                  disabled={pending !== null || offer === null}
                  onClick={() =>
                    offer && void send('raise', 'auction.rtm.finalOffer', { amountRupees: offer })
                  }
                >
                  {offer ? `Offer ${formatRupees(offer)}` : 'Offer'}
                </Button>
                <Button
                  variant="secondary"
                  size="key"
                  pending={pending === 'hold'}
                  disabled={pending !== null}
                  onClick={() =>
                    void send('hold', 'auction.rtm.finalOffer', { amountRupees: standingRupees })
                  }
                >
                  Hold at {formatRupees(standingRupees)}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
      {lot.stage === 'rtm_match' ? (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {bidder?.name}’s final offer is{' '}
            <span className="font-semibold text-ink" title={fullRupees(final)}>
              {formatRupees(final)}
            </span>
            . {rtmTeam?.name} may match it with a right-to-match card.
          </p>
          {allowed('auction.rtm.match') ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="auction"
                size="key"
                pending={pending === 'match'}
                disabled={pending !== null}
                onClick={() => void send('match', 'auction.rtm.match', { match: true })}
              >
                Match {formatRupees(final)}
              </Button>
              <Button
                variant="secondary"
                size="key"
                pending={pending === 'nomatch'}
                disabled={pending !== null}
                onClick={() => void send('nomatch', 'auction.rtm.match', { match: false })}
              >
                Don’t match
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {error ? (
        <StatusMessage tone="error" className="mt-3">
          {error}
        </StatusMessage>
      ) : null}
    </Surface>
  );
}
