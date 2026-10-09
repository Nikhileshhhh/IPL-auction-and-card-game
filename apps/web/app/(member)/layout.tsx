import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { getMemberSession } from '@/lib/bff/server-session';
import { redirectForSessionError } from '@/lib/session-redirect';

export const dynamic = 'force-dynamic';

/** Protected member area: re-validated server-side on every request. */
export default async function MemberLayout({ children }: { children: ReactNode }) {
  const session = await getMemberSession();
  if (!session.ok) redirectForSessionError(session.code);
  if (!session.data.onboarded) redirect('/onboarding');
  return <AppShell session={session.data}>{children}</AppShell>;
}
