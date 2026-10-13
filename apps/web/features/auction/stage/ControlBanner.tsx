'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { AuctionLiveSnapshot, AutoView } from '@stumps/contracts';
import { Button, StatusMessage } from '@stumps/ui';
import { api } from '@/lib/api-client';
import type { RoomConnection } from '@/features/room/connection';
import { MODE_LABELS, MODE_TEXT } from '@/features/team/auto/reasons';

/**
 * The viewer's team is not on plain manual control (S26 summary on the
 * stage): who is in control, and the explicit "Resume manual control". The
 * takeover is fenced by the control epoch the server reports right now.
 */
export function ControlBanner({
  live,
  roomId,
  connection,
  disabled,
}: {
  live: AuctionLiveSnapshot;
  roomId: string;
  connection: RoomConnection;
  disabled: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const team = live.teams.find((t) => t.teamId === live.myTeamId);
  if (!team || team.control === 'MANUAL') return null;
  const canResume = live.myAllowedActions.includes('team.auto.takeover');
  const teamId = team.teamId;

  async function resume() {
    setPending(true);
    setError(null);
    const view = await api<AutoView>(`/rooms/${roomId}/franchises/${teamId}/strategy`);
    if (!view.ok) {
      setPending(false);
      setError(view.error.message);
      return;
    }
    const res = await connection.command('team.auto.takeover', {
      currentEpoch: view.data.control.epoch,
    });
    setPending(false);
    if (!res.ok) setError(res.error.message);
    connection.refresh();
  }

  return (
    <StatusMessage tone="warning" title={MODE_LABELS[team.control]}>
      <span role="alert">{MODE_TEXT[team.control]}</span>{' '}
      <Link href={`/rooms/${roomId}/auto`} className="underline">
        See decisions and limits
      </Link>
      {canResume ? (
        <div className="mt-2">
          <Button
            variant="auction"
            size="touch"
            disabled={disabled}
            pending={pending}
            onClick={() => void resume()}
          >
            Resume manual control
          </Button>
        </div>
      ) : null}
      {error ? <span className="mt-1 block text-bad">{error}</span> : null}
    </StatusMessage>
  );
}
