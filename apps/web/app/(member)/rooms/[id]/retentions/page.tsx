import { notFound } from 'next/navigation';
import { AuctionSetupPage } from '@/features/auction/setup/AuctionSetupPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Retentions' };

/** S18 retention management. */
export default async function RetentionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AuctionSetupPage roomId={id} screen="retentions" />;
}
