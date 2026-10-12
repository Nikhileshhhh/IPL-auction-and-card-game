'use client';

import { useState } from 'react';
import type { ApiError, AuctionSetupSnapshot } from '@stumps/contracts';
import type { LobbyContext } from '@/features/room/components/MultiplayerLobby';

/** The auction setup projection inside the room snapshot (null outside setup). */
export function setupOf(ctx: LobbyContext): AuctionSetupSnapshot | null {
  const game = ctx.room.snapshot.game as AuctionSetupSnapshot | null;
  return game?.kind === 'auction-setup' ? game : null;
}

/** Run a setup command; the confirmed snapshot is reloaded after every outcome. */
export function useSetupActions(ctx: LobbyContext) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ action: string; error: ApiError } | null>(null);
  async function run<T = unknown>(action: string, type: string, payload: Record<string, unknown>) {
    setPending(action);
    setError(null);
    const res = await ctx.connection.command<T>(type, payload);
    setPending(null);
    if (!res.ok) setError({ action, error: res.error });
    ctx.connection.refresh();
    return res;
  }
  return { pending, error, run, clear: () => setError(null) };
}

export const ROLE_LABELS = {
  captain: 'Captain',
  cocaptain: 'Co-captain',
  bidder: 'Bidder',
  advisor: 'Advisor',
} as const;

export const PLAYER_ROLE_LABELS = {
  batter: 'Batter',
  bowler: 'Bowler',
  all_rounder: 'All-rounder',
  wicketkeeper: 'Wicketkeeper',
} as const;
