import { notFound } from 'next/navigation';
import { CardArena } from '@/features/cards/arena/CardArena';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Card arena' };

/** S09–S12 — card arena. Membership and every rule are enforced by the API. */
export default async function CardArenaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <CardArena roomId={id} />;
}
