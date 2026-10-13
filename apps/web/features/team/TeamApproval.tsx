'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ADVISOR_CAPABILITIES, type TeamCapabilities, type TeamView } from '@stumps/contracts';
import { Badge, Button, Skeleton, StatusMessage, Surface } from '@stumps/ui';
import { Crest } from '@/features/auction/setup/Crest';
import { LotClock } from '@/features/auction/stage/LotClock';
import { CAPABILITY_LABELS, CapabilityEditor, type DelegatedRole } from './CapabilityEditor';
import { ROLE_LABELS, useTeam } from './useTeam';

type Draft = { role: DelegatedRole; capabilities: TeamCapabilities };

function rightsSummary(c: TeamCapabilities) {
  const on = (Object.keys(CAPABILITY_LABELS) as (keyof TeamCapabilities)[])
    .filter((k) => c[k])
    .map((k) => CAPABILITY_LABELS[k].label);
  return on.length ? on.join(' · ') : 'View only';
}

/**
 * S17 team page: join requests with explicit rights, teammates and their
 * permissions, the captaincy offer, and the invitation code with the
 * friends-only auto-join list. Captains change things; everyone in the team
 * sees who can do what. Nobody outside the team can open it.
 */
export function TeamApproval({ roomId }: { roomId: string }) {
  const t = useTeam(roomId);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);

  if (t.missing) {
    return (
      <StatusMessage tone="info" title="You are not in a team here">
        Ask a captain for their team code, then request to join from the room.{' '}
        <Link href={`/rooms/${roomId}/lobby`} className="underline">
          Back to the room
        </Link>
      </StatusMessage>
    );
  }
  const team = t.team;
  if (!team || !t.room) {
    return (
      <div aria-busy="true" aria-label="Loading team" className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  const captain = team.myRole === 'captain';
  const back = team.lifecycle === 'LOBBY' ? `/rooms/${roomId}/lobby` : `/rooms/${roomId}/auction`;
  const nameOf = (id: string) => team.members.find((m) => m.memberId === id)?.displayName ?? '';
  const cocaptainTaken = (exceptId: string) =>
    team.members.some((m) => m.role === 'cocaptain' && m.memberId !== exceptId);
  const handover = team.pendingHandover;
  const allowed = (a: string) => team.myAllowedActions.includes(a) && t.canAct;
  const draftFor = (key: string, fallback: Draft) => drafts[key] ?? fallback;
  const setDraft = (key: string, d: Draft) => setDrafts((all) => ({ ...all, [key]: d }));

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <Crest
          shortName={team.shortName}
          primaryHex={team.primaryHex}
          secondaryHex={team.secondaryHex}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold">{team.name}</h1>
          <p className="text-sm text-ink-2">
            You are the {ROLE_LABELS[team.myRole].toLowerCase()} ·{' '}
            {rightsSummary(team.myCapabilities)}
          </p>
        </div>
        <nav aria-label="Team pages" className="flex gap-4 text-sm">
          <Link href={`/rooms/${roomId}/shortlist`} className="underline">
            Shortlist
          </Link>
          <Link href={back} className="underline">
            {team.lifecycle === 'LOBBY' ? 'Back to the lobby' : 'Back to the auction'}
          </Link>
        </nav>
      </header>

      {t.error ? (
        <StatusMessage tone="error" title="That did not work">
          {t.error.error.message}
        </StatusMessage>
      ) : null}

      {handover ? (
        <Surface aria-label="Captaincy offer" className="border-auction/60">
          {handover.toMemberId === team.myMemberId ? (
            <>
              <p className="font-semibold">
                {nameOf(handover.fromMemberId)} offers you the captaincy.
              </p>
              <p className="mt-1 text-sm text-ink-2">
                You would get every right; they become co-captain.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-4">
                <Button
                  variant="auction"
                  size="key"
                  disabled={!allowed('team.captain.accept')}
                  pending={t.pending === 'accept'}
                  onClick={() =>
                    void t.run('accept', 'team.captain.accept', {
                      handoverId: handover.handoverId,
                    })
                  }
                >
                  Accept the captaincy
                </Button>
                <div className="min-w-[200px] flex-1">
                  <LotClock
                    deadline={handover.expiresAt}
                    serverNow={t.room.snapshot.serverNow}
                    total={60}
                    label="Offer open for"
                  />
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm">
              Waiting for {nameOf(handover.toMemberId)} to accept the captaincy (one minute).
            </p>
          )}
        </Surface>
      ) : null}

      {captain ? (
        <Surface aria-labelledby="requests-heading">
          <h2 id="requests-heading" className="text-lg font-semibold">
            Join requests
          </h2>
          {team.requests.length === 0 ? (
            <p className="mt-2 text-sm text-ink-2">No requests waiting.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-4">
              {team.requests.map((r) => {
                const key = `req:${r.requestId}`;
                const d = draftFor(key, { role: 'advisor', capabilities: ADVISOR_CAPABILITIES });
                const late = team.lifecycle !== 'LOBBY';
                return (
                  <li key={r.requestId} className="rounded-lg border border-line p-4">
                    <p className="font-semibold">{r.displayName}</p>
                    <div className="mt-3">
                      <CapabilityEditor
                        role={late ? 'advisor' : d.role}
                        capabilities={late ? ADVISOR_CAPABILITIES : d.capabilities}
                        lateJoiner={late}
                        cocaptainTaken={cocaptainTaken('')}
                        onChange={(next) => setDraft(key, next)}
                      />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="auction"
                        size="touch"
                        disabled={!allowed('team.decideJoin')}
                        pending={t.pending === `approve:${r.requestId}`}
                        aria-label={`Approve ${r.displayName}`}
                        onClick={() =>
                          void t.run(`approve:${r.requestId}`, 'team.decideJoin', {
                            requestId: r.requestId,
                            approve: true,
                            role: late ? 'advisor' : d.role,
                            capabilities: late ? ADVISOR_CAPABILITIES : d.capabilities,
                          })
                        }
                      >
                        Approve
                      </Button>
                      <Button
                        variant="secondary"
                        size="touch"
                        disabled={!allowed('team.decideJoin')}
                        pending={t.pending === `reject:${r.requestId}`}
                        aria-label={`Reject ${r.displayName}`}
                        onClick={() =>
                          void t.run(`reject:${r.requestId}`, 'team.decideJoin', {
                            requestId: r.requestId,
                            approve: false,
                          })
                        }
                      >
                        Reject
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Surface>
      ) : null}

      <Surface aria-labelledby="members-heading">
        <h2 id="members-heading" className="text-lg font-semibold">
          Teammates ({team.members.length} of {team.collaboratorLimit})
        </h2>
        <ul className="mt-3 flex flex-col gap-3">
          {team.members.map((m) => {
            const key = `mem:${m.memberId}`;
            const d = draftFor(key, {
              role: m.role === 'captain' ? 'cocaptain' : m.role,
              capabilities: m.capabilities,
            });
            return (
              <li key={m.memberId} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={
                      m.online ? 'h-2 w-2 rounded-full bg-ok' : 'h-2 w-2 rounded-full bg-overlay'
                    }
                  />
                  <span className="font-semibold">
                    {m.displayName}
                    {m.memberId === team.myMemberId ? ' (you)' : ''}
                  </span>
                  <Badge tone={m.role === 'captain' ? 'auction' : 'neutral'}>
                    {ROLE_LABELS[m.role]}
                  </Badge>
                  {m.lateJoiner ? <Badge tone="warning">Joined late · no medal</Badge> : null}
                  <span className="sr-only">{m.online ? 'online' : 'offline'}</span>
                </div>
                <p className="mt-1 text-xs text-ink-3">{rightsSummary(m.capabilities)}</p>
                {captain && m.role !== 'captain' ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      size="touch"
                      variant="secondary"
                      onClick={() => setEditing(editing === m.memberId ? null : m.memberId)}
                      aria-expanded={editing === m.memberId}
                    >
                      {editing === m.memberId ? 'Close' : `Edit ${m.displayName}’s rights`}
                    </Button>
                    {!m.lateJoiner ? (
                      <Button
                        size="touch"
                        variant="tertiary"
                        disabled={!allowed('team.captain.propose')}
                        pending={t.pending === `propose:${m.memberId}`}
                        onClick={() =>
                          void t.run(`propose:${m.memberId}`, 'team.captain.propose', {
                            memberId: m.memberId,
                          })
                        }
                      >
                        Offer captaincy
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {editing === m.memberId ? (
                  <div className="mt-3 border-t border-line pt-3">
                    <CapabilityEditor
                      role={d.role}
                      capabilities={d.capabilities}
                      lateJoiner={m.lateJoiner}
                      cocaptainTaken={cocaptainTaken(m.memberId)}
                      onChange={(next) => setDraft(key, next)}
                    />
                    <Button
                      className="mt-3"
                      variant="auction"
                      size="touch"
                      disabled={!allowed('team.permissions')}
                      pending={t.pending === `perm:${m.memberId}`}
                      onClick={async () => {
                        const res = await t.run(`perm:${m.memberId}`, 'team.permissions', {
                          memberId: m.memberId,
                          role: d.role,
                          capabilities: d.capabilities,
                        });
                        if (res.ok) setEditing(null);
                      }}
                    >
                      Save rights
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Surface>

      <InvitePanel team={team} t={t} newCode={newCode} onRotated={setNewCode} />
    </div>
  );
}

function InvitePanel({
  team,
  t,
  newCode,
  onRotated,
}: {
  team: TeamView;
  t: ReturnType<typeof useTeam>;
  newCode: string | null;
  onRotated: (code: string) => void;
}) {
  const [friends, setFriends] = useState<Record<string, boolean>>({});
  if (!team.joinCode) return null;
  const captain = team.myRole === 'captain';
  const list = team.autoJoin ?? [];
  const chosen = (id: string, fallback: boolean) => friends[id] ?? fallback;
  return (
    <Surface aria-labelledby="invite-heading">
      <h2 id="invite-heading" className="text-lg font-semibold">
        Team invitation code
      </h2>
      <p className="mt-1 font-mono text-xl tracking-wider tabular-nums">
        {newCode ?? team.joinCode}
      </p>
      <p className="mt-1 text-xs text-ink-3">
        A code only sends you a request; you approve each one. A new code cancels requests that are
        still waiting.
      </p>
      {captain ? (
        <>
          {list.length > 0 ? (
            <fieldset className="mt-4">
              <legend className="text-sm font-semibold">Friends who join without a request</legend>
              <ul className="mt-2 flex flex-col gap-1">
                {list.map((f) => (
                  <li key={f.userId}>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={chosen(f.userId, f.enabled)}
                        onChange={(e) =>
                          setFriends((all) => ({ ...all, [f.userId]: e.target.checked }))
                        }
                      />
                      {f.displayName}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-ink-3">They join as advisors. Saving makes a new code.</p>
            </fieldset>
          ) : (
            <p className="mt-3 text-xs text-ink-3">
              Friends you add on your profile can be allowed to join without a request.
            </p>
          )}
          <Button
            className="mt-3"
            variant="secondary"
            size="touch"
            disabled={!t.canAct || !team.myAllowedActions.includes('team.invite.rotate')}
            pending={t.pending === 'rotate'}
            onClick={async () => {
              const res = await t.run<{ newCode: string }>('rotate', 'team.invite.rotate', {
                autoJoinUserIds: list
                  .filter((f) => chosen(f.userId, f.enabled))
                  .map((f) => f.userId),
              });
              if (res.ok) onRotated(res.data.newCode);
            }}
          >
            Make a new code
          </Button>
        </>
      ) : null}
    </Surface>
  );
}
