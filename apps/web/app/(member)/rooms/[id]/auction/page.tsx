import { notFound } from 'next/navigation';
import { AuctionStage } from '@/features/auction/stage/AuctionStage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Live auction' };

/** S20 — live auction stage. Membership and every rule are enforced by the API. */
export default async function AuctionStagePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AuctionStage roomId={id} />;
}
