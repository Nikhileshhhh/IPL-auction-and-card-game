/**
 * Player facts from open reference data (ADR-019): full name and country from
 * Wikidata (via the ESPNcricinfo ID, P2697), batting and bowling style from the
 * English Wikipedia cricketer infobox. Only the allowlisted Wikimedia hosts in
 * media/commons.ts are contacted. Facts are only filled where missing, never
 * guessed: a player without a source value is left for the player sheet.
 */
import { parseBattingStyle } from './manifest';

export interface WikidataFacts {
  cricinfo: string;
  label: string | null;
  /** ISO 3166-1 alpha-2; the cricket nation (P1532) wins over citizenship (P27). */
  country: string | null;
  /** English Wikipedia article title, for the infobox. */
  enwiki: string | null;
}

export function factsQuery(cricinfoIds: readonly string[]): string {
  const values = cricinfoIds
    .filter((id) => /^\d{1,10}$/.test(id))
    .map((id) => `"${id}"`)
    .join(' ');
  return `SELECT ?cid ?label ?sportIso ?citIso ?article WHERE {
  VALUES ?cid { ${values} }
  ?item wdt:P2697 ?cid .
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
  OPTIONAL { ?item wdt:P1532/wdt:P297 ?sportIso . }
  OPTIONAL { ?item wdt:P27/wdt:P297 ?citIso . }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . }
}`;
}

export function parseFacts(json: unknown): WikidataFacts[] {
  const rows =
    (json as { results?: { bindings?: Record<string, { value: string }>[] } }).results?.bindings ??
    [];
  const acc = new Map<
    string,
    { label: string | null; sport: Set<string>; cit: Set<string>; enwiki: string | null }
  >();
  for (const r of rows) {
    const cid = r.cid?.value;
    if (!cid) continue;
    const a = acc.get(cid) ?? { label: null, sport: new Set(), cit: new Set(), enwiki: null };
    a.label ??= r.label?.value ?? null;
    if (r.sportIso?.value) a.sport.add(r.sportIso.value.toUpperCase());
    if (r.citIso?.value) a.cit.add(r.citIso.value.toUpperCase());
    const article = r.article?.value;
    if (!a.enwiki && article?.startsWith('https://en.wikipedia.org/wiki/')) {
      a.enwiki = decodeURIComponent(article.slice('https://en.wikipedia.org/wiki/'.length)).replace(
        /_/g,
        ' ',
      );
    }
    acc.set(cid, a);
  }
  return [...acc].map(([cricinfo, a]) => {
    // A single unambiguous value only; several citizenships without a cricket nation stay open.
    const country =
      a.sport.size === 1 ? [...a.sport][0] : a.cit.size === 1 ? [...a.cit][0] : undefined;
    return { cricinfo, label: a.label, country: country ?? null, enwiki: a.enwiki };
  });
}

/** Strip wiki markup from one infobox value. */
export function wikiPlain(value: string): string {
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function infoboxField(wikitext: string, field: string): string | null {
  const m = new RegExp(`^\\s*\\|\\s*${field}\\s*=([^\\n]*)`, 'im').exec(wikitext);
  if (!m?.[1]) return null;
  const v = wikiPlain(m[1]);
  return v && !/^[-–—]$/.test(v) ? v : null;
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Batting and bowling style from an "Infobox cricketer". */
export function parseInfoboxStyles(wikitext: string): {
  battingStyle: 'right_hand' | 'left_hand' | null;
  bowlingStyle: string | null;
} {
  const bat = infoboxField(wikitext, 'batting');
  const bowl = infoboxField(wikitext, 'bowling');
  const battingStyle = bat
    ? (parseBattingStyle(bat) ??
      (/\bleft/i.test(bat) ? 'left_hand' : /\bright/i.test(bat) ? 'right_hand' : null))
    : null;
  const bowlingStyle =
    bowl && /arm|spin|break|orthodox|pace|fast|medium|chinaman|wrist/i.test(bowl)
      ? capitalise(bowl.replace(/\s*\(.*?\)\s*/g, ' ').trim()).slice(0, 40)
      : null;
  return { battingStyle, bowlingStyle };
}

export function wikipediaContentUrl(titles: readonly string[]): string {
  const u = new URL('https://en.wikipedia.org/w/api.php');
  u.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    titles: titles.join('|'),
  }).toString();
  return u.toString();
}

/** title (after redirects) → wikitext */
export function parseWikipediaContent(json: unknown): Map<string, string> {
  const q = (
    json as {
      query?: {
        pages?: {
          title: string;
          revisions?: { slots?: { main?: { content?: string } } }[];
        }[];
        redirects?: { from: string; to: string }[];
        normalized?: { from: string; to: string }[];
      };
    }
  ).query;
  const out = new Map<string, string>();
  for (const p of q?.pages ?? []) {
    const text = p.revisions?.[0]?.slots?.main?.content;
    if (text) out.set(p.title, text);
  }
  // Map requested titles through normalisation and redirects.
  for (const hop of [...(q?.normalized ?? []), ...(q?.redirects ?? [])]) {
    const text = out.get(hop.to);
    if (text && !out.has(hop.from)) out.set(hop.from, text);
  }
  return out;
}
