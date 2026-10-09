'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { AttemptStatus } from '@stumps/contracts';
import { Button, PasswordField, StatusMessage } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { safeNext } from '@/lib/safe-next';

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** S01: server-counted attempts; refresh or new tabs cannot reset them. */
export function AccessGate() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'), '/auth');
  const [status, setStatus] = useState<AttemptStatus | null>(null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ tone: 'error' | 'warning'; text: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void api<AttemptStatus>('/access/status').then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setStatus(res.data);
        if (res.data.gateStatus === 'preauth' || res.data.gateStatus === 'bound')
          router.replace(next);
      } else {
        setMessage({ tone: 'error', text: res.error.message });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reloadKey, next, router]);

  // Re-check once a lockout ends so the form re-enables from server state.
  useEffect(() => {
    if (status?.gateStatus !== 'locked' || !status.lockedUntil) return;
    const wait = Date.parse(status.lockedUntil) - Date.now() + 500;
    const timer = setTimeout(() => setReloadKey((k) => k + 1), Math.max(1000, wait));
    return () => clearTimeout(timer);
  }, [status]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || !code) return;
    setPending(true);
    setMessage(null);
    const res = await api<AttemptStatus>('/access/verify', {
      method: 'POST',
      body: { code, requestId: crypto.randomUUID() },
    });
    setPending(false);
    if (res.ok) {
      router.replace(next);
      return;
    }
    const details = res.error.details as { status?: AttemptStatus } | undefined;
    if (details?.status) setStatus(details.status);
    if (res.error.code === 'ACCESS_LOCKED') {
      setMessage({
        tone: 'error',
        text: 'Too many incorrect codes. This browser is locked for now.',
      });
    } else if (res.error.code === 'GATE_INVALID' && details?.status?.gateStatus === 'closed') {
      setMessage({
        tone: 'warning',
        text: 'Access is not open right now. Ask your host for the current code.',
      });
    } else {
      setMessage({ tone: 'error', text: res.error.message });
    }
    input.current?.select();
  }

  const locked = status?.gateStatus === 'locked';
  const closed = status?.gateStatus === 'closed';
  const remaining = status?.remainingAttempts;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <PasswordField
        ref={input}
        label="Invitation code"
        revealLabel="code"
        name="code"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={locked || closed || status === null}
        hint="Ask the person who invited you for the current code."
      />
      {status && !locked && !closed && remaining !== undefined ? (
        <p className="text-sm text-ink-2" aria-live="polite">
          {remaining === 3
            ? 'You have 3 attempts.'
            : `${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`}
        </p>
      ) : null}
      {locked && status?.lockedUntil ? (
        <StatusMessage tone="error" title="Locked">
          Try again at {formatTime(status.lockedUntil)}. Refreshing the page does not reset this.
        </StatusMessage>
      ) : null}
      {message && !locked ? (
        <StatusMessage tone={message.tone}>{message.text}</StatusMessage>
      ) : null}
      <Button
        type="submit"
        pending={pending}
        pendingLabel="Checking…"
        disabled={locked || closed || !code}
      >
        Continue
      </Button>
    </form>
  );
}
