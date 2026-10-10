'use client';

import { useState } from 'react';
import { Button, Dialog, StatusMessage } from '@stumps/ui';
import { AuctionSettingsSchema, CardSettingsSchema, type RoomLobbyDTO } from '@stumps/contracts';
import type { RoomConnection } from '../connection';
import { evenDealCounts } from '../rules';
import { NumberField } from './NumberField';

type Field = { key: string; label: string; min: number; max: number; unit: string };

const CARD_FIELDS: Field[] = [
  { key: 'maxPlayers', label: 'Maximum players', min: 2, max: 8, unit: 'players' },
  { key: 'totalCards', label: 'Total cards', min: 8, max: 240, unit: 'cards' },
  { key: 'selectionSeconds', label: 'Time to choose', min: 10, max: 60, unit: 'seconds' },
  { key: 'tieCap', label: 'Tie fallback after', min: 4, max: 30, unit: 'ties' },
];
const AUCTION_FIELDS: Field[] = [
  { key: 'franchiseCount', label: 'Franchises', min: 2, max: 10, unit: 'teams' },
  {
    key: 'collaboratorsPerFranchise',
    label: 'People per franchise',
    min: 1,
    max: 6,
    unit: 'people',
  },
  { key: 'openingClockSeconds', label: 'Opening bid clock', min: 10, max: 60, unit: 'seconds' },
  { key: 'rtmStageSeconds', label: 'Right-to-match decision', min: 10, max: 30, unit: 'seconds' },
];

/** Host settings change: saving bumps the rules version and clears everyone's ready (E38). */
export function SettingsDialog({
  open,
  onOpenChange,
  lobby,
  connection,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lobby: RoomLobbyDTO;
  connection: RoomConnection;
}) {
  const fields = lobby.gameType === 'card' ? CARD_FIELDS : AUCTION_FIELDS;
  const [values, setValues] = useState<Record<string, number>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const current = (key: string) => values[key] ?? Number(lobby.settings[key]);
  const merged = { ...lobby.settings, ...values };
  const schema = lobby.gameType === 'card' ? CardSettingsSchema : AuctionSettingsSchema;
  const valid = schema.safeParse(merged).success;
  const changed = Object.entries(values).some(([k, v]) => Number(lobby.settings[k]) !== v);

  async function save() {
    setPending(true);
    setError(null);
    const patch = Object.fromEntries(
      Object.entries(values).filter(([k, v]) => Number(lobby.settings[k]) !== v),
    );
    const res = await connection.mutate(
      '/settings',
      { patch, configVersion: lobby.configVersion },
      'PATCH',
    );
    setPending(false);
    if (!res.ok) {
      setError(res.error.message);
      return;
    }
    setValues({});
    onOpenChange(false);
    connection.refresh();
  }

  const evenFor =
    lobby.gameType === 'card' ? evenDealCounts(current('totalCards'), current('maxPlayers')) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setValues({});
        onOpenChange(o);
      }}
      title="Room settings"
      description="Saving changes the rules version. Everyone, including you, must ready up again."
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            pending={pending}
            pendingLabel="Saving…"
            disabled={!valid || !changed}
          >
            Save settings
          </Button>
        </>
      }
    >
      <div className="grid max-h-[50vh] gap-5 overflow-y-auto pr-1 sm:grid-cols-2">
        {fields.map((f) => (
          <NumberField
            key={f.key}
            label={f.label}
            value={current(f.key)}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
            min={f.min}
            max={f.max}
            unit={f.unit}
          />
        ))}
      </div>
      {evenFor ? (
        <p className="mt-3 text-sm text-ink-2">
          {evenFor.length > 0
            ? `Deals evenly for ${evenFor.join(', ')} players.`
            : 'No player count gets an even hand with this total.'}
        </p>
      ) : null}
      {error ? (
        <StatusMessage tone="error" className="mt-3">
          {error}
        </StatusMessage>
      ) : null}
    </Dialog>
  );
}
