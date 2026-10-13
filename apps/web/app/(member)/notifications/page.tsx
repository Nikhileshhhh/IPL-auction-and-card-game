import type { Metadata } from 'next';
import { NotificationsPage } from '@/features/social/NotificationsPage';

export const metadata: Metadata = { title: 'Inbox' };
export const dynamic = 'force-dynamic';

/** S31 inbox: room invitations and friend updates. */
export default function NotificationsRoute() {
  return <NotificationsPage />;
}
