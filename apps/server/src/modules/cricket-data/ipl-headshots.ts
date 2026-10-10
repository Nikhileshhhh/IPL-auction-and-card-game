/**
 * Official IPL player headshots (players in franchise jersey), imported under
 * the operator's stated licence (ADR-019 §2a). Only the constant squad pages
 * below are fetched, only from www.iplt20.com; headshots are downloaded through
 * the player-sheet path (loadPhoto) from documents.iplt20.com only. Matching is
 * strict: a name tie or a miss is reported, never guessed.
 */

export const IPL_SITE_HOST = 'www.iplt20.com';
export const HEADSHOT_HOSTS = ['documents.iplt20.com'] as const;

const SLUGS: readonly [string, string][] = [
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

export const IPL_SQUAD_PAGES: readonly { team: string; url: string }[] = SLUGS.map(
  ([team, slug]) => ({ team, url: `https://${IPL_SITE_HOST}/teams/${slug}/squad` }),
);

export interface SquadEntry {
  team: string;
  name: string;
  headshotUrl: string;
  profileUrl: string | null;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  '#39': "'",
  nbsp: ' ',
  rsquo: '’',
  eacute: 'é',
  aacute: 'á',
  iacute: 'í',
  oacute: 'ó',
  uuml: 'ü',
};
const decode = (s: string) =>
  s
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const k = e.toLowerCase();
      if (ENTITIES[k] !== undefined) return ENTITIES[k];
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(Number(k.slice(1)));
      return m;
    })
    .replace(/\s+/g, ' ')
    .trim();

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? decode(m[2] ?? m[3] ?? '') : null;
};

/** First https URL on an allowed headshot host, or null. */
function headshotFrom(tag: string): string | null {
  const raw = [
    attr(tag, 'data-src'),
    attr(tag, 'data-lazy-src'),
    attr(tag, 'src'),
    ...(attr(tag, 'srcset') ?? attr(tag, 'data-srcset') ?? '').split(',').map((s) => s.trim()),
  ];
  for (const candidate of raw) {
    const url = candidate?.split(/\s+/)[0];
    if (!url) continue;
    try {
      const u = new URL(url);
      if (u.protocol === 'https:' && (HEADSHOT_HOSTS as readonly string[]).includes(u.hostname)) {
        return u.toString();
      }
    } catch {
      /* not a URL */
    }
  }
  return null;
}

const titleFromSlug = (slug: string) =>
  slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/**
 * Squad page → players with their headshot. Each headshot <img> is named by its
 * alt text, else by the nearest preceding data-player_name or profile link.
 */
export function parseSquadPage(html: string, team: string): SquadEntry[] {
  const out = new Map<string, SquadEntry>();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const headshotUrl = headshotFrom(tag);
    if (!headshotUrl) continue;
    const before = html.slice(Math.max(0, (m.index ?? 0) - 1500), m.index ?? 0);
    const profiles = [
      ...before.matchAll(/href\s*=\s*"(https:\/\/www\.iplt20\.com\/players\/([a-z0-9-]+)\/\d+)"/gi),
    ];
    const profile = profiles[profiles.length - 1];
    const dataNames = [...before.matchAll(/data-player_name\s*=\s*"([^"]+)"/gi)];
    const dataName = dataNames[dataNames.length - 1];
    const alt = attr(tag, 'alt');
    // The name source nearest the image belongs to it (a card's own link or attribute).
    const nearest =
      dataName && (dataName.index ?? -1) >= (profile?.index ?? -1)
        ? decode(dataName[1] ?? '')
        : profile?.[2]
          ? titleFromSlug(profile[2])
          : null;
    const name = (alt && !/logo|team|flag|icon|^image$/i.test(alt) ? alt : null) ?? nearest;
    if (!name || name.length > 60) continue;
    const key = normName(name);
    if (!key || out.has(key)) continue;
    out.set(key, { team, name, headshotUrl, profileUrl: profile?.[1] ?? null });
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

export interface PackPlayer {
  id: string;
  /** Every known spelling: Wikidata full name, Cricsheet name. */
  names: readonly string[];
  team: string | null;
}

export interface MatchResult {
  matches: { player: PackPlayer; entry: SquadEntry; how: 'full-name' | 'initial-surname' }[];
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
    how: 'full-name' | 'initial-surname',
    keysOf: (names: readonly string[]) => Set<string>,
    sameTeam: boolean,
  ) => {
    const pairs: [SquadEntry, PackPlayer][] = [];
    for (const e of entries) {
      if (takenE.has(e)) continue;
      const ek = keysOf([e.name]);
      for (const p of players) {
        if (takenP.has(p)) continue;
        if (sameTeam && p.team !== e.team) continue;
        if ([...keysOf(p.names)].some((k) => ek.has(k))) pairs.push([e, p]);
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

  stage('full-name', (names) => new Set(names.map(normName).filter(Boolean)), false);
  stage('initial-surname', (names) => new Set(names.flatMap((n) => initialSurname(n) ?? [])), true);

  for (const e of entries) {
    if (takenE.has(e)) continue;
    const c = lastAmbiguous.get(e);
    if (c && c.length > 0) result.ambiguous.push({ entry: e, candidates: c });
    else result.unmatchedEntries.push(e);
  }
  result.unmatchedPlayers = players.filter((p) => !takenP.has(p));
  return result;
}

/** Fetch one constant squad page politely (contact UA, 429 backoff). */
export async function fetchSquadHtml(
  url: string,
  options: { fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {},
): Promise<string> {
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
        accept: 'text/html',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000),
    });
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      await sleep(15_000 * 2 ** attempt);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${parsed.hostname}`);
    // Redirects must stay on the IPL site.
    if (new URL(res.url || url).hostname !== IPL_SITE_HOST) throw new Error('redirected off-site');
    return res.text();
  }
}
