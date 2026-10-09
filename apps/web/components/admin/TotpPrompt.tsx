'use client';

import { useState, type FormEvent } from 'react';
import { Button, StatusMessage, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';

/** Challenge + verify a TOTP factor; used for sign-in (AAL2) and step-up. */
export function TotpPrompt({
  factorId,
  submitLabel,
  onVerified,
}: {
  factorId: string;
  submitLabel: string;
  onVerified: () => void;
}) {
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const challenge = await api<{ challengeId: string }>('/admin/auth/mfa/challenge', {
      method: 'POST',
      body: { factorId },
    });
    if (!challenge.ok) {
      setPending(false);
      setError(challenge.error.message);
      return;
    }
    const verify = await api('/admin/auth/mfa', {
      method: 'POST',
      body: { factorId, challengeId: challenge.data.challengeId, code },
    });
    setPending(false);
    if (verify.ok) onVerified();
    else {
      setCode('');
      setError(verify.error.message);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <TextField
        label="Authenticator code"
        name="totp"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="\d{6}"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        hint="The 6-digit code from your authenticator app."
      />
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Verifying…"
        disabled={code.length !== 6}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
