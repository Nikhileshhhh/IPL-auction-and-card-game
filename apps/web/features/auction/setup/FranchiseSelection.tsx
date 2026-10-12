'use client';

import { useState, type FormEvent } from 'react';
import type { AuctionSetupSnapshot, PublicTeam } from '@stumps/contracts';
import { Badge, Button, StatusMessage, Surface, TextField } from '@stumps/ui';
import type { LobbyContext } from '@/features/room/components/MultiplayerLobby';
import { Crest } from './Crest';
import { formatRupees } from './money';
import { TeamPanel } from './TeamPanel';
import { useSetupActions } from './useSetup';

/**
 * S16 franchise selection: claim a free franchise (you become its captain) or
 * ask to join a claimed one with its team code. One team per person; the host
 * closes selection once at least two teams are claimed.
 */
export function FranchiseSelection({
  ctx,
  setup,
}: {
  ctx: LobbyContext;
  setup: AuctionSetupSnapshot;
}) {
  const actions = useSetupActions(ctx);
  const [code, setCode] = useState('');
  const can = (a: string) => setup.myAllowedActions.includes(a);
  const claimed = setup.teams.filter((t) => t.teamId);
  const full = claimed.length >= setup.franchiseLimit;
  const mineFirst = [...setup.teams].sort(
    (a, b) =>
      Number(b.teamId !== null && b.teamId === setup.myTeam?.teamId) -
      Number(a.teamId !== null && a.teamId === setup.myTeam?.teamId),
  );
  const requested = setup.teams.find(
    (t) => t.franchiseDefinitionId === setup.myRequest?.franchiseDefinitionId,
  );

  const requestJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim()) return;
    void actions.run('join', 'team.requestJoin', { franchiseCode: code.trim() }).then((res) => {
      if (res.ok) setCode('');
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <Surface aria-labelledby="franchises-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="franchises-heading" className="text-xl font-semibold">
            Choose a franchise
          </h2>
          <p className="text-sm text-ink-2">
            {claimed.length} of {setup.franchiseLimit} team places taken · up to{' '}
            {setup.collaboratorLimit} people per team
          </p>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          Claim a franchise to become its captain, with the real ₹120 crore purse and the right to
          retain players from its IPL 2026 squad. Already claimed? Ask its captain for the team
          code.
        </p>
        {requested ? (
          <StatusMessage tone="info" className="mt-4" title="Request sent">
            Waiting for the {requested.name} captain to approve you.
          </StatusMessage>
        ) : null}
        <ul className="mt-4 grid gap-3 sm:grid-cols-2" aria-live="polite">
          {mineFirst.map((t) => (
            <FranchiseCard
              key={t.franchiseDefinitionId}
              team={t}
              mine={t.teamId !== null && t.teamId === setup.myTeam?.teamId}
              collaboratorLimit={setup.collaboratorLimit}
              canClaim={can('auction.claimFranchise') && !t.teamId && !full && ctx.canAct}
              pending={actions.pending === `claim:${t.franchiseDefinitionId}`}
              onClaim={() =>
                void actions.run(`claim:${t.franchiseDefinitionId}`, 'auction.claimFranchise', {
                  franchiseDefinitionId: t.franchiseDefinitionId,
                })
              }
            />
          ))}
        </ul>
        {actions.error && actions.error.action.startsWith('claim') ? (
          <StatusMessage tone="error" className="mt-4">
            {actions.error.error.message}
          </StatusMessage>
        ) : null}
      </Surface>

      {setup.myTeam ? (
        <TeamPanel ctx={ctx} setup={setup} actions={actions} />
      ) : can('team.requestJoin') ? (
        <Surface aria-labelledby="join-team-heading">
          <h2 id="join-team-heading" className="text-lg font-semibold">
            Join a team
          </h2>
          <form onSubmit={requestJoin} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-[14rem] flex-1">
              <TextField
                label="Team invitation code"
                name="teamCode"
                autoComplete="off"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                hint="Different from the room code: the captain shares it with teammates."
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={!ctx.canAct}
              pending={actions.pending === 'join'}
            >
              Ask to join
            </Button>
          </form>
          {actions.error?.action === 'join' ? (
            <StatusMessage tone="error" className="mt-3">
              {actions.error.error.message}
            </StatusMessage>
          ) : null}
        </Surface>
      ) : null}

      {can('auction.franchiseSelection.close') ? (
        <Surface aria-labelledby="close-heading">
          <h2 id="close-heading" className="text-lg font-semibold">
            Host: close franchise selection
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            {setup.format === 'retention'
              ? 'Teams then decide their retentions. Franchises nobody claimed take no part; their players go into the auction without right-to-match cards.'
              : 'Fresh reset: everyone goes straight to the auction lobby with an empty squad.'}
          </p>
          <Button
            className="mt-4"
            variant="auction"
            disabled={!ctx.canAct || claimed.length < 2}
            pending={actions.pending === 'close'}
            onClick={() => void actions.run('close', 'auction.franchiseSelection.close', {})}
          >
            Close selection with {claimed.length} team{claimed.length === 1 ? '' : 's'}
          </Button>
          {claimed.length < 2 ? (
            <p className="mt-2 text-sm text-ink-3">At least two teams must be claimed.</p>
          ) : null}
          {actions.error?.action === 'close' ? (
            <StatusMessage tone="error" className="mt-3">
              {actions.error.error.message}
            </StatusMessage>
          ) : null}
        </Surface>
      ) : null}
    </div>
  );
}

function FranchiseCard({
  team,
  mine,
  collaboratorLimit,
  canClaim,
  pending,
  onClaim,
}: {
  team: PublicTeam;
  mine: boolean;
  collaboratorLimit: number;
  canClaim: boolean;
  pending: boolean;
  onClaim: () => void;
}) {
  return (
    <li
      className="flex flex-col gap-3 rounded-[var(--radius-panel-sm)] border p-4"
      style={{ borderColor: mine ? team.secondaryHex : undefined }}
    >
      <div className="flex items-center gap-3">
        <Crest
          shortName={team.shortName}
          primaryHex={team.primaryHex}
          secondaryHex={team.secondaryHex}
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">{team.name}</p>
          <p className="text-xs text-ink-2">
            {team.previousSquadCount} players from the 2026 squad
          </p>
        </div>
        {mine ? <Badge tone="auction">Your team</Badge> : null}
      </div>
      {team.teamId ? (
        <p className="text-sm text-ink-2">
          Captain {team.captain?.displayName} · {team.memberCount} of {collaboratorLimit} people ·
          purse {formatRupees(team.remainingPurseRupees)}
        </p>
      ) : (
        <p className="text-sm text-ink-3">Not claimed</p>
      )}
      {!team.teamId ? (
        <Button
          size="touch"
          variant="auction"
          disabled={!canClaim}
          pending={pending}
          onClick={onClaim}
          aria-label={`Claim ${team.name}`}
        >
          Claim {team.shortName}
        </Button>
      ) : null}
    </li>
  );
}
