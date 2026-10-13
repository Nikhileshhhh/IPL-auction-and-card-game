import { notFound } from 'next/navigation';
import { TeamApproval } from '@/features/team/TeamApproval';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Your team' };

/** S17 — team requests, rights and captaincy. Only the team's own members can open it. */
export default async function TeamRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <TeamApproval roomId={id} />;
}
