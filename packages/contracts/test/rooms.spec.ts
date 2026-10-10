import { describe, expect, it } from 'vitest';
import {
  CardSettingsSchema,
  CreateRoomRequestSchema,
  RoomCodeSchema,
  formatRoomCode,
  normalizeRoomCode,
} from '../src/index';

describe('room codes', () => {
  it('normalizes pasted, spaced, hyphenated and ambiguous input', () => {
    expect(normalizeRoomCode(' ab12-cd34 ef5o ')).toBe('AB12CD34EF50');
    expect(normalizeRoomCode('il')).toBe('11');
    expect(RoomCodeSchema.parse('7k9m-pq2r-st4v')).toBe('7K9MPQ2RST4V');
    expect(formatRoomCode('7K9MPQ2RST4V')).toBe('7K9M-PQ2R-ST4V');
  });

  it('rejects wrong lengths and characters outside the alphabet', () => {
    for (const bad of ['ABC', '7K9MPQ2RST4VX', '7K9MPQ2RST4U', '7K9M PQ2R ST4!']) {
      expect(RoomCodeSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('card settings (rules §1, E40)', () => {
  it('applies documented defaults', () => {
    expect(CardSettingsSchema.parse({})).toMatchObject({
      maxPlayers: 4,
      totalCards: 48,
      selectionSeconds: 20,
      matchMinutes: 45,
      tieCap: 12,
      resultsSeconds: 120,
      dealMode: 'stratified',
    });
  });

  it('enforces bounds and rejects unknown fields', () => {
    expect(CardSettingsSchema.safeParse({ maxPlayers: 9 }).success).toBe(false);
    expect(CardSettingsSchema.safeParse({ totalCards: 241 }).success).toBe(false);
    expect(CardSettingsSchema.safeParse({ selectionSeconds: 5 }).success).toBe(false);
    expect(CardSettingsSchema.safeParse({ rarities: ['gold', 'gold'] }).success).toBe(false);
    expect(CardSettingsSchema.safeParse({ cheat: true }).success).toBe(false);
  });

  it('create requests are discriminated by game type', () => {
    expect(
      CreateRoomRequestSchema.safeParse({ gameType: 'card', name: 'Friday', settings: {} }).success,
    ).toBe(true);
    expect(
      CreateRoomRequestSchema.safeParse({
        gameType: 'card',
        name: 'x',
        settings: { franchiseCount: 4 },
      }).success,
    ).toBe(false);
  });
});
