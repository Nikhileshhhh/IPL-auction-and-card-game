'use client';

import { useId } from 'react';
import { ADVISOR_CAPABILITIES, type TeamCapabilities } from '@stumps/contracts';
import { cx } from '@stumps/ui';

export type DelegatedRole = 'cocaptain' | 'bidder' | 'advisor';

/** What each right lets a teammate do, in plain words (S17 capability vocabulary). */
export const CAPABILITY_LABELS: Record<keyof TeamCapabilities, { label: string; hint: string }> = {
  bid: { label: 'Bid', hint: 'Place bids for the team at the exact next amount.' },
  rtm: { label: 'Right to match', hint: 'Use or decline the team’s right-to-match cards.' },
  strategy: { label: 'Shortlist', hint: 'Add players to the team shortlist and edit notes.' },
  manageLimits: { label: 'Set ceilings', hint: 'Set the most the team plans to pay for a player.' },
  retainPropose: { label: 'Propose retentions', hint: 'Draft the retention list for the captain.' },
  invite: { label: 'Invite', hint: 'See and share the team invitation code.' },
};

/** Starting rights for each role; the captain can still change any box. */
export function presetFor(role: DelegatedRole): TeamCapabilities {
  if (role === 'advisor') return ADVISOR_CAPABILITIES;
  if (role === 'bidder') return { ...ADVISOR_CAPABILITIES, bid: true };
  return {
    bid: true,
    rtm: true,
    strategy: true,
    manageLimits: true,
    retainPropose: true,
    invite: true,
  };
}

const ROLES: { role: DelegatedRole; label: string; hint: string }[] = [
  { role: 'advisor', label: 'Advisor', hint: 'Sees the team, recommends players. Cannot bid.' },
  { role: 'bidder', label: 'Bidder', hint: 'Can bid when you allow it.' },
  {
    role: 'cocaptain',
    label: 'Co-captain',
    hint: 'One per team: represents the team in votes and takes over first.',
  },
];

/**
 * Explicit permission editor (S17): a role and six checkboxes, never a
 * blanket grant. Late joiners stay advisors, so everything else is locked.
 */
export function CapabilityEditor({
  role,
  capabilities,
  onChange,
  lateJoiner = false,
  cocaptainTaken = false,
  disabled = false,
}: {
  role: DelegatedRole;
  capabilities: TeamCapabilities;
  onChange: (next: { role: DelegatedRole; capabilities: TeamCapabilities }) => void;
  lateJoiner?: boolean;
  cocaptainTaken?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Role</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {ROLES.map((r) => {
            const locked =
              disabled ||
              (lateJoiner && r.role !== 'advisor') ||
              (cocaptainTaken && r.role === 'cocaptain' && role !== 'cocaptain');
            return (
              <label
                key={r.role}
                className={cx(
                  'flex min-h-11 cursor-pointer gap-2 rounded-lg border p-3 text-sm',
                  role === r.role ? 'border-auction bg-auction/10' : 'border-line',
                  locked && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name={`${id}-role`}
                  value={r.role}
                  checked={role === r.role}
                  disabled={locked}
                  onChange={() => onChange({ role: r.role, capabilities: presetFor(r.role) })}
                />
                <span>
                  <span className="block font-semibold">{r.label}</span>
                  <span className="text-xs text-ink-3">{r.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-sm font-semibold text-ink">Rights</legend>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {(Object.keys(CAPABILITY_LABELS) as (keyof TeamCapabilities)[]).map((key) => {
            const locked = disabled || (lateJoiner && key !== 'strategy');
            return (
              <li key={key}>
                <label
                  className={cx(
                    'flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm',
                    locked && 'cursor-not-allowed opacity-60',
                  )}
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={capabilities[key]}
                    disabled={locked}
                    onChange={(e) =>
                      onChange({ role, capabilities: { ...capabilities, [key]: e.target.checked } })
                    }
                  />
                  <span>
                    <span className="block font-semibold">{CAPABILITY_LABELS[key].label}</span>
                    <span className="text-xs text-ink-3">{CAPABILITY_LABELS[key].hint}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {lateJoiner ? (
          <p className="mt-2 text-xs text-ink-3">
            Joined after the auction started: can observe and advise only, and cannot win this
            game’s medal.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
