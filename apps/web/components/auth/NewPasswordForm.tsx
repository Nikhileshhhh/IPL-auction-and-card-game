'use client';

import { useState, type FormEvent } from 'react';
import { Button, PasswordField, StatusMessage } from '@stumps/ui';

/** Shared new-password form: 12–128 characters, passphrases welcome, confirmation required. */
export function NewPasswordForm({
  submitLabel,
  onSubmit,
}: {
  submitLabel: string;
  onSubmit: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handle(event: FormEvent) {
    event.preventDefault();
    if (password.length < 12) return setError('Use at least 12 characters.');
    if (password.length > 128) return setError('Use at most 128 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setPending(true);
    setError(null);
    const problem = await onSubmit(password);
    setPending(false);
    if (problem) setError(problem);
  }

  return (
    <form onSubmit={handle} className="flex flex-col gap-5" noValidate>
      <PasswordField
        label="New password"
        name="new-password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        hint="At least 12 characters. A memorable passphrase works well."
      />
      <PasswordField
        label="Confirm new password"
        name="confirm-password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Saving…"
        disabled={!password || !confirm}
      >
        {submitLabel}
      </Button>
    </form>
  );
}
