import { notFound } from 'next/navigation';
import { ChatPage } from '@/features/chat/ChatPage';
import { isUuid } from '@/features/room/ids';

export const metadata = { title: 'Team chat' };

/** S25 — private team chat (its members only; enforced by the API). */
export default async function ChatRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return <ChatPage roomId={id} tab="team" />;
}
