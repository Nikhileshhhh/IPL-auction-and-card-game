/**
 * Freely licensed player photos from Wikimedia Commons, located through
 * Wikidata (ESPNcricinfo ID → item → name and image). Only these allowlisted
 * hosts are ever contacted; no user-supplied URL is fetched. Official IPL /
 * BCCI / agency photos are not used: a photo must carry an allowlisted free
 * licence on Commons, and its author and licence are recorded and credited.
 */
export const ALLOWED_HOSTS = new Set([
  'commons.wikimedia.org',
  'upload.wikimedia.org',
  'query.wikidata.org',
  // Infobox facts (batting/bowling style) only; see cricket-data/facts.ts.
  'en.wikipedia.org',
]);

/** Wikimedia's User-Agent policy requires a contact URL; generic agents get HTTP 429. */
export const USER_AGENT =
  'STUMPS-catalog-import/1.0 (https://github.com/Nikhileshhhh/IPL-auction-and-card-game) Node.js';

/** Licences that allow reuse with attribution in a private game. */
const FREE_LICENCE = /^(cc0|public domain|pd|cc[ -]by(-sa)?[ -]\d(\.\d)?|cc[ -]by(-sa)?$)/i;

export function isFreeLicence(shortName: string | undefined | null): boolean {
  return !!shortName && FREE_LICENCE.test(shortName.trim());
}

const IPL_TERMS = [
  'indian premier league',
  'ipl',
  'chennai super kings',
  'mumbai indians',
  'royal challengers',
  'kolkata knight riders',
  'sunrisers hyderabad',
  'rajasthan royals',
  'delhi capitals',
  'delhi daredevils',
  'punjab kings',
  'kings xi punjab',
  'gujarat titans',
  'lucknow super giants',
];

export interface CommonsCandidate {
  title: string;
  mime: string;
  width: number;
  height: number;
  thumbUrl: string;
  pageUrl: string;
  licence: string;
  licenceUrl: string | null;
  artist: string;
  categories: string[];
  description: string;
}

/** Strip HTML from Commons extmetadata values (Artist is often a link). */
export function plainText(html: string | undefined | null): string {
  return (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

interface CommonsPage {
  title: string;
  categories?: { title: string }[];
  imageinfo?: {
    mime?: string;
    width?: number;
    height?: number;
    thumburl?: string;
    descriptionurl?: string;
    extmetadata?: Record<string, { value?: string }>;
  }[];
}

/** Turn a Commons API `query.pages` object into candidates. */
export function parseCommonsPages(json: unknown): CommonsCandidate[] {
  const pages = (json as { query?: { pages?: Record<string, CommonsPage> } }).query?.pages ?? {};
  const out: CommonsCandidate[] = [];
  for (const page of Object.values(pages)) {
    const info = page.imageinfo?.[0];
    if (!info?.thumburl || !info.descriptionurl) continue;
    const meta = info.extmetadata ?? {};
    out.push({
      title: page.title,
      mime: info.mime ?? '',
      width: info.width ?? 0,
      height: info.height ?? 0,
      thumbUrl: info.thumburl,
      pageUrl: info.descriptionurl,
      licence: plainText(meta.LicenseShortName?.value),
      licenceUrl: meta.LicenseUrl?.value ?? null,
      artist: plainText(meta.Artist?.value) || 'Unknown author',
      categories: (page.categories ?? []).map((c) => c.title.replace(/^Category:/, '')),
      description: plainText(meta.ImageDescription?.value),
    });
  }
  return out;
}

export interface PhotoChoice {
  candidate: CommonsCandidate;
  score: number;
  iplKit: boolean;
}

/**
 * Pick the best photo of `fullName`: free licence and a name match are
 * mandatory; IPL/franchise context (the user wants players in IPL kit),
 * the player's own team, portrait orientation and resolution add score;
 * group shots and logos are penalised.
 */
export function choosePhoto(
  candidates: readonly CommonsCandidate[],
  fullName: string,
  team: string | null,
): PhotoChoice | null {
  const tokens = fullName
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const surname = tokens[tokens.length - 1] ?? '';
  let best: PhotoChoice | null = null;
  for (const c of candidates) {
    if (!isFreeLicence(c.licence)) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(c.mime)) continue;
    if (c.width < 300 || c.height < 300) continue;
    const text = `${c.title} ${c.categories.join(' ')} ${c.description}`.toLowerCase();
    if (!surname || !text.includes(surname)) continue;
    let score = 10;
    score += tokens.filter((t) => text.includes(t)).length * 3;
    // Off-field occasions (ceremonies, awards, launches) rarely show the playing jersey.
    const offField =
      /ceremon|award|launch|press|promot|premiere|wedding|meet|visit|event|felicitat/.test(
        c.title.toLowerCase(),
      );
    const iplKit =
      !offField && IPL_TERMS.some((t) => (t === 'ipl' ? /\bipl\b/.test(text) : text.includes(t)));
    if (iplKit) score += 20;
    if (team && text.includes(team.toLowerCase())) score += 10;
    if (c.height >= c.width) score += 4;
    if (Math.min(c.width, c.height) >= 800) score += 3;
    if (/ and | with |team|squad|group|logo|emblem|crest|stadium/.test(c.title.toLowerCase()))
      score -= 15;
    if (!best || score > best.score) best = { candidate: c, score, iplKit };
  }
  return best;
}

export function attributionFor(c: CommonsCandidate): string {
  return `Photo: ${c.artist}, ${c.licence}, via Wikimedia Commons`.slice(0, 300);
}

export interface WikidataPerson {
  cricinfo: string;
  label: string | null;
  imageFile: string | null;
}

/** SPARQL for a batch of ESPNcricinfo IDs (P2697) → English label and image (P18). */
export function wikidataQuery(cricinfoIds: readonly string[]): string {
  const values = cricinfoIds
    .filter((id) => /^\d{1,10}$/.test(id))
    .map((id) => `"${id}"`)
    .join(' ');
  return `SELECT ?cid ?label ?img WHERE {
  VALUES ?cid { ${values} }
  ?item wdt:P2697 ?cid .
  OPTIONAL { ?item wdt:P18 ?img . }
  OPTIONAL { ?item rdfs:label ?label . FILTER(LANG(?label) = "en") }
}`;
}

export function parseWikidata(json: unknown): WikidataPerson[] {
  const rows =
    (json as { results?: { bindings?: Record<string, { value: string }>[] } }).results?.bindings ??
    [];
  const byId = new Map<string, WikidataPerson>();
  for (const r of rows) {
    const cid = r.cid?.value;
    if (!cid || byId.has(cid)) continue;
    const img = r.img?.value ?? null;
    byId.set(cid, {
      cricinfo: cid,
      label: r.label?.value ?? null,
      imageFile: img ? decodeURIComponent(img.split('/Special:FilePath/')[1] ?? '') || null : null,
    });
  }
  return [...byId.values()];
}

/** Fetch JSON/bytes from an allowlisted Wikimedia host only. */
export async function fetchAllowed(
  url: string,
  as: 'json' | 'bytes',
  options: { retries?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<unknown> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`host not allowed: ${parsed.hostname}`);
  }
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(parsed, {
      headers: {
        'user-agent': USER_AGENT,
        accept: as === 'json' ? 'application/sparql-results+json, application/json' : 'image/*',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(60_000),
    });
    // Wikimedia rate limits: honour Retry-After (bounded), then give up.
    if ((res.status === 429 || res.status === 503) && attempt < (options.retries ?? 4)) {
      const after = Number(res.headers.get('retry-after'));
      await sleep(
        Math.min(Number.isFinite(after) && after > 0 ? after * 1000 : 0, 120_000) ||
          15_000 * 2 ** attempt,
      );
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${parsed.hostname}`);
    if (as === 'json') return res.json();
    const length = Number(res.headers.get('content-length') ?? '0');
    if (length > 8 * 1024 * 1024) throw new Error('image too large');
    return Buffer.from(await res.arrayBuffer());
  }
}

export function commonsSearchUrl(query: string): string {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '12',
    prop: 'imageinfo|categories',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '1280',
    cllimit: '50',
  }).toString();
  return u.toString();
}

export function commonsFileUrl(fileName: string): string {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  u.search = new URLSearchParams({
    action: 'query',
    format: 'json',
    titles: `File:${fileName}`,
    prop: 'imageinfo|categories',
    iiprop: 'url|mime|size|extmetadata',
    iiurlwidth: '1280',
    cllimit: '50',
  }).toString();
  return u.toString();
}

export function wikidataUrl(query: string): string {
  const u = new URL('https://query.wikidata.org/sparql');
  u.search = new URLSearchParams({ query, format: 'json' }).toString();
  return u.toString();
}
