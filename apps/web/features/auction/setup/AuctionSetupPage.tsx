'use client';

import { MultiplayerLobby } from '@/features/room/components/MultiplayerLobby';
import { AuctionSetupView } from './AuctionSetupView';

/** Client entry for the auction setup pages (the lobby hands its live state to the view). */
export function AuctionSetupPage({
  roomId,
  screen,
  teamId = null,
}: {
  roomId: string;
  screen: 'franchises' | 'retentions' | 'auction-lobby' | 'squad';
  teamId?: string | null;
}) {
  return (
    <MultiplayerLobby roomId={roomId}>
      {(ctx) => <AuctionSetupView ctx={ctx} screen={screen} teamId={teamId} />}
    </MultiplayerLobby>
  );
}
