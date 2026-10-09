'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { SessionProjection } from '@stumps/contracts';
import { StatusMessage } from '@stumps/ui';
import { api, resetCsrf } from '@/lib/api-client';
import { NewPasswordForm } from './NewPasswordForm';
import { useGateCheck } from './useGateCheck';

/** Password recovery landing: single-use token + gate, then a new password. */
export function RecoveryReset({ tokenHash }: { tokenHash: string | null }) {
  const router = useRouter();
  const ready = useGateCheck(
    tokenHash ? `/auth/reset?token_hash=${encodeURIComponent(tokenHash)}` : '/auth/reset',
  );

  useEffect(() => {
    // Remove the single-use token from the address bar once the gate is confirmed.
    if (ready) window.history.replaceState(null, '', '/auth/reset');
  }, [ready]);

  if (!ready) return <p aria-live="polite">Checking access…</p>;
  if (!tokenHash) {
    return (
      <div className="flex flex-col gap-4">
        <StatusMessage tone="error">This reset link is incomplete or already used.</StatusMessage>
        <Link href="/auth" className="min-h-11 underline">
          Request a new link
        </Link>
      </div>
    );
  }
  return (
    <NewPasswordForm
      submitLabel="Save new password"
      onSubmit={async (password) => {
        const res = await api<SessionProjection>('/auth/recovery/complete', {
          method: 'POST',
          body: { tokenHash, password },
        });
        if (!res.ok) return res.error.message;
        resetCsrf();
        router.replace(res.data.onboarded ? '/play' : '/onboarding');
        return null;
      }}
    />
  );
}
