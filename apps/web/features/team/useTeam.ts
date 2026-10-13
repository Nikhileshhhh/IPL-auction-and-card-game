'use client';

import { useEffect, useState } from 'react';
import type { ApiError, TeamView } from '@stumps/contracts';
import { api } from '@/lib/api-client';
import { useRoom } from '@/features/room/useRoom';

/**
 * The viewer's own team (GET /rooms/:id/team), reloaded whenever the room
 * moves on (every command bumps the state version), plus a command runner
 * that refreshes the room snapshot after each outcome.
 */
export function useTeam(roomId: string) {
  const room = useRoom(roomId);
  const stateVersion = room.room?.snapshot.room.stateVersion ?? null;
  const [team, setTeam] = useState<TeamView | null>(null);
  const [missing, setMissing] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<{ action: string; error: ApiError } | null>(null);

  useEffect(() => {
    if (stateVersion === null) return;
    let live = true;
    void api<TeamView>(`/rooms/${roomId}/team`).then((res) => {
      if (!live) return;
      setMissing(!res.ok);
      if (res.ok) setTeam(res.data);
    });
    return () => {
      live = false;
    };
  }, [roomId, stateVersion]);

  async function run<T = unknown>(action: string, type: string, payload: Record<string, unknown>) {
    setPending(action);
    setError(null);
    const res = await room.connection.command<T>(type, payload);
    setPending(null);
    if (!res.ok) setError({ action, error: res.error });
    room.connection.refresh();
    return res;
  }

  const canAct =
    room.status === 'live' && Boolean(room.room?.snapshot.me.isController) && team !== null;
  return { ...room, team, missing, pending, error, run, canAct };
}

export const ROLE_LABELS = {
  captain: 'Captain',
  cocaptain: 'Co-captain',
  bidder: 'Bidder',
  advisor: 'Advisor',
} as const;
