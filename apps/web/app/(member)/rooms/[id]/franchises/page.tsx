import { notFound } from 'next/navigation';
import { StatusMessage } from '@stumps/ui';
import { MultiplayerLobby } from '@/features/room/components/MultiplayerLobby';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Franchises' };

/**
 * S16 shell — the room roster is live; claiming franchises arrives with the
 * auction rules engine (phase 09). Nothing here simulates a claim.
 */
export default async function FranchisesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return (
    <MultiplayerLobby roomId={id}>
      <StatusMessage tone="info" title="Franchise selection is not open yet">
        You are in the room. Claiming a franchise or asking to join one opens when the auction rules
        engine ships. Your place in the room is saved.
      </StatusMessage>
    </MultiplayerLobby>
  );
}
