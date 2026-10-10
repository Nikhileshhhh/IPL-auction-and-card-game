import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type pg from 'pg';
import { AppError } from '../../http/app-error';
import { withTransaction } from '../../db/transaction';
import { storeLicensedPortrait } from '../media/admin';
import { processPortrait } from '../media/pipeline';
import type { MediaStorage } from '../media/storage';
import { parseCsv } from './sources';

/**
 * Player sheet (ADR-019): one row per player with the facts every card must
 * show and the operator's licensed photo of the player in IPL jersey.
 * Download a pre-filled template from the admin catalog, fill it, import it.
 */
export const MANIFEST_COLUMNS = [
  'player_key',
  'name',
  'team',
  'role',
  'full_name',
  'country',
  'batting_style',
  'bowling_style',
  'photo',
  'ipl_jersey',
  'licence',
  'licence_holder',
  'attribution',
  'source_url',
] as const;

const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const COUNTRY_NAMES: Record<string, string> = {
  india: 'IN',
  australia: 'AU',
  england: 'GB',
  'united kingdom': 'GB',
  'south africa': 'ZA',
  'new zealand': 'NZ',
  afghanistan: 'AF',
  'sri lanka': 'LK',
  bangladesh: 'BD',
  pakistan: 'PK',
  zimbabwe: 'ZW',
  ireland: 'IE',
  scotland: 'GB',
  netherlands: 'NL',
  nepal: 'NP',
  'united states': 'US',
  usa: 'US',
  jamaica: 'JM',
  'trinidad and tobago': 'TT',
  barbados: 'BB',
  guyana: 'GY',
  'antigua and barbuda': 'AG',
  'saint kitts and nevis': 'KN',
  'st kitts and nevis': 'KN',
  'saint lucia': 'LC',
  grenada: 'GD',
  dominica: 'DM',
  'saint vincent and the grenadines': 'VC',
  namibia: 'NA',
  'united arab emirates': 'AE',
  uae: 'AE',
};

export function parseCountry(value: string): string | null {
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_NAMES[v.toLowerCase()] ?? null;
}

export function parseBattingStyle(value: string): 'right_hand' | 'left_hand' | null {
  const v = value.trim().toLowerCase().replace(/[-_]/g, ' ');
  if (/^(right( hand(ed)?)?( bat(ter|sman)?)?|rhb|r)$/.test(v)) return 'right_hand';
  if (/^(left( hand(ed)?)?( bat(ter|sman)?)?|lhb|l)$/.test(v)) return 'left_hand';
  return null;
}

const DOES_NOT_BOWL = /^(does not bowl|doesn't bowl|none|-|n\/a)$/i;

export interface ManifestRow {
  line: number;
  playerKey: string;
  fullName: string | null;
  country: string | null;
  battingStyle: 'right_hand' | 'left_hand' | null;
  /** undefined = leave unchanged; null = does not bowl. */
  bowlingStyle: string | null | undefined;
  photo: string | null;
  licence: string | null;
  licenceHolder: string | null;
  attribution: string | null;
  sourceUrl: string | null;
}

export interface ManifestIssue {
  line: number;
  playerKey: string;
  message: string;
}

/** Parse and validate the sheet; rows with errors are reported, never half-applied. */
export function parseManifest(csv: string): { rows: ManifestRow[]; issues: ManifestIssue[] } {
  const [header, ...data] = parseCsv(csv.replace(/^\uFEFF/, ''));
  if (!header)
    return { rows: [], issues: [{ line: 1, playerKey: '', message: 'The sheet is empty.' }] };
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  if (!col.has('player_key')) {
    return {
      rows: [],
      issues: [{ line: 1, playerKey: '', message: 'Missing the player_key column.' }],
    };
  }
  const get = (r: string[], name: (typeof MANIFEST_COLUMNS)[number]) => {
    const i = col.get(name);
    return i === undefined ? '' : (r[i] ?? '').trim();
  };
  const rows: ManifestRow[] = [];
  const issues: ManifestIssue[] = [];
  data.forEach((r, idx) => {
    const line = idx + 2;
    const playerKey = get(r, 'player_key');
    if (!playerKey) return;
    const problems: string[] = [];
    const countryRaw = get(r, 'country');
    const country = countryRaw ? parseCountry(countryRaw) : null;
    if (countryRaw && !country)
      problems.push(`unknown country "${countryRaw}" (use a 2-letter code such as IN)`);
    const batRaw = get(r, 'batting_style');
    const battingStyle = batRaw ? parseBattingStyle(batRaw) : null;
    if (batRaw && !battingStyle) problems.push(`batting_style must be right_hand or left_hand`);
    const bowlRaw = get(r, 'bowling_style');
    const bowlingStyle =
      bowlRaw === '' ? undefined : DOES_NOT_BOWL.test(bowlRaw) ? null : bowlRaw.slice(0, 40);
    const photo = get(r, 'photo') || null;
    const jersey = get(r, 'ipl_jersey').toLowerCase();
    const licence = get(r, 'licence') || null;
    const licenceHolder = get(r, 'licence_holder') || null;
    const sourceUrl = get(r, 'source_url') || null;
    if (photo) {
      if (!['yes', 'y', 'true', '1'].includes(jersey)) {
        problems.push('photo rows must confirm ipl_jersey = yes (player in IPL franchise jersey)');
      }
      if (!licence || !licenceHolder) problems.push('photo rows need licence and licence_holder');
      if (sourceUrl && !sourceUrl.startsWith('https://')) problems.push('source_url must be https');
    }
    if (problems.length) {
      issues.push({ line, playerKey, message: problems.join('; ') });
      return;
    }
    rows.push({
      line,
      playerKey,
      fullName: get(r, 'full_name').slice(0, 80) || null,
      country,
      battingStyle,
      bowlingStyle,
      photo,
      licence,
      licenceHolder,
      attribution: get(r, 'attribution').slice(0, 300) || null,
      sourceUrl,
    });
  });
  return { rows, issues };
}

const csvCell = (v: string | null | undefined) => {
  const s = v ?? '';
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Pre-filled sheet for every player in a version (facts already known are kept). */
export async function manifestTemplate(pool: pg.Pool, versionId: string): Promise<string> {
  const res = await pool.query<{
    key: string;
    name: string;
    team: string | null;
    role: string;
    country: string | null;
    batting_style: string | null;
    bowling_style: string | null;
  }>(
    `SELECT coalesce(e.external_id, p.id::text) AS key, p.canonical_name AS name, ps.team_name AS team,
            coalesce(ps.role, p.primary_role) AS role, p.country_code AS country, p.batting_style,
            p.bowling_style
       FROM app_private.player_seasons ps
       JOIN app_private.players p ON p.id = ps.player_id
       LEFT JOIN LATERAL (SELECT external_id FROM app_private.player_external_ids x
                           WHERE x.player_id = p.id AND x.source IN ('cricsheet', 'demo')
                           ORDER BY x.source LIMIT 1) e ON true
      WHERE ps.data_version_id = $1
      ORDER BY ps.team_name NULLS LAST, p.canonical_name`,
    [versionId],
  );
  if (res.rowCount === 0) throw new AppError('NOT_FOUND', 'Data version not found or empty.');
  const lines = [MANIFEST_COLUMNS.join(',')];
  for (const r of res.rows) {
    lines.push(
      [
        r.key,
        r.name,
        r.team,
        r.role,
        '',
        r.country,
        r.batting_style,
        r.bowling_style,
        '',
        'yes',
        '',
        '',
        '',
        '',
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export interface ApplyOptions {
  /** Folder that relative `photo` paths are read from (CLI only). */
  photosDir?: string;
  /** Hosts `photo` URLs may be downloaded from (operator's licensed source). */
  allowedHosts: readonly string[];
  actorId: string | null;
  fetchImpl?: typeof fetch;
}

export async function loadPhoto(photo: string, options: ApplyOptions): Promise<Buffer> {
  if (/^https?:\/\//i.test(photo)) {
    const url = new URL(photo);
    if (url.protocol !== 'https:' || !options.allowedHosts.includes(url.hostname)) {
      throw new Error(
        `photo host ${url.hostname} is not in PHOTO_IMPORT_HOSTS (add your licensed source to allow it)`,
      );
    }
    const res = await (options.fetchImpl ?? fetch)(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
      headers: { 'user-agent': 'STUMPS-licensed-photo-import/1.0' },
    });
    if (!res.ok) throw new Error(`photo download failed (HTTP ${res.status})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_PHOTO_BYTES) throw new Error('photo larger than 15 MiB');
    return bytes;
  }
  if (!options.photosDir) throw new Error('local photo paths need --photos-dir (CLI import)');
  const root = resolve(options.photosDir);
  const full = resolve(root, photo);
  const rel = relative(root, full);
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('photo path escapes the photos folder');
  return readFile(full);
}

export interface ApplyReport {
  updatedFacts: number;
  photos: number;
  issues: ManifestIssue[];
}

/** Apply facts and photos row by row; one bad row never blocks the others. */
export async function applyManifest(
  pool: pg.Pool,
  storage: MediaStorage,
  rows: readonly ManifestRow[],
  options: ApplyOptions,
): Promise<ApplyReport> {
  const report: ApplyReport = { updatedFacts: 0, photos: 0, issues: [] };
  for (const row of rows) {
    try {
      const image = row.photo
        ? await processPortrait(await loadPhoto(row.photo, options), { maxBytes: MAX_PHOTO_BYTES })
        : null;
      await withTransaction(pool, async (tx) => {
        const found = await tx.query<{ id: string }>(
          `SELECT p.id FROM app_private.players p
            WHERE p.id::text = $1
               OR EXISTS (SELECT 1 FROM app_private.player_external_ids e
                           WHERE e.player_id = p.id AND e.source IN ('cricsheet', 'demo', 'cricinfo')
                             AND e.external_id = $1)
            LIMIT 2`,
          [row.playerKey],
        );
        const player = found.rows[0];
        if (!player || found.rowCount !== 1)
          throw new Error('player_key does not match exactly one player');
        const updated = await tx.query(
          `UPDATE app_private.players SET
              canonical_name = coalesce($2, canonical_name),
              country_code = coalesce($3, country_code),
              batting_style = coalesce($4, batting_style),
              bowling_style = CASE WHEN $5::boolean THEN $6 ELSE bowling_style END,
              updated_at = now()
            WHERE id = $1`,
          [
            player.id,
            row.fullName,
            row.country,
            row.battingStyle,
            row.bowlingStyle !== undefined,
            row.bowlingStyle ?? null,
          ],
        );
        if (updated.rowCount) report.updatedFacts += 1;
        if (image && row.licence && row.licenceHolder) {
          await storeLicensedPortrait(tx, storage, {
            playerId: player.id,
            image,
            actorId: options.actorId,
            rights: {
              basis: 'licensed',
              licence: row.licence,
              author: row.licenceHolder,
              attribution: row.attribution ?? `Photo licensed to ${row.licenceHolder}`,
              ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
            },
          });
          report.photos += 1;
        }
      });
    } catch (error) {
      report.issues.push({
        line: row.line,
        playerKey: row.playerKey,
        message: error instanceof AppError || error instanceof Error ? error.message : 'failed',
      });
    }
  }
  return report;
}
