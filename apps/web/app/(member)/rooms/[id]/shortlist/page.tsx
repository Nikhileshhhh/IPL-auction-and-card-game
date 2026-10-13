import { notFound } from 'next/navigation';
import { TeamShortlist } from '@/features/team/TeamShortlist';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Team shortlist' };

/** S23 — the team's private shortlist. Only the team's own members can read it. */
export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <TeamShortlist roomId={id} />;
}
