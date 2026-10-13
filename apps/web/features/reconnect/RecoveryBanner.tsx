'use client';

import { StatusMessage } from '@stumps/ui';
import { LotClock } from '@/features/auction/stage/LotClock';

/**
 * S35 recovery pause: after a server restart the game clocks were frozen at
 * the time they had left, and play resumes after a visible countdown. Nothing
 * is decided while it runs; offline time is never shown as a lost game.
 */
export function RecoveryBanner({
  recoveryUntil,
  serverNow,
}: {
  recoveryUntil: string | null;
  serverNow: string;
}) {
  if (!recoveryUntil || new Date(recoveryUntil).getTime() <= new Date(serverNow).getTime()) {
    return null;
  }
  return (
    <StatusMessage tone="warning" title="The server restarted — the game is paused">
      Every clock kept the time it had left. Reconnect if you need to; play resumes after the
      countdown.
      <div className="mt-2">
        <LotClock deadline={recoveryUntil} serverNow={serverNow} total={10} label="Resuming in" />
      </div>
    </StatusMessage>
  );
}
