import { Unzip, UnzipInflate } from 'fflate';
import { CRORE, LAKH, type CappedStatus } from '@stumps/game-engines';

/**
 * Real auction facts for the pool (ADR-024), read from the Wikipedia lists of
 * IPL personnel changes (themselves sourced to ESPNcricinfo and the BCCI):
 * retained players with salaries, sold players with their registered base
 * price, and replacement signings. Pure parsing; fetching lives in the script.
 */

export const WIKI_PAGES = {
  2025: 'List_of_2025_Indian_Premier_League_personnel_changes',
  2026: 'List_of_2026_Indian_Premier_League_personnel_changes',
} as const;

export const wikiRawUrl = (title: string) =>
  `https://en.wikipedia.org/w/index.php?title=${encodeURIComponent(title)}&action=raw`;
export const wikiPageUrl = (title: string) => `https://en.wikipedia.org/wiki/${title}`;

export interface RetainedRow {
  team: string;
  name: string;
  salary: bigint;
}

export interface SoldRow {
  team: string;
  name: string;
  basePrice: bigint;
  price: bigint;
  /** Capped/Uncapped as printed in the list, when the table has the column. */
  category: 'capped' | 'uncapped' | null;
  previousTeam: string | null;
  /** Bought back with a right-to-match card. */
  rtm: boolean;
}

export interface ReplacementRow {
  team: string;
  name: string;
  price: bigint;
}

/** Text between a heading and the next heading of the same or higher level. */
function section(text: string, heading: string): string {
  const start = text.indexOf(heading);
  if (start < 0) return '';
  const level = /^=+/.exec(heading)?.[0].length ?? 2;
  const rest = text.slice(start + heading.length);
  const next = new RegExp(`\\n={2,${level}}[^=]`).exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Remove references, comments and decoration templates. */
function strip(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/g, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\{(?:dagger|double-dagger|nbsp|cbignore|dead link)[^}]*\}\}/gi, '')
    .trim();
}

/** `{{sortname|Jos|Buttler|dab=…}}` or `[[Target|Label]]` → plain name. */
export function cellName(cell: string): string {
  const s = strip(cell);
  const sort = /\{\{sortname\|([^|}]*)\|([^|}]*)/i.exec(s);
  if (sort) return `${sort[1] ?? ''} ${sort[2] ?? ''}`.replace(/\s+/g, ' ').trim();
  const link = /\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/.exec(s);
  if (link) return (link[1] ?? '').trim();
  return s.replace(/<[^>]+>/g, '').trim();
}

/** `[[Mumbai Indians]]`, `[[Mumbai Indians|MI]]` → "Mumbai Indians"; N/A → null. */
export function cellTeam(cell: string): string | null {
  const m = /\[\[([^|\]]+)/.exec(strip(cell));
  return m?.[1]?.trim() ?? null;
}

/** "4.8" × unit in whole rupees, without floating point. */
function decimalRupees(value: string, unit: bigint): bigint {
  const m = /^(\d+)(?:\.(\d{1,4}))?$/.exec(value.trim());
  if (!m) throw new Error(`Not an amount: ${value}`);
  const frac = m[2] ?? '';
  const scale = 10n ** BigInt(frac.length);
  return (BigInt(`${m[1]}${frac}`) * unit) / scale;
}

/** `{{INRConvert|18|c}}` (crore) / `{{INR convert|30|l}}` (lakh) → rupees. */
export function cellConvert(cell: string): bigint | null {
  const m = /\{\{INR ?convert\|([\d.]+)\|([cl])/i.exec(cell);
  if (!m) return null;
  return decimalRupees(m[1] ?? '', m[2] === 'c' ? CRORE : LAKH);
}

/** A plain number of lakhs ("200", "1575") → rupees. */
export function cellLakhs(cell: string): bigint | null {
  const m = /^\s*([\d.]+)\s*$/.exec(strip(cell));
  return m ? decimalRupees(m[1] ?? '', LAKH) : null;
}

interface WikiTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

const plainHeader = (h: string) =>
  strip(h)
    .replace(/^[^|]*scope="col"[^|]*\|/, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/** Drop a leading cell attribute such as `colspan="3" |`. */
const cellBody = (c: string) => c.replace(/^\s*(?:[a-z-]+="[^"]*"\s*)+\|?(?!\|)/i, '').trim();

export function wikiTables(text: string): WikiTable[] {
  const tables: WikiTable[] = [];
  const re = /\{\|[\s\S]*?\n\|\}/g;
  for (const m of text.matchAll(re)) {
    const body = m[0];
    const caption = /\n\|\+([^\n]*)/.exec(body)?.[1] ?? '';
    const headers: string[] = [];
    const rows: string[][] = [];
    for (const block of body.split(/\n\|-[^\n]*/)) {
      const cells: string[] = [];
      let isHeader = false;
      for (const raw of block.split('\n')) {
        const line = raw.trimEnd();
        if (line.startsWith('{|') || line.startsWith('|}') || line.startsWith('|+')) continue;
        if (line.startsWith('!')) {
          const content = line.slice(1);
          if (/scope="col"/.test(content)) {
            isHeader = true;
            headers.push(...content.split('!!').map(plainHeader));
          } else {
            cells.push(
              ...content
                .replace(/^\s*scope="row"\s*\|/, '')
                .split('!!')
                .map(cellBody),
            );
          }
        } else if (line.startsWith('|')) {
          cells.push(...line.slice(1).split('||').map(cellBody));
        } else if (cells.length > 0 && line.trim()) {
          cells[cells.length - 1] += ` ${line.trim()}`;
        }
      }
      if (!isHeader && cells.length > 0) rows.push(cells);
    }
    tables.push({ caption, headers, rows });
  }
  return tables;
}

const col = (headers: string[], ...names: string[]) =>
  headers.findIndex((h) => names.some((n) => h.startsWith(n)));

/** Retained players per team, with salary. */
export function parseRetained(text: string): RetainedRow[] {
  const out: RetainedRow[] = [];
  for (const t of wikiTables(section(text, '=== Retained players ==='))) {
    const team = cellTeam(t.caption);
    const name = col(t.headers, 'player');
    const salary = col(t.headers, 'salary');
    if (!team || name < 0 || salary < 0) continue;
    for (const r of t.rows) {
      const amount = cellConvert(r[salary] ?? '');
      if (amount === null) continue;
      out.push({ team, name: cellName(r[name] ?? ''), salary: amount });
    }
  }
  return out;
}

/** Sold players of one auction, with registered base price. */
export function parseSold(text: string, season: number): SoldRow[] {
  const out: SoldRow[] = [];
  for (const t of wikiTables(section(text, '=== Sold players ==='))) {
    const name = col(t.headers, 'name');
    const base = col(t.headers, 'base price');
    const team = col(t.headers, `${season} ipl team`);
    const price = col(t.headers, 'auctioned price');
    const prev = col(t.headers, `${season - 1} ipl team`);
    const category = col(t.headers, 'category');
    if (name < 0 || base < 0 || team < 0 || price < 0) continue;
    for (const r of t.rows) {
      const basePrice = cellLakhs(r[base] ?? '');
      const sold = cellLakhs(r[price] ?? '');
      const to = cellTeam(r[team] ?? '');
      if (basePrice === null || sold === null || !to) continue;
      const cat = category >= 0 ? (r[category] ?? '').trim().toLowerCase() : '';
      out.push({
        team: to,
        name: cellName(r[name] ?? ''),
        basePrice,
        price: sold,
        category: cat === 'capped' || cat === 'uncapped' ? cat : null,
        previousTeam: prev >= 0 ? cellTeam(r[prev] ?? '') : null,
        rtm: /\{\{dagger\}\}/i.test(r[name] ?? ''),
      });
    }
  }
  return out;
}

/** Replacement signings during the season (they join the squad at that price). */
export function parseReplacements(text: string): ReplacementRow[] {
  const out: ReplacementRow[] = [];
  for (const t of wikiTables(section(text, '== Withdrawn players =='))) {
    const team = col(t.headers, 'team');
    const who = col(t.headers, 'replacement player');
    const price = t.headers.findIndex((h) => h.startsWith("replacement player's price"));
    if (team < 0 || who < 0 || price < 0) continue;
    for (const r of t.rows) {
      const name = cellName(r[who] ?? '');
      const amount = cellConvert(r[price] ?? '');
      const to = cellTeam(r[team] ?? '');
      if (!name || amount === null || !to || /N\/A/.test(r[who] ?? '')) continue;
      out.push({ team: to, name, price: amount });
    }
  }
  return out;
}

/** Last international appearance per Cricsheet register ID (Tests, ODIs, T20Is). */
export interface Internationals {
  lastDate: Map<string, string>;
}

/** Stream every match in the Cricsheet international zips; keeps one date per player. */
export function readInternationals(zips: readonly Uint8Array[]): Internationals {
  const lastDate = new Map<string, string>();
  for (const zip of zips) {
    const unzip = new Unzip((file) => {
      if (!file.name.endsWith('.json')) return;
      const chunks: Uint8Array[] = [];
      file.ondata = (err, data, final) => {
        if (err) throw err;
        chunks.push(data);
        if (!final) return;
        const match = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          info?: {
            dates?: string[];
            players?: Record<string, string[]>;
            registry?: { people?: Record<string, string> };
          };
        };
        const date = match.info?.dates?.at(-1);
        const people = match.info?.registry?.people ?? {};
        if (!date) return;
        for (const names of Object.values(match.info?.players ?? {})) {
          for (const n of names) {
            const id = people[n];
            if (!id) continue;
            const prev = lastDate.get(id);
            if (!prev || prev < date) lastDate.set(id, date);
          }
        }
      };
      file.start();
    });
    unzip.register(UnzipInflate);
    // Small chunks: one push over thousands of files recurses too deeply.
    const CHUNK = 64 * 1024;
    for (let i = 0; i < zip.length; i += CHUNK) {
      unzip.push(zip.subarray(i, i + CHUNK), i + CHUNK >= zip.length);
    }
  }
  return { lastDate };
}

/**
 * Capped status for the auction season (TATA IPL Player Regulations 2025–27):
 * an Indian player is uncapped unless he played in an international starting XI
 * in the five calendar years before the season; an overseas player is capped
 * once he has played any international. Cricsheet covers every international
 * of those five years, so for Indians its silence is evidence; for overseas
 * players without a Cricsheet record the auction list's category decides, and
 * otherwise the status stays unknown (never assumed).
 */
export function cappedStatus(input: {
  overseas: boolean;
  lastInternational: string | null;
  season: number;
  years: number;
  listedCategory: 'capped' | 'uncapped' | null;
}): CappedStatus {
  if (!input.overseas) {
    const from = `${input.season - input.years}-01-01`;
    return input.lastInternational && input.lastInternational >= from ? 'capped' : 'uncapped';
  }
  if (input.lastInternational) return 'capped';
  return input.listedCategory ?? 'unknown';
}
