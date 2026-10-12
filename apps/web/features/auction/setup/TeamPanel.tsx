'use client';

import { useState } from 'react';
import type { AuctionSetupSnapshot } from '@stumps/contracts';
import { Badge, Button, Surface } from '@stumps/ui';
import type { LobbyContext } from '@/features/room/components/MultiplayerLobby';
import { Crest } from './Crest';
import { formatRupees, fullRupees } from './money';
import { ROLE_LABELS, type useSetupActions } from './useSetup';

/**
 * S17 (basic, phase 09): the viewer's team with its join code, teammates and
 * pending join requests. Approved collaborators join as advisors; editing
 * capabilities and captain handover arrive in phase 11.
 */
export function TeamPanel({
  ctx,
  setup,
  actions,
}: {
  ctx: LobbyContext;
  setup: AuctionSetupSnapshot;
  actions: ReturnType<typeof useSetupActions>;
}) {
  const [copied, setCopied] = useState(false);
  const mine = setup.myTeam;
  if (!mine) return null;
  const team = setup.teams.find((t) => t.teamId === mine.teamId);
  const copy = async () => {
    if (!mine.joinCode) return;
    await navigator.clipboard.writeText(mine.joinCode).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };
  return (
    <Surface aria-labelledby="my-team-heading">
      <div className="flex flex-wrap items-center gap-3">
        {team ? (
          <Crest
            shortName={team.shortName}
            primaryHex={team.primaryHex}
            secondaryHex={team.secondaryHex}
            size="lg"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 id="my-team-heading" className="text-xl font-semibold">
            Your team{team ? `: ${team.name}` : ''}
          </h2>
          <p className="text-sm text-ink-2">
            You are {mine.role === 'advisor' ? 'an' : 'the'} {ROLE_LABELS[mine.role].toLowerCase()}.
            {team ? (
              <>
                {' '}
                Purse{' '}
                <span title={fullRupees(team.remainingPurseRupees)}>
                  {formatRupees(team.remainingPurseRupees)}
                </span>
                .
              </>
            ) : null}
          </p>
        </div>
      </div>

      {mine.joinCode ? (
        <div className="mt-4 rounded-lg border border-line p-3">
          <p className="text-sm text-ink-2">Team invitation code (not the room code)</p>
          <p className="font-mono text-xl tracking-wider tabular-nums">{mine.joinCode}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button size="touch" variant="secondary" onClick={() => void copy()}>
              Copy team code
            </Button>
            <span role="status" aria-live="polite" className="text-sm text-ok">
              {copied ? 'Team code copied' : ''}
            </span>
          </div>
          <p className="mt-2 text-xs text-ink-3">
            Teammates enter it after joining the room. You approve each request; a code never adds
            anyone by itself.
          </p>
        </div>
      ) : null}

      <h3 className="mt-5 text-sm font-semibold text-ink">
        Teammates ({mine.members.length} of {setup.collaboratorLimit})
      </h3>
      <ul className="mt-2 flex flex-col gap-2">
        {mine.members.map((m) => (
          <li key={m.memberId} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate">{m.displayName}</span>
            <Badge tone={m.role === 'captain' ? 'auction' : 'neutral'}>{ROLE_LABELS[m.role]}</Badge>
          </li>
        ))}
      </ul>

      {mine.role === 'captain' ? (
        <>
          <h3 className="mt-5 text-sm font-semibold text-ink">Join requests</h3>
          {mine.requests.length === 0 ? (
            <p className="mt-2 text-sm text-ink-3">No requests waiting.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-3" aria-live="polite">
              {mine.requests.map((r) => (
                <li
                  key={r.requestId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3"
                >
                  <span>
                    <span className="font-medium">{r.displayName}</span>
                    <span className="block text-xs text-ink-3">
                      Joins as an advisor: can see the team and recommend players, cannot bid.
                    </span>
                  </span>
                  <span className="flex gap-2">
                    <Button
                      size="touch"
                      variant="auction"
                      disabled={!ctx.canAct}
                      pending={actions.pending === `approve:${r.requestId}`}
                      aria-label={`Approve ${r.displayName}`}
                      onClick={() =>
                        void actions.run(`approve:${r.requestId}`, 'team.decideJoin', {
                          requestId: r.requestId,
                          approve: true,
                        })
                      }
                    >
                      Approve
                    </Button>
                    <Button
                      size="touch"
                      variant="secondary"
                      disabled={!ctx.canAct}
                      pending={actions.pending === `reject:${r.requestId}`}
                      aria-label={`Reject ${r.displayName}`}
                      onClick={() =>
                        void actions.run(`reject:${r.requestId}`, 'team.decideJoin', {
                          requestId: r.requestId,
                          approve: false,
                        })
                      }
                    >
                      Reject
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </Surface>
  );
}
