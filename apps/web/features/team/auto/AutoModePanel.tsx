'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { AutoStrategyInput, AutoView, ShortlistView } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';
import {
  croreToRupees,
  formatRupees,
  fullRupees,
  rupeesToCrore,
} from '@/features/auction/setup/money';
import { PLAYER_ROLE_LABELS } from '@/features/auction/setup/useSetup';
import { useTeam } from '../useTeam';
import { MODE_LABELS, MODE_TEXT, reasonText } from './reasons';

type Role = keyof typeof PLAYER_ROLE_LABELS;
const ROLES = Object.keys(PLAYER_ROLE_LABELS) as Role[];

interface Draft {
  enabled: boolean;
  cap: string;
  purchases: string;
  reserve: string;
  roles: Record<Role, string>;
  allowRTM: boolean;
  rtmCeiling: string;
}

const crore = (r: string | undefined | null) => (r ? rupeesToCrore(r) : '');

function draftOf(view: AutoView): Draft {
  const s = view.strategy;
  return {
    enabled: s?.enabled ?? false,
    cap: crore(s?.totalAutoCapRupees) || '10',
    purchases: String(s?.maxAutoPurchases ?? 3),
    reserve: crore(s?.minReserveRupees) || '0',
    roles: Object.fromEntries(ROLES.map((r) => [r, crore(s?.roleLimits[r])])) as Record<
      Role,
      string
    >,
    allowRTM: s?.allowRTM ?? false,
    rtmCeiling: crore(s?.rtmCeilingRupees),
  };
}

/**
 * S26 automatic bidding: who controls the team now and why, the private
 * limits the bot keeps to, each automated decision with its reason, players
 * bought automatically, and the explicit "Resume manual control". Rules, not
 * artificial intelligence: a missing strategy means nothing is bid.
 */
export function AutoModePanel({ roomId }: { roomId: string }) {
  const t = useTeam(roomId);
  const [view, setView] = useState<AutoView | null>(null);
  const [shortlist, setShortlist] = useState<ShortlistView | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftVersion, setDraftVersion] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const teamId = t.team?.teamId;
  const stateVersion = t.room?.snapshot.room.stateVersion;

  useEffect(() => {
    if (!teamId || !stateVersion) return;
    let live = true;
    void Promise.all([
      api<AutoView>(`/rooms/${roomId}/franchises/${teamId}/strategy`),
      api<ShortlistView>(`/rooms/${roomId}/franchises/${teamId}/shortlist`),
    ]).then(([v, s]) => {
      if (!live) return;
      setFailed(!v.ok);
      if (v.ok) setView(v.data);
      if (s.ok) setShortlist(s.data);
    });
    return () => {
      live = false;
    };
  }, [roomId, teamId, stateVersion]);

  // A new saved version (or first load) resets the form to what the server holds.
  const version = view?.strategy?.version ?? '0';
  if (view && draftVersion !== version) {
    setDraftVersion(version);
    setDraft(draftOf(view));
  }

  if (t.missing) {
    return (
      <StatusMessage tone="info" title="Join a team first">
        Automatic bidding belongs to a team.{' '}
        <Link href={`/rooms/${roomId}/lobby`} className="underline">
          Back to the room
        </Link>
      </StatusMessage>
    );
  }
  if (failed) return <StatusMessage tone="error">This page could not be loaded.</StatusMessage>;
  if (!view || !draft || !t.team) return <Skeleton className="h-96 w-full" />;

  const mode = view.control.mode;
  const s = view.strategy;
  const targets = (shortlist?.entries ?? []).flatMap((e) =>
    e.maxPriceRupees ? [{ playerId: e.playerId, ceiling: e.maxPriceRupees }] : [],
  );
  const names = new Map((shortlist?.pool ?? []).map((p) => [p.playerId, p.name]));
  const back = view.lifecycle === 'LOBBY' ? `/rooms/${roomId}/lobby` : `/rooms/${roomId}/auction`;
  const fields = [draft.cap, draft.reserve, ...ROLES.map((r) => draft.roles[r]), draft.rtmCeiling];
  const invalid = fields.some((f) => f.trim() !== '' && croreToRupees(f) === null);
  const purchasesN = Number(draft.purchases);
  const badPurchases = !Number.isInteger(purchasesN) || purchasesN < 0 || purchasesN > 25;

  const save = () => {
    const strategy: AutoStrategyInput = {
      enabled: draft.enabled,
      targetLimits: targets.map((e) => ({ playerId: e.playerId, ceilingRupees: e.ceiling })),
      roleLimits: Object.fromEntries(
        ROLES.flatMap((r) => {
          const v = draft.roles[r].trim() ? croreToRupees(draft.roles[r]) : null;
          return v ? [[r, v]] : [];
        }),
      ),
      totalAutoCapRupees: croreToRupees(draft.cap) ?? '0',
      maxAutoPurchases: purchasesN,
      minReserveRupees: croreToRupees(draft.reserve) ?? '0',
      allowRTM: draft.allowRTM,
      rtmCeilingRupees: draft.allowRTM ? croreToRupees(draft.rtmCeiling) : null,
    };
    void t.run('save', 'team.auto.configure', { strategy, version });
  };

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t.team.name}: automatic bidding</h1>
          <p className="text-sm text-ink-2">
            Private to your team. It only acts when every bidder in your team has been away for 30
            seconds.
          </p>
        </div>
        <nav aria-label="Team pages" className="flex gap-4 text-sm">
          <Link href={`/rooms/${roomId}/shortlist`} className="underline">
            Shortlist
          </Link>
          <Link href={back} className="underline">
            {view.lifecycle === 'LOBBY' ? 'Back to the lobby' : 'Back to the auction'}
          </Link>
        </nav>
      </header>
      {t.error ? <StatusMessage tone="error">{t.error.error.message}</StatusMessage> : null}

      <Surface
        aria-labelledby="control-heading"
        className={mode === 'MANUAL' ? '' : 'border-warn/60'}
      >
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="control-heading" className="text-lg font-semibold">
            Control
          </h2>
          <Badge tone={mode === 'MANUAL' ? 'neutral' : 'warning'}>{MODE_LABELS[mode]}</Badge>
        </div>
        <p className="mt-2 text-sm" aria-live="polite">
          {MODE_TEXT[mode]}
        </p>
        {view.canTakeover ? (
          <Button
            className="mt-3"
            variant="auction"
            size="key"
            disabled={!t.canAct}
            pending={t.pending === 'takeover'}
            onClick={() =>
              void t.run('takeover', 'team.auto.takeover', { currentEpoch: view.control.epoch })
            }
          >
            Resume manual control
          </Button>
        ) : null}
      </Surface>

      <Surface aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="text-lg font-semibold">
          Limits
        </h2>
        {s ? (
          <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-3">Spent automatically</dt>
              <dd className="font-semibold tabular-nums" title={fullRupees(s.spentAutoRupees)}>
                {formatRupees(s.spentAutoRupees)} of {formatRupees(s.totalAutoCapRupees)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Bought automatically</dt>
              <dd className="font-semibold">
                {s.purchasesAuto} of {s.maxAutoPurchases}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">Always keep</dt>
              <dd className="font-semibold">{formatRupees(s.minReserveRupees)}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Purse now</dt>
              <dd className="font-semibold">{formatRupees(view.remainingPurseRupees)}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-ink-2">
            No limits saved: if everyone is away, your team only observes.
          </p>
        )}
        {view.canConfigure ? (
          <form
            className="mt-4 flex flex-col gap-4 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="flex min-h-11 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
              />
              Bid automatically while everyone is away
            </label>
            <div className="grid gap-3 sm:grid-cols-3">
              <TextField
                label="Total automatic spend (crore)"
                inputMode="decimal"
                value={draft.cap}
                onChange={(e) => setDraft({ ...draft, cap: e.target.value })}
              />
              <TextField
                label="Most players to buy"
                inputMode="numeric"
                value={draft.purchases}
                error={badPurchases ? 'A whole number from 0 to 25' : undefined}
                onChange={(e) => setDraft({ ...draft, purchases: e.target.value })}
              />
              <TextField
                label="Always keep (crore)"
                inputMode="decimal"
                value={draft.reserve}
                onChange={(e) => setDraft({ ...draft, reserve: e.target.value })}
              />
            </div>
            <fieldset>
              <legend className="text-sm font-semibold">
                Ceilings by role (crore, empty = none)
              </legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-4">
                {ROLES.map((r) => (
                  <TextField
                    key={r}
                    label={PLAYER_ROLE_LABELS[r]}
                    inputMode="decimal"
                    value={draft.roles[r]}
                    onChange={(e) =>
                      setDraft({ ...draft, roles: { ...draft.roles, [r]: e.target.value } })
                    }
                  />
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-3">
                A role ceiling applies only while the squad still needs that role.
              </p>
            </fieldset>
            <div>
              <p className="text-sm font-semibold">Named targets</p>
              {targets.length ? (
                <ul className="mt-1 text-sm">
                  {targets.map((e) => (
                    <li key={e.playerId}>
                      {names.get(e.playerId) ?? 'Player'} — up to {formatRupees(e.ceiling)}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-ink-2">None yet.</p>
              )}
              <p className="mt-1 text-xs text-ink-3">
                Targets are the shortlist players with a ceiling, in shortlist order.
              </p>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.allowRTM}
                  onChange={(e) => setDraft({ ...draft, allowRTM: e.target.checked })}
                />
                Use right-to-match cards
              </label>
              {draft.allowRTM ? (
                <TextField
                  label="Right-to-match ceiling (crore)"
                  inputMode="decimal"
                  value={draft.rtmCeiling}
                  onChange={(e) => setDraft({ ...draft, rtmCeiling: e.target.value })}
                />
              ) : null}
            </div>
            {invalid ? (
              <StatusMessage tone="error">Amounts are in crore, e.g. 4.5.</StatusMessage>
            ) : null}
            <Button
              type="submit"
              variant="auction"
              size="touch"
              className="self-start"
              disabled={
                !t.canAct || invalid || badPurchases || (draft.allowRTM && !draft.rtmCeiling)
              }
              pending={t.pending === 'save'}
            >
              Save limits
            </Button>
          </form>
        ) : view.strategy && mode !== 'MANUAL' ? (
          <p className="mt-3 text-xs text-ink-3">Resume manual control to change limits.</p>
        ) : null}
      </Surface>

      <Surface aria-labelledby="bought-heading">
        <h2 id="bought-heading" className="text-lg font-semibold">
          Bought automatically
        </h2>
        {view.autoPurchases.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">Nothing yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {view.autoPurchases.map((p) => (
              <li key={p.playerId} className="flex justify-between gap-3">
                <span>
                  #{p.lotNumber} {p.playerName}
                </span>
                <span className="tabular-nums">{formatRupees(p.priceRupees)}</span>
              </li>
            ))}
          </ul>
        )}
      </Surface>

      <Surface aria-labelledby="decisions-heading">
        <h2 id="decisions-heading" className="text-lg font-semibold">
          Automatic decisions
        </h2>
        {view.decisions.length === 0 ? (
          <p className="mt-2 text-sm text-ink-2">No automatic decisions.</p>
        ) : (
          <ol className="mt-2 flex flex-col gap-2 text-sm">
            {view.decisions.map((d) => (
              <li key={`${d.at}-${d.decision.nominationId}-${d.decision.action}`}>
                <span className="font-semibold">
                  #{d.decision.lotNumber} {d.decision.playerName}
                </span>{' '}
                ·{' '}
                {d.decision.action === 'BID' && d.decision.amountRupees
                  ? `bid ${formatRupees(d.decision.amountRupees)}`
                  : d.decision.action.toLowerCase().replace('_', ' ')}
                <span className="block text-xs text-ink-3">
                  {reasonText(d.reasonCode, d.ceiling)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Surface>
    </div>
  );
}
