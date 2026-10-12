import { notFound } from 'next/navigation';
import { AuctionSetupPage } from '@/features/auction/setup/AuctionSetupPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Auction lobby' };

/** S19 auction waiting lobby. */
export default async function AuctionLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AuctionSetupPage roomId={id} screen="auction-lobby" />;
}
