import { describe, expect, it } from 'vitest';
import type { PublicCardDTO, RoomMemberSummary } from '@stumps/contracts';
import {
  arenaView,
  metricRows,
  seatName,
  secondsLeft,
  type CardGame,
} from '../features/cards/arena/model';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const card = (batting: number): PublicCardDTO & { instanceId: string } => ({
  instanceId: '00000000-0000-4000-8000-0000000000ff',
  definitionId: '00000000-0000-4000-8000-0000000000fe',
  rarity: 'bronze',
  stars: 3,
  players: [
    {
      id: '00000000-0000-4000-8000-0000000000fd',
      name: 'Test Player',
      role: 'batter',
      team: 'MI',
      country: 'IN',
      battingStyle: 'right_hand',
      bowlingStyle: null,
      portraitUrl: '/p.webp',
      portraitAlt: 'Test Player',
      photoCredit: null,
    },
  ],
  ratings: { batting, bowling: 10, runs: 30 },
  dataLabel: 'IPL 2024–2026',
  dataKind: 'factual',
  modelVersion: 'v1',
});

function game(overrides: Partial<CardGame> = {}): CardGame {
  return {
    totalCards: 12,
    seats: [A, B, C].map((memberId, seatOrder) => ({
      memberId,
      seatOrder,
      deckCount: 3,
      eliminationOrder: null,
      contestsWon: 0,
    })),
    deckCountsBySeat: { [A]: 3, [B]: 3, [C]: 3 },
    comparisonId: '00000000-0000-4000-8000-000000000001',
    comparisonIndex: 0,
    chainIndex: 0,
    selectorSeat: A,
    eligibleSeats: [A, B, C],
    tiedSeats: [],
    isTie: false,
    visibleCards: [
      { memberId: A, card: card(90) },
      { memberId: B, card: card(80) },
      { memberId: C, card: card(70) },
    ],
    potCount: 0,
    contributions: [],
    myDeck: [],
    allowedMetrics: ['batting', 'bowling', 'runs'],
    metric: null,
    deadline: '2026-10-11T10:00:20.000Z',
    myAllowedActions: ['card.selectCategory', 'card.revealAcknowledged'],
    seedCommitment: 'a'.repeat(64),
    rngVersion: 'hmac-sha256-ctr-v1',
    finishPending: false,
    completedContests: 0,
    lastComparison: null,
    result: null,
    auditSeed: null,
    ...overrides,
  };
}

describe('card arena view model', () => {
  it('only a live controlling selector may choose', () => {
    expect(arenaView(game(), A, true).canSelect).toBe(true);
    expect(arenaView(game(), A, false).canSelect).toBe(false); // offline or read-only tab
    const other = game({ myAllowedActions: ['card.revealAcknowledged'] });
    expect(arenaView(other, B, true).canSelect).toBe(false);
    expect(arenaView(game({ comparisonId: null }), A, true).canSelect).toBe(false);
  });

  it('players outside a tie wait; eliminated players are marked', () => {
    const tie = game({ isTie: true, eligibleSeats: [A, B], tiedSeats: [A, B] });
    expect(arenaView(tie, C, true).waitingForTie).toBe(true);
    expect(arenaView(tie, A, true).waitingForTie).toBe(false);
    const out = game({
      seats: game().seats.map((s) => (s.memberId === C ? { ...s, eliminationOrder: 1 } : s)),
    });
    expect(arenaView(out, C, true).eliminated).toBe(true);
    expect(arenaView(out, A, true).eliminated).toBe(false);
  });

  it('category rows keep enum order and show the viewer’s own values', () => {
    const rows = metricRows(arenaView(game(), B, true).myCard);
    expect(rows.map((r) => r.metric)).toEqual(['batting', 'bowling', 'runs']);
    expect(rows[0]).toEqual({ metric: 'batting', value: 80 });
    expect(metricRows(null).every((r) => r.value === null)).toBe(true);
  });

  it('countdown uses server time and never goes negative', () => {
    const deadline = '2026-10-11T10:00:20.000Z';
    expect(secondsLeft(deadline, Date.parse('2026-10-11T10:00:10.200Z'))).toBe(10);
    expect(secondsLeft(deadline, Date.parse('2026-10-11T10:00:30.000Z'))).toBe(0);
    expect(secondsLeft(null, 0)).toBeNull();
  });

  it('a departed member keeps a readable seat label', () => {
    const members = [{ id: A, displayName: 'Asha' }] as RoomMemberSummary[];
    expect(seatName(members, A)).toBe('Asha');
    expect(seatName(members, B)).toBe('Former player');
  });
});
