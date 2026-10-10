/**
 * Official IPL player headshots (players in their franchise jersey for that
 * season), imported under the operator's stated licence (ADR-019 §2a).
 * Only the constant squad feeds below are read (www.iplt20.com team API, one per
 * franchise and season), and only headshot URLs of the exact
 * `https://www.iplt20.com/api/team-assets?pathname=player/…png` form are accepted;
 * they are downloaded through the player-sheet path (loadPhoto). Matching is
 * strict: a name tie or a miss is reported, never guessed.
 */

export const IPL_SITE_HOST = 'www.iplt20.com';
export const HEADSHOT_HOSTS = [IPL_SITE_HOST] as const;

export const IPL_TEAM_SLUGS: readonly [string, string][] = [
  ['Chennai Super Kings', 'chennai-super-kings'],
  ['Mumbai Indians', 'mumbai-indians'],
  ['Royal Challengers Bengaluru', 'royal-challengers-bengaluru'],
  ['Kolkata Knight Riders', 'kolkata-knight-riders'],
  ['Sunrisers Hyderabad', 'sunrisers-hyderabad'],
  ['Rajasthan Royals', 'rajasthan-royals'],
  ['Delhi Capitals', 'delhi-capitals'],
  ['Punjab Kings', 'punjab-kings'],
  ['Gujarat Titans', 'gujarat-titans'],
  ['Lucknow Super Giants', 'lucknow-super-giants'],
];

/** The team's squad feed for one season (the same data the squad page renders). */
export function squadFeedUrl(slug: string, season: number): string {
  if (!/^[a-z-]{3,40}$/.test(slug) || !Number.isInteger(season)) throw new Error('bad squad feed');
  return `https://${IPL_SITE_HOST}/api/bff/cms/teams/${slug}?tab=squad&season=${season}`;
}

export function squadPageUrl(slug: string): string {
  return `https://${IPL_SITE_HOST}/teams/${slug}/squad`;
}

export interface SquadEntry {
  team: string;
  season: number;
  name: string;
  headshotUrl: string;
  /** Cricket nation: ISO 3166-1 alpha-2, England → GB, West Indies → WI (ADR-019 §1b). */
  country: string | null;
  /** The IPL's own player ID: the same person in every season and franchise. */
  iplPlayerId: number | null;
}

const HEADSHOT_PATH = /^player\/\d{1,8}\/\d{1,8}\/\d{1,10}\.png$/;

/** Accept only the IPL's own player headshot asset URL; anything else is dropped. */
export function headshotUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    const pathname = u.searchParams.get('pathname') ?? '';
    if (
      u.protocol !== 'https:' ||
      u.hostname !== IPL_SITE_HOST ||
      u.pathname !== '/api/team-assets' ||
      !HEADSHOT_PATH.test(pathname)
    ) {
      return null;
    }
    const clean = new URL(`https://${IPL_SITE_HOST}/api/team-assets`);
    clean.searchParams.set('pathname', pathname);
    return clean.toString();
  } catch {
    return null;
  }
}

function isoCountry(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const c = code.trim().toLowerCase();
  if (c.startsWith('gb-')) return 'GB';
  return /^[a-z]{2}$/.test(c) ? c.toUpperCase() : null;
}

/** Feed `externalId`, else the last number of the headshot path (player/<s>/<team>/<id>.png). */
export function playerIdOf(externalId: unknown, headshot: string): number | null {
  if (typeof externalId === 'number' && Number.isSafeInteger(externalId) && externalId > 0)
    return externalId;
  const m = /player\/\d+\/\d+\/(\d+)\.png$/.exec(
    new URL(headshot).searchParams.get('pathname') ?? '',
  );
  return m?.[1] ? Number(m[1]) : null;
}

/** Squad feed JSON → players with their headshot for that season. */
export function parseSquadFeed(json: unknown, team: string, season: number): SquadEntry[] {
  const players = (json as { data?: { squad?: { players?: unknown } } }).data?.squad?.players;
  if (!Array.isArray(players)) return [];
  const out = new Map<string, SquadEntry>();
  for (const p of players as Record<string, unknown>[]) {
    const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : '';
    const url = headshotUrl(p.imageUrl);
    if (!name || name.length > 60 || !url) continue;
    const key = normName(name);
    if (!key || out.has(key)) continue;
    out.set(key, {
      team,
      season,
      name,
      headshotUrl: url,
      country: isoCountry(p.countryCode),
      iplPlayerId: playerIdOf(p.externalId, url),
    });
  }
  return [...out.values()];
}

/** Lowercase, accents and punctuation removed, single spaces. */
export function normName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\(\d+\)/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "Virat Kohli" / "V Kohli" → "v kohli". */
function initialSurname(s: string): string | null {
  const t = normName(s).split(' ');
  if (t.length < 2) return null;
  const first = t[0] ?? '';
  const last = t[t.length - 1] ?? '';
  return first && last ? `${first[0]} ${last}` : null;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cur = row[j] ?? 0;
      row[j] = Math.min(cur + 1, (row[j - 1] ?? 0) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * Initials + surname, and the first names must agree when both are spelled out:
 * Cricsheet initials ("MS", "P") always agree; "Mitch"/"Mitchell" and
 * "Nicolas"/"Nicholas" agree; "Harpreet"/"Harnoor" do not.
 */
export function sameInitialSurname(a: string, b: string): boolean {
  const ka = initialSurname(a);
  if (!ka || ka !== initialSurname(b)) return false;
  const fa = a.trim().split(/\s+/)[0] ?? '';
  const fb = b.trim().split(/\s+/)[0] ?? '';
  const initials = (f: string) => /^[A-Z]{1,3}$/.test(f.replace(/\./g, ''));
  if (initials(fa) || initials(fb)) return true;
  const x = normName(fa);
  const y = normName(fb);
  return x.startsWith(y) || y.startsWith(x) || editDistance(x, y) <= 2;
}

/**
 * Same person, different spelling (one contained in the other, e.g. "Sai Kishore" /
 * "Ravisrinivasan Sai Kishore", "Yudhvir Singh" / "Yudhvir Singh Charak"; or same
 * first name with a surname at most two letters apart, e.g. "Sooryavanshi" /
 * "Suryavanshi"). Only used within the same franchise.
 */
export function nearName(a: string, b: string): boolean {
  const x = normName(a).split(' ').filter(Boolean);
  const y = normName(b).split(' ').filter(Boolean);
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 2) {
    const s = short.join(' ');
    if (long.slice(0, short.length).join(' ') === s || long.slice(-short.length).join(' ') === s)
      return true;
  }
  const lx = x[x.length - 1] ?? '';
  const ly = y[y.length - 1] ?? '';
  return (
    x.length >= 2 &&
    y.length >= 2 &&
    x[0] === y[0] &&
    Math.min(lx.length, ly.length) >= 6 &&
    editDistance(lx, ly) <= 2
  );
}

/**
 * Hand-verified alternate names the IPL uses (pack name → IPL name), applied only
 * within the same franchise.
 */
export const IPL_NAME_ALIASES: ReadonlyMap<string, string> = new Map([
  ['rasikh salam', 'rasikh dar'], // Rasikh Salam Dar
  ['sumit kumar', 'sumit beniwal'], // Sumit Kumar Beniwal
]);

/** Players best known by their initials; never expanded to the IPL's long form. */
export const KNOWN_BY_INITIALS: ReadonlySet<string> = new Set(['MS Dhoni', 'KL Rahul']);

/** Cricsheet initials ("DS Rathi") give way to the IPL's full name, except known short names. */
export function preferredName(current: string, ipl: string): string | null {
  if (KNOWN_BY_INITIALS.has(current) || !/^[A-Z]{1,3} /.test(current)) return null;
  return ipl.slice(0, 80);
}

const aliasOf = (a: string, b: string) => IPL_NAME_ALIASES.get(normName(b)) === normName(a);

export interface PackPlayer {
  id: string;
  /** Every known spelling: current (Wikidata) full name, Cricsheet register names. */
  names: readonly string[];
  team: string | null;
}

export type MatchHow = 'full-name' | 'initial-surname' | 'near-name' | 'alias';

export interface MatchResult {
  matches: { player: PackPlayer; entry: SquadEntry; how: MatchHow }[];
  ambiguous: { entry: SquadEntry; candidates: string[] }[];
  unmatchedEntries: SquadEntry[];
  unmatchedPlayers: PackPlayer[];
}

/**
 * One-to-one matching in two strict stages. A pair is accepted only when the
 * squad entry has exactly one candidate player and that player exactly one
 * candidate entry; initials+surname additionally requires the same franchise.
 */
export function matchHeadshots(
  entries: readonly SquadEntry[],
  players: readonly PackPlayer[],
  options: { requireTeam?: boolean } = {},
): MatchResult {
  const result: MatchResult = {
    matches: [],
    ambiguous: [],
    unmatchedEntries: [],
    unmatchedPlayers: [],
  };
  const takenE = new Set<SquadEntry>();
  const takenP = new Set<PackPlayer>();
  const lastAmbiguous = new Map<SquadEntry, string[]>();

  const stage = (
    how: MatchHow,
    same: (entryName: string, playerName: string) => boolean,
    sameTeam: boolean,
  ) => {
    const pairs: [SquadEntry, PackPlayer][] = [];
    for (const e of entries) {
      if (takenE.has(e)) continue;
      for (const p of players) {
        if (takenP.has(p)) continue;
        if ((sameTeam || options.requireTeam) && p.team !== e.team) continue;
        if (p.names.some((n) => same(e.name, n))) pairs.push([e, p]);
      }
    }
    const byE = new Map<SquadEntry, PackPlayer[]>();
    const byP = new Map<PackPlayer, SquadEntry[]>();
    for (const [e, p] of pairs) {
      byE.set(e, [...(byE.get(e) ?? []), p]);
      byP.set(p, [...(byP.get(p) ?? []), e]);
    }
    for (const [e, ps] of byE) {
      const p = ps[0];
      if (ps.length === 1 && p && byP.get(p)?.length === 1) {
        result.matches.push({ player: p, entry: e, how });
        takenE.add(e);
        takenP.add(p);
        lastAmbiguous.delete(e);
      } else {
        lastAmbiguous.set(
          e,
          ps.map((x) => x.names[0] ?? x.id),
        );
      }
    }
  };

  stage('full-name', (a, b) => normName(a) !== '' && normName(a) === normName(b), false);
  stage('initial-surname', sameInitialSurname, true);
  stage('near-name', nearName, true);
  stage('alias', aliasOf, true);

  for (const e of entries) {
    if (takenE.has(e)) continue;
    const c = lastAmbiguous.get(e);
    if (c && c.length > 0) result.ambiguous.push({ entry: e, candidates: c });
    else result.unmatchedEntries.push(e);
  }
  result.unmatchedPlayers = players.filter((p) => !takenP.has(p));
  return result;
}

/**
 * The jersey should match the franchise shown on the card: first the latest
 * season the player was in that franchise's squad, then (for players whose card
 * franchise has no headshot) the latest squad of any franchise.
 */
export function matchBySeason(
  entries: readonly SquadEntry[],
  players: readonly PackPlayer[],
  options: { anyTeamSeasons?: ReadonlySet<number> } = {},
): MatchResult {
  const seasons = [...new Set(entries.map((e) => e.season))].sort((a, b) => b - a);
  const total: MatchResult = {
    matches: [],
    ambiguous: [],
    unmatchedEntries: [],
    unmatchedPlayers: [...players],
  };
  const used = new Set<SquadEntry>();
  for (const requireTeam of [true, false]) {
    for (const season of seasons) {
      // Older fallback seasons are trusted only for the franchise on the card.
      if (!requireTeam && options.anyTeamSeasons && !options.anyTeamSeasons.has(season)) continue;
      const r = matchHeadshots(
        entries.filter((e) => e.season === season && !used.has(e)),
        total.unmatchedPlayers,
        { requireTeam },
      );
      for (const m of r.matches) used.add(m.entry);
      total.matches.push(...r.matches);
      if (!requireTeam) total.ambiguous.push(...r.ambiguous);
      total.unmatchedPlayers = r.unmatchedPlayers;
    }
  }
  total.unmatchedEntries = entries.filter((e) => !used.has(e));
  return total;
}

/**
 * Archive fallback (ADR-019 §2a): earlier-season headshots of the *same IPL player
 * ID*, any franchise, newest first; the card's franchise wins within a season.
 * Identity rests on the IPL's own ID, never on a name.
 */
export function archiveCandidates(
  entries: readonly SquadEntry[],
  playerIds: ReadonlySet<number>,
  cardTeam: string | null,
): SquadEntry[] {
  return entries
    .filter((e) => e.iplPlayerId !== null && playerIds.has(e.iplPlayerId))
    .sort(
      (a, b) =>
        b.season - a.season ||
        Number(b.team === cardTeam) - Number(a.team === cardTeam) ||
        a.team.localeCompare(b.team),
    );
}

/** Fetch one constant squad feed politely (contact UA, 429 backoff, same host only). */
export async function fetchSquadFeed(
  url: string,
  options: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== IPL_SITE_HOST) {
    throw new Error(`host not allowed: ${parsed.hostname}`);
  }
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt += 1) {
    const res = await (options.fetchImpl ?? fetch)(parsed, {
      headers: {
        'user-agent':
          'STUMPS-licensed-photo-import/1.0 (https://github.com/Nikhileshhhh/IPL-auction-and-card-game)',
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await sleep(15_000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${parsed.hostname}`);
    return res.json();
  }
}
