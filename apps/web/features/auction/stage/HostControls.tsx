'use client';

import { useState } from 'react';
import type { AuctionLiveSnapshot } from '@stumps/contracts';
import { Button, StatusMessage } from '@stumps/ui';
import type { RoomConnection } from '@/features/room/connection';

/**
 * Host controls: pause only in the gap between players (at most three
 * pauses, two minutes each), resume, and skip a player before the first bid.
 */
export function HostControls({
  live,
  connection,
  disabled,
}: {
  live: AuctionLiveSnapshot;
  connection: RoomConnection;
  disabled: boolean;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const can = (a: string) => live.myAllowedActions.includes(a);
  const lot = live.lot;
  if (!can('auction.pause') && !can('auction.resume') && !can('auction.skip')) return null;

  async function send(type: string, payload: Record<string, unknown> = {}) {
    setPending(type);
    setError(null);
    const res = await connection.command(type, payload);
    setPending(null);
    if (!res.ok) setError(res.error.message);
    connection.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Host controls">
      {can('auction.skip') && lot ? (
        <Button
          variant="secondary"
          size="touch"
          disabled={disabled || pending !== null}
          pending={pending === 'auction.skip'}
          onClick={() => void send('auction.skip', { nominationId: lot.id })}
        >
          Skip player
        </Button>
      ) : null}
      {can('auction.pause') ? (
        <Button
          variant="secondary"
          size="touch"
          disabled={disabled || pending !== null}
          pending={pending === 'auction.pause'}
          onClick={() => void send('auction.pause')}
        >
          Pause ({live.pausesLeft} left)
        </Button>
      ) : null}
      {can('auction.resume') ? (
        <Button
          variant="auction"
          size="touch"
          disabled={disabled || pending !== null}
          pending={pending === 'auction.resume'}
          onClick={() => void send('auction.resume')}
        >
          Resume now
        </Button>
      ) : null}
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
    </div>
  );
}
