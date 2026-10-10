import type { CricsheetDelivery, CricsheetMatch } from '../cricket/cricsheet';

/**
 * Deterministic fictional T20 league in Cricsheet JSON shape. Every name, team
 * and number is invented (route B: no real people, no official data); it lets
 * the full import → ratings → publish pipeline run offline in CI.
 */
export interface DemoPlayer {
  id: string;
  name: string;
  team: string;
  role: 'batter' | 'bowler' | 'all_rounder' | 'wicketkeeper';
  country: string;
  bat: number; // 0..1 hidden skill
  bowl: number;
  kit: [string, string];
}

export const DEMO_TEAMS: { name: string; kit: [string, string] }[] = [
  { name: 'Harbour City Hawks', kit: ['#1E5AA8', '#F2C230'] },
  { name: 'Desert Rose Royals', kit: ['#C2185B', '#FFD54F'] },
  { name: 'Monsoon Bay Mariners', kit: ['#00796B', '#E0F2F1'] },
  { name: 'Highland Thunder', kit: ['#4527A0', '#B39DDB'] },
  { name: 'Coastal Comets', kit: ['#EF6C00', '#263238'] },
  { name: 'Riverside Rangers', kit: ['#2E7D32', '#C5E1A5'] },
  { name: 'Golden Plains Gladiators', kit: ['#B8860B', '#3E2723'] },
  { name: 'Northern Lights Strikers', kit: ['#0277BD', '#B3E5FC'] },
];

const FIRST = [
  'Arin',
  'Bodhi',
  'Cael',
  'Daksh',
  'Eshan',
  'Faraz',
  'Gavin',
  'Hiran',
  'Ivo',
  'Jasper',
  'Kiaan',
  'Lior',
  'Madan',
  'Niko',
  'Omar',
  'Pavan',
  'Quinn',
  'Rohan',
  'Sami',
  'Tarun',
  'Uday',
  'Veer',
  'Wren',
  'Yash',
  'Zane',
  'Abel',
  'Bran',
  'Cyrus',
  'Dev',
  'Elio',
];
const LAST = [
  'Arkwright',
  'Bhandari',
  'Castell',
  'Dorai',
  'Eastwood',
  'Fenwick',
  'Gaikar',
  'Holloway',
  'Iyengar-Ross',
  'Jardine',
  'Kestrel',
  'Lomax',
  'Madhavi',
  'Northcott',
  'Okonkwo',
  'Pellow',
  'Quarry',
  'Rathore-Hale',
  'Sandoval',
  'Thackery',
  'Upton',
  'Varga',
  'Whitlock',
  'Yarrow',
];
const COUNTRIES = ['IN', 'IN', 'IN', 'IN', 'AU', 'GB', 'ZA', 'NZ', 'AF', 'LK', 'WI'] as const;

/** mulberry32: tiny seeded PRNG (fixtures only, never in engines). */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROLE_PLAN: DemoPlayer['role'][] = [
  'batter',
  'batter',
  'wicketkeeper',
  'batter',
  'batter',
  'all_rounder',
  'all_rounder',
  'bowler',
  'bowler',
  'bowler',
  'bowler',
  'batter',
  'bowler',
  'all_rounder',
];

export function demoPlayers(seed = 2026): DemoPlayer[] {
  const rnd = prng(seed);
  const used = new Set<string>();
  const players: DemoPlayer[] = [];
  DEMO_TEAMS.forEach((team, t) => {
    ROLE_PLAN.forEach((role, i) => {
      let name: string;
      do {
        name = `${FIRST[Math.floor(rnd() * FIRST.length)]} ${LAST[Math.floor(rnd() * LAST.length)]}`;
      } while (used.has(name));
      used.add(name);
      const base = rnd();
      players.push({
        id: `demo${String(t * 100 + i).padStart(4, '0')}`,
        name,
        team: team.name,
        role,
        country: COUNTRIES[Math.floor(rnd() * COUNTRIES.length)] ?? 'IN',
        bat:
          role === 'bowler'
            ? 0.1 + 0.2 * base
            : role === 'all_rounder'
              ? 0.45 + 0.4 * base
              : 0.5 + 0.5 * base,
        bowl:
          role === 'batter' || role === 'wicketkeeper'
            ? 0.05 * base
            : role === 'all_rounder'
              ? 0.45 + 0.4 * rnd()
              : 0.5 + 0.5 * rnd(),
        kit: team.kit,
      });
    });
  });
  return players;
}

function simulateInnings(
  rnd: () => number,
  batting: DemoPlayer[],
  bowling: DemoPlayer[],
  target: number | null,
) {
  const order = [...batting].sort((a, b) => b.bat - a.bat);
  const bowlers = [...bowling]
    .filter((p) => p.bowl > 0.3)
    .sort((a, b) => b.bowl - a.bowl)
    .slice(0, 5);
  const fielders = bowling;
  const keeper = bowling.find((p) => p.role === 'wicketkeeper') ?? bowling[0];
  const overs: { over: number; deliveries: CricsheetDelivery[] }[] = [];
  let striker = 0;
  let nonStriker = 1;
  let next = 2;
  let wickets = 0;
  let total = 0;
  for (let over = 0; over < 20 && wickets < 10; over += 1) {
    const bowler = bowlers[over % bowlers.length] ?? bowling[0];
    if (!bowler || !keeper) break;
    const deliveries: CricsheetDelivery[] = [];
    let legal = 0;
    while (legal < 6 && wickets < 10) {
      const bat = order[striker];
      const non = order[nonStriker];
      if (!bat || !non) break;
      const phaseBoost = over < 6 || over >= 15 ? 0.06 : 0;
      const r = rnd();
      const d: CricsheetDelivery = {
        batter: bat.name,
        bowler: bowler.name,
        non_striker: non.name,
        runs: { batter: 0, extras: 0, total: 0 },
      };
      const wicketChance = 0.035 + 0.06 * bowler.bowl - 0.04 * bat.bat;
      if (r < 0.03) {
        d.extras = { wides: 1 };
        d.runs = { batter: 0, extras: 1, total: 1 };
      } else if (r < 0.04) {
        const off = rnd() < 0.3 ? 4 : 1;
        d.extras = { noballs: 1 };
        d.runs = { batter: off, extras: 1, total: off + 1 };
      } else if (r < 0.04 + Math.max(0.01, wicketChance)) {
        const k = rnd();
        const fielder = fielders[Math.floor(rnd() * fielders.length)] ?? bowler;
        const kind =
          k < 0.5
            ? 'caught'
            : k < 0.7
              ? 'bowled'
              : k < 0.82
                ? 'lbw'
                : k < 0.9
                  ? 'run out'
                  : k < 0.96
                    ? 'stumped'
                    : 'caught and bowled';
        d.wickets = [
          {
            player_out: bat.name,
            kind,
            ...(kind === 'caught' || kind === 'run out'
              ? { fielders: [{ name: fielder.name }] }
              : kind === 'stumped'
                ? { fielders: [{ name: keeper.name }] }
                : {}),
          },
        ];
        wickets += 1;
        striker = next;
        next += 1;
      } else if (r < 0.06) {
        d.extras = { legbyes: 1 };
        d.runs = { batter: 0, extras: 1, total: 1 };
      } else {
        const s = rnd() + 0.35 * bat.bat - 0.2 * bowler.bowl + phaseBoost;
        const runs = s < 0.45 ? 0 : s < 0.8 ? 1 : s < 0.92 ? 2 : s < 1.12 ? 4 : 6;
        d.runs = { batter: runs, extras: 0, total: runs };
        if (runs % 2 === 1) [striker, nonStriker] = [nonStriker, striker];
      }
      total += d.runs.total;
      deliveries.push(d);
      if (!d.extras?.wides && !d.extras?.noballs) legal += 1;
      if (target !== null && total >= target) break;
    }
    overs.push({ over, deliveries });
    [striker, nonStriker] = [nonStriker, striker];
    if (target !== null && total >= target) break;
  }
  return { overs, total };
}

/** A full league: every team plays every other once per season. */
export function generateDemoLeague(options: { seed?: number; seasons?: number[] } = {}): {
  players: DemoPlayer[];
  matches: CricsheetMatch[];
} {
  const seed = options.seed ?? 2026;
  const seasons = options.seasons ?? [2023, 2024, 2025];
  const players = demoPlayers(seed);
  const rnd = prng(seed + 1);
  const matches: CricsheetMatch[] = [];
  for (const season of seasons) {
    let day = 0;
    for (let i = 0; i < DEMO_TEAMS.length; i += 1) {
      for (let j = i + 1; j < DEMO_TEAMS.length; j += 1) {
        const a = DEMO_TEAMS[i];
        const b = DEMO_TEAMS[j];
        if (!a || !b) continue;
        day += 1;
        const squad = (team: string) => {
          const all = players.filter((p) => p.team === team);
          const xi = all.slice(0, 11);
          // Reserves rotate in: swap one of positions 7–10 for one of 11–13 sometimes.
          if (rnd() < 0.35) {
            const out = 7 + Math.floor(rnd() * 4);
            const reserve = all[11 + Math.floor(rnd() * 3)];
            if (reserve) xi[out] = reserve;
          }
          return xi;
        };
        const xiA = squad(a.name);
        const xiB = squad(b.name);
        const first = simulateInnings(rnd, xiA, xiB, null);
        const second = simulateInnings(rnd, xiB, xiA, first.total + 1);
        const date = `${season}-04-${String(Math.min(28, 1 + Math.floor(day / 1.1))).padStart(2, '0')}`;
        const people: Record<string, string> = {};
        for (const p of [...xiA, ...xiB]) people[p.name] = p.id;
        matches.push({
          meta: { data_version: '1.1.0', created: `${season}-06-01`, revision: 1 },
          info: {
            dates: [date],
            event: { name: 'Demo Premier League', match_number: day },
            gender: 'male',
            match_type: 'T20',
            season,
            teams: [a.name, b.name],
            players: { [a.name]: xiA.map((p) => p.name), [b.name]: xiB.map((p) => p.name) },
            registry: { people },
          },
          innings: [
            { team: a.name, overs: first.overs },
            { team: b.name, overs: second.overs },
          ],
        });
      }
    }
  }
  return { players, matches };
}
