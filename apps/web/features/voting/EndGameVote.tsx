'use client';

import { useEffect, useState } from 'react';
import type { PermittedSnapshotDTO, VoteChoice } from '@stumps/contracts';
import { Button, Dialog, StatusMessage } from '@stumps/ui';
import type { LinkStatus, RoomConnection } from '@/features/room/connection';
import { useServerNow } from '@/features/cards/arena/useServerClock';

const CHOICE_LABEL: Record<VoteChoice, string> = {
  end: 'End the game',
  continue: 'Keep playing',
};

/**
 * S28 end-game vote. The host asks; everyone entitled to vote (each card
 * player still in, or one representative per franchise) gets exactly 15
 * seconds by the server clock. No running tally is shown; the game ends only
 * with a strict majority of everyone entitled, and the host's own vote is
 * never assumed. Closing the sheet leaves a banner; play stays frozen.
 */
export function EndGameVote({
  snapshot,
  connection,
  status,
}: {
  snapshot: PermittedSnapshotDTO;
  connection: RoomConnection;
  status: LinkStatus;
}) {
  const vote = snapshot.openVote;
  const isHost = snapshot.room.hostMemberId === snapshot.me.memberId;
  const running = snapshot.room.lifecycle === 'RUNNING';
  const now = useServerNow(snapshot.serverNow);
  const [confirming, setConfirming] = useState(false);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [pending, setPending] = useState<VoteChoice | 'start' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);

  // The outcome of a vote, announced once (the snapshot then shows the game).
  useEffect(
    () =>
      connection.listen((event) => {
        if (event.type !== 'vote.resolved') return;
        const p = event.payload as { passed?: boolean; yes?: number };
        setOutcome(
          p.passed
            ? 'The room voted to end the game.'
            : `Majority not reached (${p.yes ?? 0} to end). Play resumes with the time it had left.`,
        );
      }),
    [connection],
  );

  const left = vote ? Math.max(0, Math.ceil((new Date(vote.expiresAt).getTime() - now) / 1000)) : 0;
  const milestone =
    left === 0
      ? 'Voting closed.'
      : left <= 5
        ? '5 seconds left.'
        : left <= 10
          ? '10 seconds left.'
          : '';

  async function start() {
    setPending('start');
    setError(null);
    const res = await connection.command('vote.start', {});
    setPending(null);
    setConfirming(false);
    if (!res.ok) setError(res.error.message);
  }

  async function cast(choice: VoteChoice) {
    if (!vote) return;
    setPending(choice);
    setError(null);
    const res = await connection.command('vote.cast', { voteId: vote.id, choice });
    setPending(null);
    if (!res.ok) setError(res.error.message);
  }

  const offline = status !== 'live';
  return (
    <>
      {isHost && running && !vote ? (
        <Button size="touch" variant="secondary" onClick={() => setConfirming(true)}>
          End game early
        </Button>
      ) : null}

      {vote && closedFor === vote.id ? (
        <button
          type="button"
          onClick={() => setClosedFor(null)}
          className="min-h-11 rounded-lg border border-warn/60 bg-[#2d2412] px-3 text-sm font-semibold"
        >
          Vote to end the game · {left}s · Open
        </button>
      ) : null}

      {outcome ? (
        <div className="fixed inset-x-4 bottom-4 z-50 sm:left-auto sm:max-w-sm">
          <StatusMessage tone="info" title="Vote result">
            {outcome}{' '}
            <button type="button" className="underline" onClick={() => setOutcome(null)}>
              Dismiss
            </button>
          </StatusMessage>
        </div>
      ) : null}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Ask everyone to end the game?"
        description="Play pauses for exactly 15 seconds while everyone still in the game votes. It ends only if more than half of them choose to end; otherwise play resumes with the time it had left. Your own vote is not counted automatically."
        footer={
          <>
            <Button size="touch" variant="tertiary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              size="touch"
              disabled={pending === 'start' || offline}
              onClick={() => void start()}
            >
              {pending === 'start' ? 'Starting…' : 'Start the vote'}
            </Button>
          </>
        }
      >
        {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      </Dialog>

      {vote ? (
        <Dialog
          open={closedFor !== vote.id}
          onOpenChange={(open) => (open ? setClosedFor(null) : setClosedFor(vote.id))}
          title="End the game now?"
          description={`${vote.threshold} of ${vote.electorateCount} must choose to end. Paused: ${vote.savedPhaseLabel}.`}
        >
          <div className="flex flex-col gap-4">
            <p className="font-display text-4xl font-bold tabular-nums" aria-hidden="true">
              {left}s
            </p>
            <p className="sr-only" aria-live="polite">
              {milestone}
            </p>
            {vote.myRecordedChoice ? (
              <StatusMessage tone="success" title="Your vote is recorded">
                {CHOICE_LABEL[vote.myRecordedChoice]}. The result is shown when time is up.
              </StatusMessage>
            ) : vote.canVote ? (
              <div className="grid grid-cols-2 gap-3">
                {(['end', 'continue'] as const).map((c) => (
                  <Button
                    key={c}
                    size="touch"
                    variant="secondary"
                    disabled={pending !== null || left === 0 || offline}
                    onClick={() => void cast(c)}
                  >
                    {pending === c ? 'Sending…' : CHOICE_LABEL[c]}
                  </Button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-2">
                {vote.representativeMemberId && vote.representativeMemberId !== snapshot.me.memberId
                  ? `${snapshot.room.members.find((m) => m.id === vote.representativeMemberId)?.displayName ?? 'Your team’s representative'} votes for your team.`
                  : 'You are watching this vote.'}
              </p>
            )}
            {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
            <p className="text-xs text-ink-3">
              Not voting counts as not ending. Chat stays open; play is frozen until the result.
            </p>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
