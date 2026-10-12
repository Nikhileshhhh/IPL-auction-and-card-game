import { notFound } from 'next/navigation';
import { AuctionSetupPage } from '@/features/auction/setup/AuctionSetupPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Franchises' };

/** S16 franchise selection (and the S17 team panel). */
export default async function FranchisesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AuctionSetupPage roomId={id} screen="franchises" />;
}
