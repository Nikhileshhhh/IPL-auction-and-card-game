'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, PasswordField, StatusMessage, Surface, TextField } from '@stumps/ui';
import { AuctionSettingsSchema } from '@stumps/contracts';
import { NumberField } from './NumberField';
import { describeCreateError, useCreateRoom } from './useCreateRoom';

const DEFAULTS = AuctionSettingsSchema.parse({});

/**
 * S14 shell: rule season, format and pacing. Ruleset/pool validation (purse,
 * squad limits, RTM cards) arrives with the auction rules engine in phase 09.
 */
export function AuctionCreationForm() {
  const [name, setName] = useState('');
  const [preset, setPreset] = useState(DEFAULTS.preset);
  const [format, setFormat] = useState(DEFAULTS.format);
  const [franchiseCount, setFranchiseCount] = useState(DEFAULTS.franchiseCount);
  const [collaborators, setCollaborators] = useState(DEFAULTS.collaboratorsPerFranchise);
  const [openingClock, setOpeningClock] = useState(DEFAULTS.openingClockSeconds);
  const [rtmStage, setRtmStage] = useState(DEFAULTS.rtmStageSeconds);
  const [password, setPassword] = useState('');
  const { submit, pending, error } = useCreateRoom((id) => `/rooms/${id}/franchises`);

  const settings = {
    preset,
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
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold">Rule season</legend>
          {(
            [
              [
                'IPL_2025_MEGA_HISTORICAL_v1',
                '2025 historical simulation',
                'Purse, squad and RTM limits modelled on the 2025 mega auction. A simulation, not an official product.',
              ],
              ['CASUAL_v1', 'Casual rules', 'Simpler limits for a quick game with friends.'],
            ] as const
          ).map(([value, label, help]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer gap-3 rounded-lg border border-control p-3"
            >
              <input
                type="radio"
                name="preset"
                checked={preset === value}
                onChange={() => setPreset(value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-ink-2">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold">Format</legend>
          {(
            [
              [
                'fresh',
                'Fresh reset',
                'Every franchise starts with an empty squad and full purse.',
              ],
              [
                'retention',
                'Retention',
                'Franchises keep some players before the auction; retained players reduce the purse.',
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
            <Badge tone={preset === 'CASUAL_v1' ? 'neutral' : 'auction'}>
              {preset === 'CASUAL_v1' ? 'Casual' : 'Historical sim'}
            </Badge>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
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
            Purse, squad and overseas limits are validated when the auction rules engine ships.
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
