import { notFound } from 'next/navigation';
import { AuctionSetupPage } from '@/features/auction/setup/AuctionSetupPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Squad' };

/** S22 franchise squad view (?team=<teamId>, default your own team). */
export default async function SquadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ team?: string }>;
}) {
  const { id } = await params;
  const { team } = await searchParams;
  if (!isUuid(id)) notFound();
  return (
    <AuctionSetupPage roomId={id} screen="squad" teamId={team && isUuid(team) ? team : null} />
  );
}
