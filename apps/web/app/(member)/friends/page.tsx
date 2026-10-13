import type { Metadata } from 'next';
import { FriendsPage } from '@/features/social/FriendsPage';
import { isUuid } from '@/features/room/ids';

export const metadata: Metadata = { title: 'Friends' };
export const dynamic = 'force-dynamic';

/** S30 friends; `?room=<id>` (from a lobby) adds invite buttons for that room. */
export default async function FriendsRoute({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;
  return <FriendsPage inviteRoomId={room && isUuid(room) ? room : null} />;
}
