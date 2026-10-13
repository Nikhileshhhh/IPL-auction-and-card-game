import type { Metadata } from 'next';
import { ProfileView } from '@/features/social/ProfileView';

export const metadata: Metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

/** S29 profile: what this viewer may see is decided by the server (privacy, blocks). */
export default async function ProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={decodeURIComponent(username).toLowerCase()} />;
}
