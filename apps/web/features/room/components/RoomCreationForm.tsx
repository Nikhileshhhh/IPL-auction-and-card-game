'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, PasswordField, StatusMessage, Surface, TextField } from '@stumps/ui';
import { CardSettingsSchema, RARITIES, type Rarity } from '@stumps/contracts';
import { RARITY_LABELS, evenDealCounts } from '../rules';
import { NumberField } from './NumberField';
import { describeCreateError, useCreateRoom } from './useCreateRoom';

const DEFAULTS = CardSettingsSchema.parse({});

/** S05: configure a fair card match before inviting friends. */
export function RoomCreationForm() {
  const [name, setName] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(DEFAULTS.maxPlayers);
  const [totalCards, setTotalCards] = useState(DEFAULTS.totalCards);
  const [selectionSeconds, setSelectionSeconds] = useState(DEFAULTS.selectionSeconds);
  const [timeLimit, setTimeLimit] = useState(true);
  const [matchMinutes, setMatchMinutes] = useState(DEFAULTS.matchMinutes ?? 45);
  const [tieCap, setTieCap] = useState(DEFAULTS.tieCap);
  const [rarities, setRarities] = useState<Rarity[]>([...RARITIES]);
  const [dealMode, setDealMode] = useState(DEFAULTS.dealMode);
  const [password, setPassword] = useState('');
  const { submit, pending, error } = useCreateRoom((id) => `/rooms/${id}/lobby`);

  const settings = {
    maxPlayers,
    totalCards,
    selectionSeconds,
    matchMinutes: timeLimit ? matchMinutes : null,
    tieCap,
    rarities,
    dealMode,
    resultsSeconds: DEFAULTS.resultsSeconds,
  };
  const valid = CardSettingsSchema.safeParse(settings).success && name.trim().length > 0;
  const passwordError = password && password.length < 4 ? 'Use at least 4 characters.' : undefined;
  const evenFor = Number.isInteger(totalCards) ? evenDealCounts(totalCards, maxPlayers) : [];

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!valid || passwordError) return;
    void submit({
      gameType: 'card',
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
          hint="Shown to people you invite. Not a public listing."
        />
        <fieldset className="grid gap-6 sm:grid-cols-2">
          <legend className="mb-3 text-lg font-semibold">Players and deck</legend>
          <NumberField
            label="Maximum players"
            value={maxPlayers}
            onChange={setMaxPlayers}
            min={2}
            max={8}
            unit="players"
          />
          <NumberField
            label="Total cards"
            value={totalCards}
            onChange={setTotalCards}
            min={8}
            max={240}
            unit="cards"
            hint={
              evenFor.length > 0
                ? `Deals evenly for ${evenFor.join(', ')} players. The host can adjust at start.`
                : `No player count from 2 to ${maxPlayers} gets an even 4–30 card hand. Pick another total.`
            }
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold">Rarities in the deck</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {RARITIES.map((r) => (
              <label
                key={r}
                className="flex min-h-11 items-center gap-3 rounded-lg border border-control px-3"
              >
                <input
                  type="checkbox"
                  checked={rarities.includes(r)}
                  onChange={(e) =>
                    setRarities((prev) =>
                      e.target.checked
                        ? RARITIES.filter((x) => prev.includes(x) || x === r)
                        : prev.filter((x) => x !== r),
                    )
                  }
                />
                {RARITY_LABELS[r]}
              </label>
            ))}
          </div>
          {rarities.length === 0 ? (
            <p className="text-sm text-bad">Keep at least one rarity.</p>
          ) : null}
        </fieldset>

        <fieldset className="grid gap-6 sm:grid-cols-2">
          <legend className="mb-3 text-lg font-semibold">Timing and ties</legend>
          <NumberField
            label="Time to choose a category"
            value={selectionSeconds}
            onChange={setSelectionSeconds}
            min={10}
            max={60}
            unit="seconds"
          />
          <NumberField
            label="Tie fallback after"
            value={tieCap}
            onChange={setTieCap}
            min={4}
            max={30}
            unit="ties"
            hint="After this many ties in a row, the highest overall rating wins the pot."
          />
          <div className="flex flex-col gap-3 sm:col-span-2">
            <label className="flex min-h-11 items-center gap-3">
              <input
                type="checkbox"
                checked={timeLimit}
                onChange={(e) => setTimeLimit(e.target.checked)}
              />
              Limit the match length
            </label>
            {timeLimit ? (
              <NumberField
                label="Match time limit"
                value={matchMinutes}
                onChange={setMatchMinutes}
                min={10}
                max={120}
                unit="minutes"
              />
            ) : null}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-lg font-semibold">Dealing</legend>
          {(
            [
              [
                'stratified',
                'Stratified fair deal',
                'Each hand gets a similar spread of strong and weak cards.',
              ],
              ['random', 'Pure random deal', 'Casual: hands can be lopsided.'],
            ] as const
          ).map(([value, label, help]) => (
            <label
              key={value}
              className="flex min-h-11 cursor-pointer gap-3 rounded-lg border border-control p-3"
            >
              <input
                type="radio"
                name="dealMode"
                checked={dealMode === value}
                onChange={() => setDealMode(value)}
                className="mt-1"
              />
              <span>
                <span className="block font-medium">{label}</span>
                <span className="block text-sm text-ink-2">{help}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <PasswordField
          label="Room password (optional)"
          name="roomPassword"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordError}
          hint="Share it separately from the room code. It is never shown again."
        />
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Surface aria-labelledby="summary-heading">
          <h2 id="summary-heading" className="text-lg font-semibold">
            Rules summary
          </h2>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-ink-3">Players</dt>
            <dd>2–{Number.isNaN(maxPlayers) ? '?' : maxPlayers}</dd>
            <dt className="text-ink-3">Deck</dt>
            <dd>{Number.isNaN(totalCards) ? '?' : totalCards} cards</dd>
            <dt className="text-ink-3">Rarities</dt>
            <dd>{rarities.map((r) => RARITY_LABELS[r]).join(', ') || 'None'}</dd>
            <dt className="text-ink-3">Choosing</dt>
            <dd>{selectionSeconds} s</dd>
            <dt className="text-ink-3">Match limit</dt>
            <dd>{timeLimit ? `${matchMinutes} min` : 'None'}</dd>
            <dt className="text-ink-3">Ties</dt>
            <dd>Fallback after {tieCap}</dd>
            <dt className="text-ink-3">Privacy</dt>
            <dd>{password ? 'Code + password' : 'Code only'}</dd>
          </dl>
          {error ? (
            <StatusMessage tone="error" className="mt-4">
              {describeCreateError(error)}
            </StatusMessage>
          ) : null}
          <div className="mt-6 flex flex-col gap-3">
            <Button
              type="submit"
              pending={pending}
              pendingLabel="Creating…"
              disabled={!valid || Boolean(passwordError)}
            >
              Create room
            </Button>
            <Link
              href="/play/cards"
              className="min-h-11 py-3 text-center text-sm text-ink-2 underline"
            >
              Back to Card Battle
            </Link>
          </div>
        </Surface>
      </aside>
    </form>
  );
}
