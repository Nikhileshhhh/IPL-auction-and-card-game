'use client';

import Link from 'next/link';
import { Skeleton, StatusMessage } from '@stumps/ui';
import { useRoom } from '@/features/room/useRoom';
import { ChatPanel } from './ChatPanel';

/** Full-page chat (S24/S25 on small screens and direct links). */
export function ChatPage({ roomId, tab }: { roomId: string; tab: 'room' | 'team' }) {
  const { status, room, connection } = useRoom(roomId);
  if (status === 'unavailable' || status === 'removed' || status === 'closed') {
    return <StatusMessage tone="warning">This room is not available.</StatusMessage>;
  }
  if (!room) return <Skeleton className="h-96 w-full" />;
  const lifecycle = room.snapshot.room.lifecycle;
  const back =
    room.snapshot.room.gameType === 'auction'
      ? lifecycle === 'LOBBY'
        ? `/rooms/${roomId}/lobby`
        : `/rooms/${roomId}/auction`
      : lifecycle === 'LOBBY'
        ? `/rooms/${roomId}/lobby`
        : `/rooms/${roomId}/cards`;
  return (
    <div className="flex h-[calc(100dvh-10rem)] flex-col gap-3">
      <Link href={back} className="text-sm underline">
        Back to the game
      </Link>
      <ChatPanel
        roomId={roomId}
        connection={connection}
        status={status}
        hasTeams={room.snapshot.room.gameType === 'auction'}
        initialTab={tab}
      />
    </div>
  );
}
