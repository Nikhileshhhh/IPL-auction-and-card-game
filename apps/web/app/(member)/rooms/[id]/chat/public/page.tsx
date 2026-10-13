import { notFound } from 'next/navigation';
import { ChatPage } from '@/features/chat/ChatPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Room chat' };

/** S24 — public room chat. */
export default async function ChatRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <ChatPage roomId={id} tab="room" />;
}
