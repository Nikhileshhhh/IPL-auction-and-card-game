'use client';

import { useState } from 'react';
import { Button, StatusMessage, Surface, TextField } from '@stumps/ui';
import type { RoomConnection } from '@/features/room/connection';

/**
 * For a player who is not in a team once the auction is running: ask to join
 * one with its code. The captain still approves; a late joiner observes and
 * advises and cannot win this game's medal (rules §11).
 */
export function LateJoinPanel({
  connection,
  disabled,
}: {
  connection: RoomConnection;
  disabled: boolean;
}) {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  async function ask() {
    setPending(true);
    setMessage(null);
    const res = await connection.command<{ pending: boolean }>('team.requestJoin', {
      franchiseCode: code,
    });
    setPending(false);
    setMessage(
      res.ok
        ? {
            tone: 'info',
            text: res.data.pending
              ? 'Request sent. The captain decides.'
              : 'You joined the team as an advisor.',
          }
        : { tone: 'error', text: res.error.message },
    );
    connection.refresh();
  }
  return (
    <Surface aria-labelledby="late-join-heading" className="p-4">
      <h2 id="late-join-heading" className="text-lg font-semibold">
        Help a team
      </h2>
      <p className="mt-1 text-sm text-ink-2">
        You are watching. With a team’s code you can ask to join as an advisor — you can recommend
        players, but you cannot bid or win this game’s medal.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <TextField
            label="Team code"
            value={code}
            autoComplete="off"
            onChange={(e) => setCode(e.target.value)}
          />
        </div>
        <Button
          variant="secondary"
          size="touch"
          disabled={disabled || code.trim().length < 8}
          pending={pending}
          onClick={() => void ask()}
        >
          Ask to join
        </Button>
      </div>
      {message ? (
        <StatusMessage tone={message.tone} className="mt-3">
          {message.text}
        </StatusMessage>
      ) : null}
    </Surface>
  );
}
