'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { ResultDTO } from '@stumps/contracts';
import { Badge, Skeleton, StatusMessage, Surface, cx } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { useRoom } from '@/features/room/useRoom';
import { useServerNow } from '@/features/cards/arena/useServerClock';
import { PortraitImage } from '@/components/cards/PortraitImage';

type Ranking = ResultDTO['rankings'][number];
type Report = NonNullable<ResultDTO['publicScoreReports']>[number];

const REASONS: Record<ResultDTO['completionReason'], string> = {
  natural: 'Played to the finish',
  cycle: 'Ended by the repeat-position rule',
  contest_cap: 'Ended at the contest limit',
  time_limit: 'Time limit',
  vote: 'Ended by vote',
  pool_complete: 'Every player came up',
  no_buyers: 'No team could buy any more players',
};

const MEDAL_TEXT = { gold: 'Gold', silver: 'Silver', bronze: 'Bronze' } as const;
const MEDAL_STYLE = {
  gold: 'border-[#ffd36b]/70 bg-[#ffd36b]/10',
  silver: 'border-[#cfd8dc]/70 bg-[#cfd8dc]/10',
  bronze: 'border-[#d7a17a]/70 bg-[#d7a17a]/10',
} as const;
const NO_CREDIT = {
  late_join: 'joined after the start',
  not_ready: 'not ready at the start',
  low_presence: 'present less than half the time',
} as const;
const COMPONENTS: [keyof NonNullable<Report['components']>, string, string][] = [
  ['batting', 'Batting', '30%'],
  ['bowling', 'Bowling', '30%'],
  ['allRound', 'All-round and keeping', '10%'],
  ['composition', 'Team balance', '15%'],
  ['depth', 'Bench depth', '10%'],
  ['value', 'Value for money', '5%'],
];

function medalLabel(r: Ranking, team: boolean) {
  if (!r.medal) return null;
  return `${team ? 'Team ' : ''}${MEDAL_TEXT[r.medal].toLowerCase()}`;
}

/**
 * S13 card results and S27 auction results. Everything here is computed by
 * the server; the page shows the podium, why each competitor placed where
 * they did, the viewer's own credit, and the fairness audit, until the
 * temporary results expire (medals stay on profiles).
 */
export function ResultsPage({ roomId }: { roomId: string }) {
  const { room, status } = useRoom(roomId);
  const snap = room?.snapshot;
  const [result, setResult] = useState<ResultDTO | null>(null);
  const [problem, setProblem] = useState<'expired' | 'missing' | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const ready = snap?.results?.status === 'ready';

  useEffect(() => {
    if (!ready || result) return;
    void api<ResultDTO>(`/rooms/${roomId}/results`).then((res) => {
      if (res.ok) setResult(res.data);
      else setProblem(res.status === 410 ? 'expired' : 'missing');
    });
  }, [ready, result, roomId]);
  useEffect(() => {
    if (result) heading.current?.focus();
  }, [result]);

  const now = useServerNow(snap?.serverNow ?? new Date(0).toISOString());
  const expired =
    problem === 'expired' ||
    snap?.results?.status === 'expired' ||
    (result ? new Date(result.resultsExpiresAt).getTime() <= now : false);

  if (status === 'unavailable' || status === 'removed' || status === 'closed' || expired) {
    return (
      <StatusMessage tone="info" title="Detailed match results expired">
        Medals you earned stay on your profile.{' '}
        <Link href="/play" className="underline">
          Back to play
        </Link>
      </StatusMessage>
    );
  }
  if (snap?.results?.status === 'finalizing') {
    return (
      <Surface aria-labelledby="evaluating-heading">
        <h1 id="evaluating-heading" className="font-display text-2xl font-semibold">
          Working out the results
        </h1>
        <p className="mt-2 text-ink-2">
          Every squad&apos;s best legal XI is being found exactly. No medal is shown until this
          finishes.
        </p>
        <div
          role="progressbar"
          aria-label="Evaluation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={snap.results.progressPercent}
          className="mt-4 h-3 w-full overflow-hidden rounded-full bg-overlay"
        >
          <div
            className="h-full bg-auction transition-[width]"
            style={{ width: `${snap.results.progressPercent}%` }}
          />
        </div>
        <p className="mt-2 text-sm tabular-nums">{snap.results.progressPercent}%</p>
      </Surface>
    );
  }
  if (problem === 'missing' || (snap && !snap.results)) {
    return (
      <StatusMessage tone="info" title="No results yet">
        This game has not finished.{' '}
        <Link href={`/rooms/${roomId}/lobby`} className="underline">
          Back to the room
        </Link>
      </StatusMessage>
    );
  }
  if (!result) {
    return (
      <div aria-busy="true" aria-label="Loading results" className="flex flex-col gap-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const team = result.gameType === 'auction';
  const podium = result.rankings.filter((r) => r.medal).slice(0, 3);
  const secondsLeft = Math.max(
    0,
    Math.ceil((new Date(result.resultsExpiresAt).getTime() - now) / 1000),
  );
  const myCredit = result.ownCredits[0];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1
          ref={heading}
          tabIndex={-1}
          className="font-display text-[32px] leading-[38px] font-semibold outline-none"
        >
          {team ? 'Auction results' : 'Match results'}
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={team ? 'auction' : 'card'}>{REASONS[result.completionReason]}</Badge>
          {result.qualificationStatus === 'practice' ? (
            <Badge tone="warning">Practice game — no medals</Badge>
          ) : result.qualificationStatus === 'no_champion' ? (
            <Badge tone="warning">No qualifying champion</Badge>
          ) : (
            <Badge>Qualifying game</Badge>
          )}
        </div>
        {result.qualificationStatus === 'practice' ? (
          <p className="text-sm text-ink-2">
            Medals need at least two competitors and five decided{' '}
            {team ? 'lots (sold or unsold)' : 'contests'}.
          </p>
        ) : null}
        {result.qualificationStatus === 'no_champion' ? (
          <p className="text-sm text-ink-2">
            No squad met the squad rules, so nobody takes a medal. What each one lacked is listed
            below.
          </p>
        ) : null}
      </header>

      <Surface aria-labelledby="own-credit">
        <h2 id="own-credit" className="text-lg font-semibold">
          Your result
        </h2>
        <p className="mt-1 text-ink-2">
          {myCredit
            ? myCredit.medal
              ? `${myCredit.scope === 'franchise' ? 'Team ' : ''}${MEDAL_TEXT[myCredit.medal].toLowerCase()} — added to your profile${myCredit.scope === 'franchise' ? ` (credited as ${myCredit.creditedRole})` : ''}.`
              : `Rank ${myCredit.rank} — a qualifying game on your profile, no medal.`
            : 'No medal or qualifying game credited to you this time.'}
        </p>
      </Surface>

      {podium.length ? (
        <section aria-labelledby="podium-heading">
          <h2 id="podium-heading" className="sr-only">
            Podium
          </h2>
          <ol className="grid gap-3 sm:grid-cols-3">
            {podium.map((r) => (
              <li
                key={r.competitorId}
                className={cx('rounded-xl border p-4', MEDAL_STYLE[r.medal ?? 'gold'])}
              >
                <p className="text-sm font-semibold uppercase">{medalLabel(r, team)}</p>
                <p className="mt-1 text-xl font-bold break-words">{r.displayName}</p>
                <p className="text-sm text-ink-2">{r.summary}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <Surface aria-labelledby="ranking-heading">
        <h2 id="ranking-heading" className="text-lg font-semibold">
          Final ranking
        </h2>
        <ol className="mt-3 flex flex-col gap-2">
          {result.rankings.map((r) => (
            <li key={r.competitorId} className="rounded-lg border border-line px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">
                  {r.rank}. {r.displayName}
                </span>
                <span className="text-sm text-ink-2">
                  {medalLabel(r, team) ??
                    (r.eligible
                      ? 'No medal'
                      : team
                        ? 'Ineligible squad'
                        : 'Not eligible for a medal')}
                </span>
              </div>
              <p className="text-sm text-ink-2">{r.summary}</p>
              {r.members ? (
                <ul className="mt-1 flex flex-wrap gap-x-4 text-xs text-ink-3">
                  {r.members.map((m) => (
                    <li key={m.memberId}>
                      {m.displayName} ({m.role})
                      {m.credited
                        ? ''
                        : ` — no credit: ${m.reason ? NO_CREDIT[m.reason] : 'ineligible'}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Surface>

      {result.publicScoreReports ? (
        <ScoreReports reports={result.publicScoreReports} rankings={result.rankings} />
      ) : null}

      {result.seedAudit ? (
        <details className="text-sm text-ink-2">
          <summary className="min-h-11 cursor-pointer text-ink">Check the fairness audit</summary>
          <dl className="mt-2 grid gap-1 font-mono text-xs break-all">
            <dt className="text-ink-3">Commitment published at the start</dt>
            <dd>{result.seedAudit.commitment}</dd>
            <dt className="text-ink-3">Seed ({result.seedAudit.rngVersion})</dt>
            <dd>{result.seedAudit.seed}</dd>
          </dl>
        </details>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-ink-2">
        <span>
          Detailed results stay here for {Math.floor(secondsLeft / 60)}:
          {String(secondsLeft % 60).padStart(2, '0')} · rules {result.rulesVersion}
          {result.evaluatorVersion ? ` · score model ${result.evaluatorVersion}` : ''} · data{' '}
          {result.dataVersion}
        </span>
        <Link href={team ? '/play/auction' : '/play/cards'} className="underline">
          Back to {team ? 'IPL Auction' : 'Card Battle'}
        </Link>
      </footer>
    </div>
  );
}

function ScoreReports({ reports, rankings }: { reports: Report[]; rankings: Ranking[] }) {
  const name = (id: string) => rankings.find((r) => r.competitorId === id)?.displayName ?? '';
  return (
    <section aria-labelledby="scores-heading" className="flex flex-col gap-4">
      <h2 id="scores-heading" className="text-lg font-semibold">
        How the squads were scored
      </h2>
      <p className="text-sm text-ink-2">
        A game score for each squad&apos;s best legal XI (at most 4 overseas, a keeper, 5 bowling
        options with 2 pace and 1 spin, 6 batting options), not a forecast of real results.
      </p>
      {reports.map((r) => (
        <Surface key={r.franchiseId} aria-label={`${name(r.franchiseId)} score`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-base font-semibold">{name(r.franchiseId)}</h3>
            <span className="tabular-nums">
              {r.total !== null ? `${r.total.toFixed(2)} / 100` : 'Not scored'} · {r.squadSize}{' '}
              players
            </span>
          </div>
          {r.deficits.length ? (
            <ul className="mt-2 list-disc pl-5 text-sm text-warn">
              {r.deficits.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          ) : null}
          {r.components ? <ComponentTable components={r.components} /> : null}
          {r.xi.length ? (
            <details className="mt-3">
              <summary className="min-h-11 cursor-pointer text-sm font-semibold">
                Best XI ({r.xi.filter((p) => p.overseas).length} overseas)
              </summary>
              <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {r.xi.map((p) => (
                  <li key={p.playerId} className="flex items-center gap-2 text-sm">
                    <span className="relative size-10 shrink-0 overflow-hidden rounded-full bg-overlay">
                      <PortraitImage src={p.portraitUrl} alt={`Photo of ${p.name}`} sizes="40px" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{p.name}</span>
                      <span className="block text-xs text-ink-3">
                        {p.role.replace('_', '-')}
                        {p.overseas ? ' · overseas' : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Surface>
      ))}
    </section>
  );
}

function ComponentTable({ components }: { components: NonNullable<Report['components']> }) {
  return (
    <table className="mt-3 w-full text-sm">
      <caption className="sr-only">Score components out of 100</caption>
      <thead>
        <tr className="text-left text-ink-3">
          <th scope="col" className="font-normal">
            Component (weight)
          </th>
          <th scope="col" className="w-16 text-right font-normal">
            Score
          </th>
          <th scope="col" className="w-1/3">
            <span className="sr-only">Bar</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {COMPONENTS.map(([key, label, weight]) => {
          const v = components[key];
          return (
            <tr key={key}>
              <th scope="row" className="py-1 text-left font-normal">
                {label} <span className="text-ink-3">({weight})</span>
              </th>
              <td className="text-right tabular-nums">{v.toFixed(2)}</td>
              <td className="pl-3">
                <div aria-hidden="true" className="h-2 rounded-full bg-overlay">
                  <div className="h-2 rounded-full bg-auction" style={{ width: `${v}%` }} />
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
