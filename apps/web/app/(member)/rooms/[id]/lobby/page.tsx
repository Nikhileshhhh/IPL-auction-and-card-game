import { notFound } from 'next/navigation';
import { MultiplayerLobby } from '@/features/room/components/MultiplayerLobby';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Lobby' };

/** S07 — lobby. Membership is enforced by the API; this page holds no authority. */
export default async function LobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <MultiplayerLobby roomId={id} />;
}
