'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, PasswordField, StatusMessage, TextField } from '@stumps/ui';
import { api, resetCsrf } from '@/lib/api-client';
import { TotpPrompt } from './TotpPrompt';

type Step =
  | { kind: 'credentials' }
  | { kind: 'challenge'; factorId: string }
  | { kind: 'enroll'; factorId: string; secret: string; otpauthUri: string }
  | { kind: 'blocked' };

/** S32: credentials, then a mandatory TOTP step on every screen size. */
export function AdminLogin() {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: 'credentials' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const res = await api<{ factorIds: string[]; enrollmentAllowed: boolean }>(
      '/admin/auth/login',
      {
        method: 'POST',
        body: { email, password },
      },
    );
    setPassword('');
    if (!res.ok) {
      setPending(false);
      setError(res.error.message);
      return;
    }
    resetCsrf();
    if (res.data.factorIds[0]) {
      setStep({ kind: 'challenge', factorId: res.data.factorIds[0] });
    } else if (res.data.enrollmentAllowed) {
      const enroll = await api<{ factorId: string; secret: string; otpauthUri: string }>(
        '/admin/auth/mfa/enroll',
        {
          method: 'POST',
        },
      );
      if (enroll.ok) setStep({ kind: 'enroll', ...enroll.data });
      else setError(enroll.error.message);
    } else {
      setStep({ kind: 'blocked' });
    }
    setPending(false);
  }

  const done = () => {
    router.replace('/admin');
    router.refresh();
  };

  if (step.kind === 'challenge') {
    return (
      <TotpPrompt factorId={step.factorId} submitLabel="Verify and continue" onVerified={done} />
    );
  }
  if (step.kind === 'enroll') {
    return (
      <div className="flex flex-col gap-5">
        <StatusMessage tone="warning" title="Set up your authenticator">
          Add this secret to an authenticator app, then enter the 6-digit code. It is shown only
          now.
        </StatusMessage>
        <p
          className="rounded-lg border border-line bg-midnight p-4 font-mono text-lg tracking-widest break-all"
          aria-label="Authenticator secret"
        >
          {step.secret.match(/.{1,4}/g)?.join(' ')}
        </p>
        <a href={step.otpauthUri} className="min-h-11 underline">
          Open in an authenticator app on this device
        </a>
        <TotpPrompt
          factorId={step.factorId}
          submitLabel="Confirm authenticator"
          onVerified={done}
        />
      </div>
    );
  }
  if (step.kind === 'blocked') {
    return (
      <StatusMessage tone="error" title="Authenticator required">
        This administrator account has no authenticator and enrollment is not open. Ask an operator
        to open an enrollment window.
      </StatusMessage>
    );
  }
  return (
    <form onSubmit={submitCredentials} className="flex flex-col gap-5" noValidate>
      <TextField
        label="Email"
        type="email"
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <PasswordField
        label="Password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Button
        type="submit"
        variant="secondary"
        pending={pending}
        pendingLabel="Signing in…"
        disabled={!email || !password}
      >
        Sign in
      </Button>
    </form>
  );
}
