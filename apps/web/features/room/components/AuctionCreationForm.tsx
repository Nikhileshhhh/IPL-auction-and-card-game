'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, PasswordField, StatusMessage, Surface, TextField } from '@stumps/ui';
import { AuctionSettingsSchema } from '@stumps/contracts';
import { IPL_RULES_SOURCE, IPL_RULES_SUMMARY } from '../../auction/setup/rules';
import { NumberField } from './NumberField';
import { describeCreateError, useCreateRoom } from './useCreateRoom';

const DEFAULTS = AuctionSettingsSchema.parse({});

/**
 * S14: the real IPL mega-auction rules (ADR-024) with a retention or fresh-reset
 * format, how many franchises may take part, people per franchise and pacing.
 * The room is bound to the published player pool when it is created.
 */
export function AuctionCreationForm() {
  const [name, setName] = useState('');
  const [format, setFormat] = useState(DEFAULTS.format);
  const [franchiseCount, setFranchiseCount] = useState(DEFAULTS.franchiseCount);
  const [collaborators, setCollaborators] = useState(DEFAULTS.collaboratorsPerFranchise);
  const [openingClock, setOpeningClock] = useState(DEFAULTS.openingClockSeconds);
  const [rtmStage, setRtmStage] = useState(DEFAULTS.rtmStageSeconds);
  const [password, setPassword] = useState('');
  const { submit, pending, error } = useCreateRoom((id) => `/rooms/${id}/franchises`);

  const settings = {
    preset: DEFAULTS.preset,
    format,
    franchiseCount,
    collaboratorsPerFranchise: collaborators,
    openingClockSeconds: openingClock,
    rtmStageSeconds: rtmStage,
    resultsSeconds: DEFAULTS.resultsSeconds,
  };
  const valid = AuctionSettingsSchema.safeParse(settings).success && name.trim().length > 0;
  const passwordError = password && password.length < 4 ? 'Use at least 4 characters.' : undefined;
  const humans = Math.min(60, franchiseCount * collaborators);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || passwordError) return;
    void submit({
      gameType: 'auction',
      name: name.trim(),
      ...(password ? { password } : {}),
      settings,
    });
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-8">
        <TextField
          label="Room name"
          name="roomName"
          maxLength={64}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <section aria-labelledby="rules-heading" className="flex flex-col gap-3">
          <h2 id="rules-heading" className="text-lg font-semibold">
            Real IPL auction rules
          </h2>
          <p className="text-sm text-ink-2">
            The mega-auction rules of the IPL 2025–27 cycle, played with today’s squads: every
            player’s previous team is their IPL 2026 franchise, and base prices are the ones they
            registered at the last auction.
          </p>
          <dl className="grid gap-2 rounded-lg border border-control p-4 text-sm sm:grid-cols-[auto_1fr]">
            {IPL_RULES_SUMMARY.map((r) => (
              <div key={r.label} className="contents">
                <dt className="font-medium text-ink">{r.label}</dt>
                <dd className="text-ink-2">
                  {r.value}{' '}
                  <Badge tone={r.source === 'official' ? 'auction' : 'neutral'}>
                    {r.source === 'official' ? 'Official' : 'Reported'}
                  </Badge>
                </dd>
              </div>
            ))}
          </dl>
          <a
            href={IPL_RULES_SOURCE.url}
            className="text-sm text-ink-2 underline"
            target="_blank"
            rel="noreferrer"
          >
            Source: {IPL_RULES_SOURCE.title}
          </a>
        </section>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold">Format</legend>
          {(
            [
              [
                'retention',
                'Retention (real rules)',
                'Captains keep up to 6 players from their 2026 squad; each retention is charged to the purse at the real IPL rates. Unused places become right-to-match cards.',
              ],
              [
                'fresh',
                'Fresh reset (simulator option)',
                'Every franchise starts with an empty squad and the full ₹120 crore purse. No retentions and no right-to-match cards.',
              ],
            ] as const
          ).map(([value, label, help]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer gap-3 rounded-lg border border-control p-3"
            >
              <input
                type="radio"
                name="format"
                checked={format === value}
                onChange={() => setFormat(value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-ink-2">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="grid gap-6 sm:grid-cols-2">
          <legend className="mb-3 text-lg font-semibold">Franchises and pacing</legend>
          <NumberField
            label="Franchises"
            value={franchiseCount}
            onChange={setFranchiseCount}
            min={2}
            max={10}
            unit="teams"
          />
          <NumberField
            label="People per franchise"
            value={collaborators}
            onChange={setCollaborators}
            min={1}
            max={6}
            unit="people"
          />
          <NumberField
            label="Opening bid clock"
            value={openingClock}
            onChange={setOpeningClock}
            min={10}
            max={60}
            unit="seconds"
          />
          <NumberField
            label="Right-to-match decision"
            value={rtmStage}
            onChange={setRtmStage}
            min={10}
            max={30}
            unit="seconds"
          />
        </fieldset>
        <PasswordField
          label="Room password (optional)"
          name="roomPassword"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          hint="Share it separately from the room code."
        />
      </div>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Surface aria-labelledby="auction-summary-heading">
          <div className="flex items-center justify-between gap-3">
            <h2 id="auction-summary-heading" className="text-lg font-semibold">
              Rules summary
            </h2>
            <Badge tone={format === 'fresh' ? 'neutral' : 'auction'}>
              {format === 'fresh' ? 'Fresh reset' : 'Real IPL rules'}
            </Badge>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-3">Purse</dt>
            <dd>₹120 crore each</dd>
            <dt className="text-ink-3">Format</dt>
            <dd>{format === 'fresh' ? 'Fresh reset' : 'Retention'}</dd>
            <dt className="text-ink-3">Franchises</dt>
            <dd>{franchiseCount}</dd>
            <dt className="text-ink-3">Room capacity</dt>
            <dd>{Number.isNaN(humans) ? '?' : humans} people</dd>
            <dt className="text-ink-3">Clocks</dt>
            <dd>
              {openingClock} s bids · {rtmStage} s RTM
            </dd>
          </dl>
          <p className="mt-4 text-sm text-ink-3">
            Players and squads come from the published IPL player pool. This room takes you through
            franchises and retentions to the auction lobby, then the live auction.
          </p>
          {error ? (
            <StatusMessage tone="error" className="mt-4">
              {describeCreateError(error)}
            </StatusMessage>
          ) : null}
          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="submit"
              variant="auction"
              pending={pending}
              pendingLabel="Creating…"
              disabled={!valid || Boolean(passwordError)}
            >
              Create auction room
            </Button>
            <Link
              href="/play/auction"
              className="min-h-11 py-3 text-center text-sm text-ink-2 underline"
            >
              Back to Mega Auction
            </Link>
          </div>
        </Surface>
      </aside>
    </form>
  );
}
