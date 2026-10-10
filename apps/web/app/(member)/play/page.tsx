import type { Metadata } from 'next';
import type { Announcement, MemberSummaryDTO } from '@stumps/contracts';
import { StatusMessage } from '@stumps/ui';
import { AnnouncementBanner } from '@/components/dashboard/AnnouncementBanner';
import { FriendsStrip } from '@/components/dashboard/FriendsStrip';
import { MedalSummary } from '@/components/dashboard/MedalSummary';
import { AuctionArt, CardBattleArt } from '@/components/game-selection/art';
import { GameSelectionCard } from '@/components/game-selection/GameSelectionCard';
import { serverGet } from '@/lib/bff/server-session';
import { FEATURES } from '@/lib/features';

export const metadata: Metadata = { title: 'Play' };
export const dynamic = 'force-dynamic';

/** S04 game selection dashboard. Independent sections fail independently. */
export default async function PlayPage() {
  const [summary, announcements] = await Promise.all([
    serverGet<MemberSummaryDTO>('/v1/me/summary'),
    serverGet<{ items: Announcement[] }>('/v1/announcements'),
  ]);
  const name = summary.ok ? summary.data.profile.displayName : null;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-[32px] leading-[38px] font-semibold sm:text-[40px] sm:leading-[46px]">
          {name ? `Welcome back, ${name}` : 'Choose your arena'}
        </h1>
        <p className="mt-2 text-ink-2">Pick a game to create or join a private room.</p>
      </header>

      {announcements.ok ? <AnnouncementBanner items={announcements.data.items} /> : null}

      <div className="grid gap-6 md:grid-cols-2">
        <GameSelectionCard
          href="/play/cards"
          title="Card Battle"
          tagline="Reveal your top card, pick the category, win the pot. Last collector standing takes the match."
          accent="card"
          art={<CardBattleArt />}
          facts={['2–8 players', 'Legend cards and Platinum pairs', 'Fair committed deal']}
          {...(FEATURES.cardBattle
            ? {}
            : { status: FEATURES.rooms ? 'Lobbies open · matches soon' : 'Rooms coming soon' })}
        />
        <GameSelectionCard
          href="/play/auction"
          title="Mega Auction"
          tagline="Run a franchise with friends, bid against rivals and build the strongest legal XI."
          accent="auction"
          art={<AuctionArt />}
          facts={['Up to 10 franchises', 'Retention & RTM', 'Team collaboration']}
          {...(FEATURES.megaAuction
            ? {}
            : { status: FEATURES.rooms ? 'Lobbies open · matches soon' : 'Rooms coming soon' })}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        {summary.ok ? (
          <MedalSummary summary={summary.data} />
        ) : (
          <StatusMessage tone="warning">
            Medal summary is unavailable right now. Your medals are safe.
          </StatusMessage>
        )}
        {summary.ok ? <FriendsStrip friends={summary.data.friends} /> : null}
      </div>
    </div>
  );
}
