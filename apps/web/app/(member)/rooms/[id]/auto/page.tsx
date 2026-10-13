import { notFound } from 'next/navigation';
import { AutoModePanel } from '@/features/team/auto/AutoModePanel';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Automatic bidding' };

/** S26 — automatic bidding status and limits. Only the team's own members can open it. */
export default async function AutoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <AutoModePanel roomId={id} />;
}
