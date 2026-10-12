'use client';

import { useMemo, useState } from 'react';
import type { AuctionPlayer, AuctionSetupSnapshot } from '@stumps/contracts';
import { Badge, Button, Dialog, StatusMessage, Surface } from '@stumps/ui';
import type { LobbyContext } from '@/features/room/components/MultiplayerLobby';
import { croreToRupees, formatRupees, fullRupees, rupeesToCrore } from './money';
import { PlayerLine } from './PlayerLine';
import { TeamPanel } from './TeamPanel';
import { useSetupActions } from './useSetup';

interface Pick {
  playerId: string;
  /** Negotiated salary in crore as typed. */
  salary: string;
}

/**
 * S18 retention management with the real IPL charge model (ADR-024): capped
 * retentions take the ₹18/14/11/18/14 crore slabs in order, uncapped ones at
 * least ₹4 crore; negotiated pay above the slab total is charged in full. The
 * captain proposes, the server prices and validates, then the captain locks.
 */
export function RetentionManager({
  ctx,
  setup,
}: {
  ctx: LobbyContext;
  setup: AuctionSetupSnapshot;
}) {
  const actions = useSetupActions(ctx);
  const mine = setup.myTeam;
  const pkg = mine?.package ?? null;
  const saved: Pick[] = useMemo(
    () =>
      (pkg?.lines ?? []).map((l) => ({
        playerId: l.playerId,
        salary: rupeesToCrore(l.salaryRupees),
      })),
    [pkg],
  );
  const [picks, setPicks] = useState<Pick[]>(saved);
  const [confirm, setConfirm] = useState(false);
  // A newly saved or locked package replaces local edits (derived-state reset during render).
  const savedKey = pkg ? `${pkg.packageId}:${pkg.version}:${pkg.status}` : 'none';
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setPicks(saved);
  }

  if (!mine) {
    return (
      <StatusMessage tone="info" title="Teams are deciding their retentions">
        You are not in a team, so you watch this auction. The lobby opens when every team has locked
        its retentions.
      </StatusMessage>
    );
  }
  const team = setup.teams.find((t) => t.teamId === mine.teamId);
  const locked = pkg?.status === 'locked';
  const canPropose = setup.myAllowedActions.includes('auction.retention.propose');
  const isCaptain = mine.role === 'captain';
  const byId = new Map(mine.eligible.map((p) => [p.playerId, p]));
  const dirty = JSON.stringify(picks) !== JSON.stringify(saved);
  const counts = {
    capped: picks.filter((p) => byId.get(p.playerId)?.cappedStatus === 'capped').length,
    uncapped: picks.filter((p) => byId.get(p.playerId)?.cappedStatus === 'uncapped').length,
  };
  const r = setup.rules;
  const toggle = (player: AuctionPlayer) =>
    setPicks((list) =>
      list.some((p) => p.playerId === player.playerId)
        ? list.filter((p) => p.playerId !== player.playerId)
        : [
            ...list,
            {
              playerId: player.playerId,
              salary: player.currentSalaryRupees ? rupeesToCrore(player.currentSalaryRupees) : '0',
            },
          ],
    );
  const invalidSalary = picks.some((p) => croreToRupees(p.salary) === null);
  const propose = () =>
    void actions.run('propose', 'auction.retention.propose', {
      playersAndAllocations: picks.map((p) => ({
        playerId: p.playerId,
        salaryRupees: croreToRupees(p.salary) ?? '0',
      })),
    });
  const problems =
    (
      actions.error?.error.details as
        { problems?: { message: string; playerId?: string }[] } | undefined
    )?.problems ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Surface aria-labelledby="retention-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="retention-heading" className="text-xl font-semibold">
            Retentions{team ? ` · ${team.name}` : ''}
          </h2>
          <Badge tone={locked ? 'auction' : 'neutral'}>
            {locked ? 'Locked' : pkg ? `Draft v${pkg.version}` : 'Nothing proposed yet'}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-ink-2">
          Keep up to {r.retentionMax} players from your 2026 squad: at most {r.retentionCappedMax}{' '}
          capped and {r.retentionUncappedMax} uncapped. Places you do not use become right-to-match
          cards in the auction. Charges follow the real IPL rules: capped players take the{' '}
          {r.cappedSlabsRupees.map((s) => formatRupees(s).replace('₹', '')).join(' / ')} slabs in
          the order you pick them, uncapped players at least {formatRupees(r.uncappedFloorRupees)}.
        </p>
        <p className="mt-2 text-sm text-ink-2">
          Selected: {picks.length} of {r.retentionMax} · {counts.capped} capped · {counts.uncapped}{' '}
          uncapped
        </p>

        <ol className="mt-4 flex flex-col gap-3" aria-label="Players you retain, in order">
          {picks.map((p, i) => {
            const player = byId.get(p.playerId);
            const line = pkg?.lines.find((l) => l.playerId === p.playerId);
            if (!player) return null;
            return (
              <li
                key={p.playerId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-auction/50 p-3"
              >
                <span className="w-6 text-center font-display text-lg font-bold">{i + 1}</span>
                <PlayerLine player={player} />
                <label className="flex items-center gap-2 text-sm">
                  Salary ₹
                  <input
                    className="min-h-11 w-20 rounded-[var(--radius-control)] border border-control bg-midnight px-2 tabular-nums"
                    inputMode="decimal"
                    value={p.salary}
                    disabled={locked || !canPropose}
                    aria-label={`Negotiated salary for ${player.name}, in crore`}
                    onChange={(e) =>
                      setPicks((list) =>
                        list.map((x) =>
                          x.playerId === p.playerId ? { ...x, salary: e.target.value } : x,
                        ),
                      )
                    }
                  />
                  cr
                </label>
                {line && !dirty ? (
                  <span className="text-xs text-ink-2">
                    Slab {formatRupees(line.slabFloorRupees)} · charged{' '}
                    <span title={fullRupees(line.allocatedRupees)}>
                      {formatRupees(line.allocatedRupees)}
                    </span>
                  </span>
                ) : null}
                {!locked && canPropose ? (
                  <Button
                    size="touch"
                    variant="tertiary"
                    onClick={() => toggle(player)}
                    aria-label={`Remove ${player.name}`}
                  >
                    Remove
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ol>

        {pkg && !dirty ? (
          <dl className="mt-5 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-lg border border-line p-4 text-sm">
            <dt className="text-ink-2">Capped slabs</dt>
            <dd className="text-right tabular-nums">{formatRupees(pkg.cappedFloorsRupees)}</dd>
            <dt className="text-ink-2">Capped salaries agreed</dt>
            <dd className="text-right tabular-nums">{formatRupees(pkg.cappedNegotiatedRupees)}</dd>
            <dt className="font-semibold text-ink">Charged to the purse</dt>
            <dd
              className="text-right font-semibold tabular-nums"
              title={fullRupees(pkg.totalChargeRupees)}
            >
              {formatRupees(pkg.totalChargeRupees)}
            </dd>
            <dt className="font-semibold text-ink">Purse for the auction</dt>
            <dd
              className="text-right font-semibold tabular-nums"
              title={fullRupees(pkg.remainingPurseRupees)}
            >
              {formatRupees(pkg.remainingPurseRupees)}
            </dd>
            <dt className="text-ink-2">Right-to-match cards</dt>
            <dd className="text-right tabular-nums">
              {pkg.rtmCards.total} ({pkg.rtmCards.capped} capped, {pkg.rtmCards.uncapped} uncapped)
            </dd>
          </dl>
        ) : (
          <p className="mt-4 text-sm text-ink-3">
            {dirty
              ? 'Unsaved changes. Save to see the exact charge.'
              : 'Save a proposal to see the charge.'}
          </p>
        )}

        {actions.error ? (
          <StatusMessage tone="error" className="mt-4" title={actions.error.error.message}>
            {problems.length > 1 ? (
              <ul className="list-disc pl-5">
                {problems.map((p) => (
                  <li key={`${p.playerId ?? ''}${p.message}`}>
                    {p.playerId ? `${byId.get(p.playerId)?.name ?? 'Player'}: ` : ''}
                    {p.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </StatusMessage>
        ) : null}

        {!locked ? (
          <div className="mt-5 flex flex-wrap gap-3">
            {canPropose ? (
              <Button
                variant="secondary"
                disabled={!ctx.canAct || invalidSalary || picks.length > r.retentionMax}
                pending={actions.pending === 'propose'}
                onClick={propose}
              >
                {picks.length === 0 ? 'Keep nobody' : 'Save proposal'}
              </Button>
            ) : null}
            {isCaptain ? (
              <Button
                variant="auction"
                disabled={!ctx.canAct || !pkg || dirty}
                onClick={() => setConfirm(true)}
              >
                Lock retentions
              </Button>
            ) : (
              <p className="text-sm text-ink-3">Only your captain can lock the retentions.</p>
            )}
          </div>
        ) : (
          <StatusMessage tone="success" className="mt-5" title="Retentions locked">
            Waiting for the other teams. The auction lobby opens when every team has locked.
          </StatusMessage>
        )}
      </Surface>

      {!locked ? (
        <Surface aria-labelledby="eligible-heading">
          <h2 id="eligible-heading" className="text-lg font-semibold">
            Your 2026 squad ({mine.eligible.length})
          </h2>
          <ul className="mt-3 flex flex-col gap-2">
            {mine.eligible.map((player) => {
              const chosen = picks.some((p) => p.playerId === player.playerId);
              return (
                <li
                  key={player.playerId}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-3"
                >
                  <PlayerLine player={player} />
                  <Button
                    size="touch"
                    variant={chosen ? 'tertiary' : 'secondary'}
                    aria-pressed={chosen}
                    disabled={
                      !canPropose ||
                      player.cappedStatus === 'unknown' ||
                      (!chosen && picks.length >= r.retentionMax)
                    }
                    onClick={() => toggle(player)}
                    aria-label={`${chosen ? 'Unselect' : 'Retain'} ${player.name}`}
                  >
                    {chosen ? 'Selected' : 'Retain'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Surface>
      ) : null}

      <TeamPanel ctx={ctx} setup={setup} actions={actions} />

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Lock retentions?"
        description="Locking is final. The charge comes off your purse and these players join your squad before the auction."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="auction"
              pending={actions.pending === 'lock'}
              onClick={() => {
                if (!pkg) return;
                void actions
                  .run('lock', 'auction.retention.lock', {
                    packageId: pkg.packageId,
                    version: pkg.version,
                  })
                  .then(() => setConfirm(false));
              }}
            >
              Lock for {pkg ? formatRupees(pkg.totalChargeRupees) : ''}
            </Button>
          </>
        }
      >
        {pkg ? (
          <p className="text-sm text-ink-2">
            {pkg.lines.length} player{pkg.lines.length === 1 ? '' : 's'} retained · purse left{' '}
            {formatRupees(pkg.remainingPurseRupees)} · {pkg.rtmCards.total} right-to-match card
            {pkg.rtmCards.total === 1 ? '' : 's'}.
          </p>
        ) : null}
      </Dialog>
    </div>
  );
}
