'use client';

import { useState, type FormEvent } from 'react';
import type { AdminUser } from '@stumps/contracts';
import { Badge, Button, StatusMessage, Surface, TextField } from '@stumps/ui';
import { api } from '@/lib/api-client';
import { TotpPrompt } from './TotpPrompt';
import { useStepUp } from './useStepUp';

const DURATIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
] as const;

/**
 * S33 Users: find a member by exact username, then suspend (sessions end at
 * once) or lift a suspension. Needs a fresh authenticator code. Profiles,
 * friends and medals are untouched; administrators cannot be restricted here.
 */
export function UserRestrictions() {
  const [username, setUsername] = useState('');
  const [user, setUser] = useState<AdminUser | null>(null);
  const [days, setDays] = useState<number>(7);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const stepUp = useStepUp();
  const [lastAction, setLastAction] = useState<'suspend' | 'lift' | null>(null);

  async function find(event: FormEvent) {
    event.preventDefault();
    setNotice(null);
    setUser(null);
    const res = await api<AdminUser>(`/admin/users?username=${encodeURIComponent(username)}`);
    if (res.ok) setUser(res.data);
    else setNotice({ tone: 'error', text: res.error.message });
  }

  async function apply(action: 'suspend' | 'lift') {
    if (!user) return;
    setLastAction(action);
    setPending(true);
    setNotice(null);
    const until =
      action === 'suspend' ? new Date(Date.now() + days * 24 * 3600 * 1000).toISOString() : null;
    const res = await api<AdminUser>(`/admin/users/${user.userId}/restrictions`, {
      method: 'POST',
      body: { suspendedUntil: until, reason },
    });
    setPending(false);
    if (res.ok) {
      setUser(res.data);
      setReason('');
      setNotice({
        tone: 'success',
        text: res.data.suspendedUntil
          ? `Suspended until ${new Date(res.data.suspendedUntil).toLocaleString()}. Their sessions have ended.`
          : 'The suspension is lifted. They can sign in again.',
      });
      return;
    }
    const message = await stepUp.handle(res.error);
    if (message) setNotice({ tone: 'error', text: message });
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <form onSubmit={(e) => void find(e)} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="min-w-[220px] flex-1">
          <TextField
            label="Exact username"
            value={username}
            autoComplete="off"
            onChange={(e) => setUsername(e.target.value)}
          />
        </div>
        <Button type="submit" size="touch" variant="secondary">
          Find member
        </Button>
      </form>
      {notice ? <StatusMessage tone={notice.tone}>{notice.text}</StatusMessage> : null}
      {user ? (
        <Surface aria-labelledby="member-heading">
          <h2 id="member-heading" className="text-lg font-semibold break-words">
            {user.displayName} <span className="text-ink-3">@{user.username}</span>
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {user.isAdmin ? <Badge tone="auction">Administrator</Badge> : null}
            {user.suspendedUntil ? (
              <Badge tone="warning">
                Suspended until {new Date(user.suspendedUntil).toLocaleString()}
              </Badge>
            ) : (
              <Badge>Active</Badge>
            )}
            {user.onboarded ? null : <Badge>Not onboarded</Badge>}
          </div>
          {user.isAdmin ? (
            <p className="mt-3 text-sm text-ink-2">
              Administrators are managed by the operator script, not from here.
            </p>
          ) : stepUp.factorId ? (
            <div className="mt-4">
              <StatusMessage tone="warning" title="Confirm it is you">
                Restricting a member requires a fresh authenticator code.
              </StatusMessage>
              <div className="mt-3">
                <TotpPrompt
                  factorId={stepUp.factorId}
                  submitLabel="Confirm"
                  onVerified={() => {
                    stepUp.clear();
                    if (lastAction) void apply(lastAction);
                  }}
                />
              </div>
            </div>
          ) : (
            <div className="mt-4 flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <label htmlFor="restriction-reason" className="text-sm font-medium">
                  Reason <span className="text-ink-3">(3–200 characters, kept out of the log)</span>
                </label>
                <textarea
                  id="restriction-reason"
                  value={reason}
                  maxLength={200}
                  rows={2}
                  onChange={(e) => setReason(e.target.value)}
                  className="rounded-[var(--radius-control)] border border-control bg-midnight px-4 py-3 text-base"
                />
              </div>
              <fieldset className="flex flex-wrap gap-3">
                <legend className="mb-1 text-sm font-medium">Suspend for</legend>
                {DURATIONS.map((d) => (
                  <label key={d.days} className="flex min-h-11 items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="duration"
                      checked={days === d.days}
                      onChange={() => setDays(d.days)}
                    />
                    {d.label}
                  </label>
                ))}
              </fieldset>
              <div className="flex flex-wrap gap-3">
                <Button
                  size="touch"
                  variant="danger"
                  disabled={pending || reason.trim().length < 3}
                  onClick={() => void apply('suspend')}
                >
                  {pending && lastAction === 'suspend' ? 'Suspending…' : 'Suspend and end sessions'}
                </Button>
                {user.suspendedUntil ? (
                  <Button
                    size="touch"
                    variant="secondary"
                    disabled={pending || reason.trim().length < 3}
                    onClick={() => void apply('lift')}
                  >
                    Lift suspension
                  </Button>
                ) : null}
              </div>
              {reason.trim().length < 3 ? (
                <p className="text-sm text-ink-3">Enter a reason to enable these actions.</p>
              ) : null}
            </div>
          )}
        </Surface>
      ) : null}
    </div>
  );
}
