import type { AuctionRules } from './types';

/**
 * Auction invariants (rules §1.4, §8): every player has at most one owner,
 * purses are conserved and never negative, squads and overseas stay in bounds.
 * Returns the violations (empty when the state is sound).
 */
export interface InvariantTeam {
  teamId: string;
  initialPurse: bigint;
  remainingPurse: bigint;
  acquisitions: readonly { playerId: string; charged: bigint; overseas: boolean }[];
}

export function auctionViolations(rules: AuctionRules, teams: readonly InvariantTeam[]): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string>();
  for (const t of teams) {
    const spent = t.acquisitions.reduce((s, a) => s + a.charged, 0n);
    if (t.remainingPurse < 0n) problems.push(`${t.teamId}: negative purse`);
    if (t.initialPurse !== spent + t.remainingPurse)
      problems.push(`${t.teamId}: purse not conserved`);
    if (t.acquisitions.length > rules.squadMax)
      problems.push(`${t.teamId}: squad over ${rules.squadMax}`);
    if (t.acquisitions.filter((a) => a.overseas).length > rules.overseasMax) {
      problems.push(`${t.teamId}: over ${rules.overseasMax} overseas`);
    }
    for (const a of t.acquisitions) {
      const other = owners.get(a.playerId);
      if (other) problems.push(`${a.playerId}: owned by ${other} and ${t.teamId}`);
      owners.set(a.playerId, t.teamId);
    }
  }
  return problems;
}
