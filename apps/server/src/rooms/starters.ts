import type { Tx } from '../db/transaction';
import type { EventDraft } from './streams';
import type { MemberRow } from './projection';
import type { RoomRow } from './room-tx';

/**
 * Game engines plug in here (card: phase 07, auction: phase 10). Until a
 * starter is registered for a game type, start validation runs but the room
 * stays in the lobby with an explicit ENGINE_UNAVAILABLE reason — never a fake start.
 */
export interface GameStarter {
  /** Validate engine prerequisites and initialize state inside the room transaction. */
  start(
    tx: Tx,
    room: RoomRow,
    players: MemberRow[],
    now: Date,
  ): Promise<{ phase: string; dataVersionId: string; events: EventDraft[] }>;
}

export class StarterRegistry {
  private readonly starters = new Map<'card' | 'auction', GameStarter>();
  register(gameType: 'card' | 'auction', starter: GameStarter) {
    this.starters.set(gameType, starter);
  }
  get(gameType: 'card' | 'auction'): GameStarter | undefined {
    return this.starters.get(gameType);
  }
}
