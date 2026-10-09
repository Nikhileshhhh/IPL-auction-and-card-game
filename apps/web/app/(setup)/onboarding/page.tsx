import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { OnboardingForm } from '@/components/auth/OnboardingForm';
import { Wordmark } from '@/components/shell/Wordmark';
import { getMemberSession } from '@/lib/bff/server-session';
import { redirectForSessionError } from '@/lib/session-redirect';

export const metadata: Metadata = { title: 'Create your profile' };
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const session = await getMemberSession();
  if (!session.ok) redirectForSessionError(session.code);
  if (session.data.onboarded) redirect('/play');
  return (
    <main id="main" className="mx-auto max-w-5xl px-[var(--gutter)] py-10">
      <Wordmark />
      <h1 className="mt-8 text-[28px] leading-[34px] font-semibold">Create your club identity</h1>
      <p className="mt-2 max-w-2xl text-ink-2">
        Choose how other players will recognize you. You can change this later.
      </p>
      <div className="mt-8">
        <OnboardingForm initialDisplayName={session.data.displayName} />
      </div>
    </main>
  );
}
