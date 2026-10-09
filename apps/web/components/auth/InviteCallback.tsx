'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { AttemptStatus } from '@stumps/contracts';
import { StatusMessage } from '@stumps/ui';
import { api, resetCsrf } from '@/lib/api-client';
import { NewPasswordForm } from './NewPasswordForm';

type State = 'checking' | 'password' | 'expired' | 'error';

/** Invitation link landing: consume the single-use link, then set a password. */
export function InviteCallback({
  tokenHash,
  enrollment,
}: {
  tokenHash: string | null;
  enrollment: string | null;
}) {
  const router = useRouter();
  const complete = Boolean(tokenHash && enrollment);
  const [state, setState] = useState<State>(complete ? 'checking' : 'expired');
  const [message, setMessage] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (!complete || started.current) return;
    started.current = true;
    const returnTo = `/auth/callback?token_hash=${encodeURIComponent(tokenHash ?? '')}&enrollment=${encodeURIComponent(enrollment ?? '')}`;
    void api<AttemptStatus>('/access/status')
      .then((gate) => {
        if (!gate.ok || (gate.data.gateStatus !== 'preauth' && gate.data.gateStatus !== 'bound')) {
          router.replace(`/access?next=${encodeURIComponent(returnTo)}`);
          return null;
        }
        // Remove the single-use token from the address bar and history.
        window.history.replaceState(null, '', '/auth/callback');
        return api('/auth/callback', { method: 'POST', body: { tokenHash, enrollment } });
      })
      .then((res) => {
        if (!res) return;
        if (res.ok) {
          resetCsrf();
          setState('password');
        } else {
          setMessage(res.error.message);
          setState(res.error.code === 'CALLBACK_EXPIRED' ? 'expired' : 'error');
        }
      });
  }, [complete, tokenHash, enrollment, router]);

  if (state === 'checking') return <p aria-live="polite">Confirming your invitation…</p>;
  if (state === 'expired' || state === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <StatusMessage tone="error" title="This link cannot be used">
          {message || 'The invitation link has expired or was already used.'}
        </StatusMessage>
        <Link href="/auth" className="min-h-11 underline">
          Request a new invitation
        </Link>
      </div>
    );
  }
  return (
    <NewPasswordForm
      submitLabel="Create account"
      onSubmit={async (password) => {
        const res = await api('/auth/password', { method: 'POST', body: { password } });
        if (!res.ok) return res.error.message;
        router.replace('/onboarding');
        return null;
      }}
    />
  );
}
