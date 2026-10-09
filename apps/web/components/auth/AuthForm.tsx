'use client';

import { useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { SessionProjection } from '@stumps/contracts';
import { Button, PasswordField, StatusMessage, TextField } from '@stumps/ui';
import { api, resetCsrf } from '@/lib/api-client';
import { safeNext } from '@/lib/safe-next';
import { useGateCheck } from './useGateCheck';

type Mode = 'signin' | 'invite' | 'recover';

/** S02: sign in, request an invitation, or recover a password. */
export function AuthForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/play');
  const ready = useGateCheck('/auth');
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setNotice(null);
    if (mode === 'signin') {
      const res = await api<SessionProjection>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      setPending(false);
      if (res.ok) {
        resetCsrf();
        router.replace(res.data.onboarded ? next : '/onboarding');
        return;
      }
      if (res.error.code === 'GATE_REQUIRED') {
        router.replace('/access?next=/auth');
        return;
      }
      setPassword('');
      setNotice({
        tone: 'error',
        text: res.error.code === 'BANNED' ? 'This account is suspended.' : res.error.message,
      });
      return;
    }
    const path = mode === 'invite' ? '/auth/enroll' : '/auth/recovery';
    const res = await api<{ accepted: true }>(path, { method: 'POST', body: { email } });
    setPending(false);
    if (res.ok) {
      setNotice({
        tone: 'success',
        text:
          mode === 'invite'
            ? 'If this address can be invited, a sign-up link is on its way. It expires in one hour.'
            : 'If an account uses this address, a password reset link is on its way.',
      });
    } else {
      setNotice({ tone: 'error', text: res.error.message });
    }
  }

  if (!ready) return <div className="h-64 animate-pulse rounded-xl bg-raised" aria-hidden="true" />;

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => {
        setMode(value);
        setNotice(null);
      }}
      className={`min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold ${
        mode === value ? 'bg-overlay text-ink' : 'text-ink-2 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      {mode !== 'recover' ? (
        <div
          role="tablist"
          aria-label="Account"
          className="mb-6 flex gap-1 rounded-xl border border-line bg-raised p-1"
        >
          {tab('signin', 'Sign in')}
          {tab('invite', 'Request invitation')}
        </div>
      ) : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode === 'signin' ? (
          <PasswordField
            label="Password"
            name="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        ) : null}
        {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Please wait…"
          disabled={!email || (mode === 'signin' && !password)}
        >
          {mode === 'signin'
            ? 'Sign in'
            : mode === 'invite'
              ? 'Send invitation link'
              : 'Send reset link'}
        </Button>
      </form>
      <div className="mt-6 text-sm">
        {mode === 'recover' ? (
          <button
            type="button"
            className="min-h-11 text-ink-2 underline"
            onClick={() => setMode('signin')}
          >
            Back to sign in
          </button>
        ) : (
          <button
            type="button"
            className="min-h-11 text-ink-2 underline"
            onClick={() => setMode('recover')}
          >
            Forgot your password?
          </button>
        )}
      </div>
    </div>
  );
}
