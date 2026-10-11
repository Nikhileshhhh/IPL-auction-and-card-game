import { CardEngineError, type MatchState } from './types';

/**
 * Conservation and shape invariants (rules §1, §5, §6.1), checked after every
 * transition and again by the database at commit:
 * - every dealt instance is in exactly one place (a deck, ACTIVE or POT), N in total;
 * - an open comparison's selector is one of its contributors, one card each;
 * - a normal comparison starts with an empty pot; a finished match has none;
 * - eliminated seats hold no cards; a natural winner owns all N.
 */
export function assertInvariants(s: MatchState): void {
  const fail = (msg: string) => {
    throw new CardEngineError('INVARIANT_VIOLATION', msg);
  };
  const seen = new Map<string, number>();
  const see = (id: string) => seen.set(id, (seen.get(id) ?? 0) + 1);
  for (const seat of s.seats) seat.deck.forEach(see);
  s.comparison?.active.forEach((a) => see(a.instanceId));
  s.pot.forEach((p) => see(p.instanceId));

  const ids = Object.keys(s.instances);
  if (ids.length !== s.totalCards) fail('Instance set changed after dealing.');
  if (seen.size !== s.totalCards) fail(`Expected ${s.totalCards} cards, found ${seen.size}.`);
  for (const id of ids) if (seen.get(id) !== 1) fail(`Card ${id} is not in exactly one place.`);

  const c = s.comparison;
  if (c) {
    if (!c.contributors.includes(c.selector)) fail('Selector is not a contributor.');
    if (c.active.length !== c.contributors.length) fail('One active card per contributor.');
    if (new Set(c.active.map((a) => a.memberId)).size !== c.active.length)
      fail('A contributor submitted twice.');
    if (s.tieCount === 0 && s.pot.length > 0) fail('A normal comparison must start with no pot.');
  }
  for (const seat of s.seats) {
    if (seat.eliminationOrder !== null && seat.deck.length > 0)
      fail('Eliminated seat holds cards.');
  }
  if (s.result) {
    if (c || s.pot.length > 0) fail('A finished match has no open comparison or pot.');
    if (s.result.reason === 'natural') {
      const winner = s.seats.find((x) => x.memberId === s.result?.standings[0]);
      if (winner?.deck.length !== s.totalCards) fail('A natural winner must own all cards.');
    }
  }
}
