import type { Metadata } from 'next';
import type { MemberSummaryDTO } from '@stumps/contracts';
import { MedalBadge, StatusMessage, Surface } from '@stumps/ui';
import { serverGet } from '@/lib/bff/server-session';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

/** S29 profile shell: own profile now; other members' profiles open with social features. */
export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const summary = await serverGet<MemberSummaryDTO>('/v1/me/summary');
  if (!summary.ok)
    return <StatusMessage tone="warning">Profile is unavailable right now.</StatusMessage>;
  const own = summary.data.profile.username === username.toLowerCase();
  if (!own) {
    return (
      <StatusMessage tone="info" title="Profiles of other members">
        Viewing other members&apos; profiles arrives with friends and privacy controls.
      </StatusMessage>
    );
  }
  const { profile, medals } = summary.data;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-4">
        <div
          className="grid size-16 place-items-center rounded-full bg-overlay text-2xl font-bold text-card"
          aria-hidden="true"
        >
          {profile.displayName.slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-[28px] leading-[34px] font-semibold">{profile.displayName}</h1>
          <p className="text-ink-2">@{profile.username}</p>
        </div>
      </header>
      <Surface aria-labelledby="medal-stats">
        <h2 id="medal-stats" className="text-xl font-semibold">
          Medals
        </h2>
        <ul className="mt-4 flex flex-wrap gap-6">
          <li>
            <MedalBadge medal="gold" count={medals.gold} />
          </li>
          <li>
            <MedalBadge medal="silver" count={medals.silver} />
          </li>
          <li>
            <MedalBadge medal="bronze" count={medals.bronze} />
          </li>
        </ul>
        <dl className="mt-6 grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-ink-3">Qualifying games</dt>
            <dd className="text-lg font-semibold tabular-nums">{medals.games}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Card wins</dt>
            <dd className="text-lg font-semibold tabular-nums">{medals.cardWins}</dd>
          </div>
          <div>
            <dt className="text-ink-3">Auction wins</dt>
            <dd className="text-lg font-semibold tabular-nums">{medals.auctionWins}</dd>
          </div>
        </dl>
        {medals.games === 0 ? (
          <p className="mt-4 text-sm text-ink-2">Play qualifying games to earn medals.</p>
        ) : null}
      </Surface>
    </div>
  );
}
