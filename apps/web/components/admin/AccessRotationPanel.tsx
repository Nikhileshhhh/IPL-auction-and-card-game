'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, PasswordField, StatusMessage, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { TotpPrompt } from './TotpPrompt';

interface AccessSettings {
  version: string;
  minValidVersion: string;
  configured: boolean;
  expiresAt: string | null;
  windowSeconds: number;
  lockoutSeconds: number;
  rotationPolicy: 'REVOKE_EXISTING' | 'PRESERVE_EXISTING';
  rotatedAt: string | null;
}

/** S34 access management: rotate the website code with step-up and an explicit policy. */
export function AccessRotationPanel() {
  const [settings, setSettings] = useState<AccessSettings | null>(null);
  const [mode, setMode] = useState<'type' | 'generate'>('generate');
  const [newCode, setNewCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [windowMinutes, setWindowMinutes] = useState(15);
  const [lockoutMinutes, setLockoutMinutes] = useState(15);
  const [policy, setPolicy] = useState<'REVOKE_EXISTING' | 'PRESERVE_EXISTING'>('REVOKE_EXISTING');
  const [pending, setPending] = useState(false);
  const [stepUp, setStepUp] = useState<string | null>(null);
  const [result, setResult] = useState<{
    generatedCode?: string;
    version: string;
    revokedGrants: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api<AccessSettings>('/admin/access').then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSettings(res.data);
        setWindowMinutes(Math.round(res.data.windowSeconds / 60));
        setLockoutMinutes(Math.round(res.data.lockoutSeconds / 60));
      } else setError(res.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function rotate() {
    if (!settings) return;
    setPending(true);
    setError(null);
    const res = await api<{ generatedCode?: string; version: string; revokedGrants: number }>(
      '/admin/access',
      {
        method: 'PUT',
        body: {
          ...(mode === 'generate' ? { generate: true } : { newCode }),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          windowSeconds: windowMinutes * 60,
          lockoutSeconds: lockoutMinutes * 60,
          rotationPolicy: policy,
          version: settings.version,
        },
      },
    );
    setPending(false);
    if (res.ok) {
      setResult(res.data);
      setNewCode('');
      setReloadKey((k) => k + 1);
      return;
    }
    if (res.error.code === 'STEP_UP_REQUIRED') {
      const factors = await api<{ factorIds: string[] }>('/admin/auth/mfa/factors', {
        method: 'POST',
      });
      if (factors.ok && factors.data.factorIds[0]) setStepUp(factors.data.factorIds[0]);
      else setError('No authenticator found for step-up verification.');
      return;
    }
    setError(res.error.message);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void rotate();
  }

  if (!settings)
    return <div className="h-64 animate-pulse rounded-xl bg-raised" aria-hidden="true" />;

  return (
    <section
      aria-labelledby="access-heading"
      className="rounded-[var(--radius-panel)] border border-line bg-raised p-6"
    >
      <h2 id="access-heading" className="text-xl font-semibold">
        Website access code
      </h2>
      <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ink-3">Status</dt>
          <dd>{settings.configured ? 'Open (a code is set)' : 'Closed — no code set'}</dd>
        </div>
        <div>
          <dt className="text-ink-3">Version</dt>
          <dd>
            {settings.version} (minimum valid {settings.minValidVersion})
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Code expiry</dt>
          <dd>
            {settings.expiresAt ? new Date(settings.expiresAt).toLocaleString() : 'No expiry'}
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Last rotated</dt>
          <dd>{settings.rotatedAt ? new Date(settings.rotatedAt).toLocaleString() : 'Never'}</dd>
        </div>
      </dl>

      {result ? (
        <StatusMessage
          tone="success"
          title={`Rotated to version ${result.version}`}
          className="mt-6"
        >
          {result.generatedCode ? (
            <>
              New code (shown once — copy it now):{' '}
              <code className="rounded bg-midnight px-2 py-1 font-mono text-ink">
                {result.generatedCode}
              </code>
            </>
          ) : (
            'The new code is active.'
          )}{' '}
          {result.revokedGrants > 0
            ? `${result.revokedGrants} existing verification(s) were revoked.`
            : null}
        </StatusMessage>
      ) : null}

      {stepUp ? (
        <div className="mt-6">
          <StatusMessage tone="warning" title="Confirm it is you">
            Changing the access code requires a fresh authenticator code.
          </StatusMessage>
          <div className="mt-4">
            <TotpPrompt
              factorId={stepUp}
              submitLabel="Confirm and rotate"
              onVerified={() => {
                setStepUp(null);
                void rotate();
              }}
            />
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5" noValidate>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">New code</legend>
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                checked={mode === 'generate'}
                onChange={() => setMode('generate')}
              />
              Generate a random 128-bit code (recommended)
            </label>
            <label className="flex min-h-11 items-center gap-3">
              <input type="radio" checked={mode === 'type'} onChange={() => setMode('type')} />
              Type a passphrase (12–128 characters)
            </label>
          </fieldset>
          {mode === 'type' ? (
            <PasswordField
              label="New access code"
              revealLabel="code"
              autoComplete="off"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
            />
          ) : null}
          <TextField
            label="Expires (optional)"
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Attempt window (minutes)"
              type="number"
              min={1}
              max={1440}
              value={windowMinutes}
              onChange={(e) => setWindowMinutes(Number(e.target.value))}
            />
            <TextField
              label="Lockout after 3 failures (minutes)"
              type="number"
              min={1}
              max={1440}
              value={lockoutMinutes}
              onChange={(e) => setLockoutMinutes(Number(e.target.value))}
            />
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Existing verified visitors</legend>
            <label className="flex min-h-11 gap-3">
              <input
                type="radio"
                checked={policy === 'REVOKE_EXISTING'}
                onChange={() => setPolicy('REVOKE_EXISTING')}
              />
              <span>
                <span className="block font-medium">Revoke now (default)</span>
                <span className="block text-sm text-ink-2">
                  Everyone must enter the new code. Running games keep their timers.
                </span>
              </span>
            </label>
            <label className="flex min-h-11 gap-3">
              <input
                type="radio"
                checked={policy === 'PRESERVE_EXISTING'}
                onChange={() => setPolicy('PRESERVE_EXISTING')}
              />
              <span>
                <span className="block font-medium">Keep until they expire</span>
                <span className="block text-sm text-ink-2">
                  Only new visitors need the new code.
                </span>
              </span>
            </label>
          </fieldset>
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
          <Button
            type="submit"
            variant="danger"
            pending={pending}
            pendingLabel="Rotating…"
            disabled={mode === 'type' && (newCode.length < 12 || newCode.length > 128)}
          >
            Rotate access code
          </Button>
        </form>
      )}
    </section>
  );
}
