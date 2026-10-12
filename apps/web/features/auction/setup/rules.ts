/**
 * The real IPL mega-auction rules shown before a room exists (S14). The server
 * binds the room to the published ruleset and the room screens show its values;
 * these lines describe the same rules (ADR-024) with their sources.
 */
export const IPL_RULES_SUMMARY: readonly {
  label: string;
  value: string;
  source: 'official' | 'reported';
}[] = [
  { label: 'Purse', value: '₹120 crore per franchise', source: 'official' },
  { label: 'Squad', value: '18 to 25 players, at most 8 overseas', source: 'reported' },
  {
    label: 'Retentions and RTM',
    value: 'Up to 6 in total: at most 5 capped and 2 uncapped',
    source: 'official',
  },
  {
    label: 'Retention cost',
    value: '₹18, 14, 11, 18 and 14 crore for capped players; ₹4 crore per uncapped player',
    source: 'reported',
  },
  {
    label: 'Uncapped Indians',
    value: 'No international match in the last five years',
    source: 'official',
  },
];

export const IPL_RULES_SOURCE = {
  title: 'TATA IPL Player Regulations 2025–27 (IPL press release, 28 Sep 2024)',
  url: 'https://www.iplt20.com/news/4109/ipl-governing-council-announces-tata-ipl-player-regulations-2025-27',
};
