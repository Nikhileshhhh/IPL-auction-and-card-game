/**
 * End-game vote arithmetic (rules §12, §15). The electorate N is frozen when
 * the vote opens and includes everyone entitled to vote, online or not.
 * A vote ends the game only with a strict majority of N: Yes > N/2. Votes
 * cast are never the denominator; abstentions, No and ties all fail.
 */

/** Exactly 15 seconds on the database clock; never extended or restarted. */
export const VOTE_WINDOW_MS = 15_000;
/** Measured from a failed vote's resolution. */
export const VOTE_COOLDOWN_MS = 120_000;
/** A room may fail at most this many votes. */
export const VOTE_MAX_FAILURES = 3;

/** Yes votes required: floor(N/2) + 1 (N=1 → 1, N=2 → 2, N=3 → 2, N=4 → 3). */
export function voteThreshold(electorate: number): number {
  if (!Number.isInteger(electorate) || electorate < 1) {
    // N=0 is an invalid running game: never an automatic majority.
    throw new Error('ELECTORATE_EMPTY');
  }
  return Math.floor(electorate / 2) + 1;
}

export interface VoteTally {
  yes: number;
  no: number;
  abstain: number;
  passed: boolean;
}

/** Resolve at expiry from the recorded ballots of the frozen electorate. */
export function tallyVote(
  electorate: number,
  ballots: readonly ('end' | 'continue' | null)[],
): VoteTally {
  if (ballots.length !== electorate) throw new Error('ELECTORATE_MISMATCH');
  const yes = ballots.filter((b) => b === 'end').length;
  const no = ballots.filter((b) => b === 'continue').length;
  return {
    yes,
    no,
    abstain: electorate - yes - no,
    passed: yes >= voteThreshold(electorate),
  };
}
