'use client';

import { useEffect, useState } from 'react';
import type { SquadDTO } from '@stumps/contracts';
import { Badge, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { Crest } from './Crest';
import { formatRupees, fullRupees } from './money';
import { PlayerLine } from './PlayerLine';
import { PLAYER_ROLE_LABELS } from './useSetup';

const ROLE_ORDER = ['batter', 'wicketkeeper', 'all_rounder', 'bowler'] as const;

/**
 * S22 squad view: a team's players by role with what each cost, the purse,
 * the reserve kept for the minimum squad and plain-language gaps. Any room
 * member may look at any team; strategy is never shown here.
 */
export interface SquadTeam {
  teamId: string;
  name: string;
  shortName: string;
  primaryHex: string;
  secondaryHex: string;
}

export function SquadView({
  roomId,
  stateVersion,
  teams,
  rules,
  teamId,
}: {
  roomId: string;
  /** Reloads the squad whenever the room moves on. */
  stateVersion: string;
  teams: readonly SquadTeam[];
  rules: { squadMin: number; squadMax: number; overseasMax: number };
  teamId: string | null;
}) {
  const target = teamId ?? teams[0]?.teamId ?? null;
  const team = teams.find((t) => t.teamId === target);
  const [squad, setSquad] = useState<SquadDTO | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!target) return;
    let live = true;
    void api<SquadDTO>(`/rooms/${roomId}/franchises/${target}/squad`).then((res) => {
      if (!live) return;
      setFailed(!res.ok);
      if (res.ok) setSquad(res.data);
    });
    return () => {
      live = false;
    };
  }, [roomId, target, stateVersion]);

  if (!target || !team) {
    return <StatusMessage tone="info">No team has been claimed yet.</StatusMessage>;
  }
  if (failed) return <StatusMessage tone="error">This squad could not be loaded.</StatusMessage>;
  if (!squad) return <Skeleton className="h-64 w-full" />;
  return (
    <div className="flex flex-col gap-6">
      <Surface aria-labelledby="squad-heading">
        <div className="flex flex-wrap items-center gap-3">
          <Crest
            shortName={team.shortName}
            primaryHex={team.primaryHex}
            secondaryHex={team.secondaryHex}
            size="lg"
          />
          <h2 id="squad-heading" className="flex-1 text-xl font-semibold">
            {team.name} squad
          </h2>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-ink-3">Purse left</dt>
            <dd
              className="font-semibold tabular-nums"
              title={fullRupees(squad.remainingPurseRupees)}
            >
              {formatRupees(squad.remainingPurseRupees)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Kept for minimum squad</dt>
            <dd className="font-semibold tabular-nums" title={fullRupees(squad.reserveRupees)}>
              {formatRupees(squad.reserveRupees)}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Players</dt>
            <dd className="font-semibold">
              {squad.rosterCount} of {rules.squadMin}–{rules.squadMax}
            </dd>
          </div>
          <div>
            <dt className="text-ink-3">Overseas</dt>
            <dd className="font-semibold">
              {squad.overseasCount} of {rules.overseasMax}
            </dd>
          </div>
        </dl>
        {squad.deficits.length > 0 ? (
          <ul className="mt-4 flex flex-wrap gap-2" aria-label="Squad needs">
            {squad.deficits.map((d) => (
              <li key={d}>
                <Badge tone="warning">{d}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </Surface>

      {ROLE_ORDER.map((role) => {
        const players = squad.acquisitions.filter((a) => a.player.role === role);
        if (players.length === 0) return null;
        return (
          <Surface key={role} aria-label={`${PLAYER_ROLE_LABELS[role]}s`}>
            <h3 className="text-lg font-semibold">
              {PLAYER_ROLE_LABELS[role]}s ({players.length})
            </h3>
            <ul className="mt-3 flex flex-col gap-2">
              {players.map((a) => (
                <li
                  key={a.player.playerId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
                >
                  <PlayerLine player={a.player}>
                    <span className="text-right text-sm">
                      <span
                        className="block font-semibold tabular-nums"
                        title={fullRupees(a.costRupees)}
                      >
                        {formatRupees(a.costRupees)}
                      </span>
                      <span className="text-xs text-ink-3">
                        {a.kind === 'retention'
                          ? 'Retained'
                          : a.kind === 'rtm'
                            ? 'Right to match'
                            : 'Bought'}
                      </span>
                    </span>
                  </PlayerLine>
                </li>
              ))}
            </ul>
          </Surface>
        );
      })}
      {squad.acquisitions.length === 0 ? (
        <StatusMessage tone="info">
          No players yet. This team needs {rules.squadMin} players, up to {rules.overseasMax} from
          overseas.
        </StatusMessage>
      ) : null}
    </div>
  );
}
