/**
 * pnpm data:facts -- [--version <dataVersionId>] [--dry-run]
 *
 * Fills missing player facts in a draft (ADR-019) from open reference data:
 * full name and country from Wikidata (by ESPNcricinfo ID), batting and bowling
 * style from the English Wikipedia cricketer infobox. Existing values and
 * reviewed names are never overwritten; players a source does not cover are
 * listed for the player sheet. Needs query.wikidata.org and en.wikipedia.org.
 * Env: DATABASE_URL (runtime role).
 */
import { parseArgs } from 'node:util';
import { loadEnv } from '../../apps/server/src/config/env';
import { createPool } from '../../apps/server/src/db/pool';
import {
  citesCricinfo,
  factsQuery,
  parseFacts,
  parseInfoboxStyles,
  parseWikipediaContent,
  wikipediaContentUrl,
  type WikidataFacts,
} from '../../apps/server/src/modules/cricket-data/facts';
import { fetchAllowed, wikidataUrl } from '../../apps/server/src/modules/media/commons';

const { values } = parseArgs({
  // pnpm forwards a literal `--` separator; drop it.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: { version: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
});
const dryRun = values['dry-run'] ?? false;
const env = loadEnv();
if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = createPool({ connectionString: env.DATABASE_URL, max: 2 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

try {
  const version =
    values.version ??
    (
      await pool.query<{ id: string }>(
        `SELECT id FROM app_private.data_versions WHERE kind = 'factual' AND status = 'draft'
          ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0]?.id;
  if (!version) throw new Error('No factual draft version found; run pnpm data:import first.');

  const players = (
    await pool.query<{
      id: string;
      name: string;
      reviewed: boolean;
      cricinfo: string | null;
      country: string | null;
      batting: string | null;
      bowling: string | null;
      bowled: boolean;
    }>(
      `SELECT p.id, p.canonical_name AS name, p.role_reviewed AS reviewed, e.external_id AS cricinfo,
              p.country_code AS country, p.batting_style AS batting, p.bowling_style AS bowling,
              coalesce(st.value, 0) > 0 AS bowled
         FROM app_private.player_seasons ps
         JOIN app_private.players p ON p.id = ps.player_id
         LEFT JOIN app_private.player_external_ids e ON e.player_id = p.id AND e.source = 'cricinfo'
         LEFT JOIN app_private.player_statistics st
           ON st.data_version_id = ps.data_version_id AND st.player_id = p.id
          AND st.metric = 'balls_bowled' AND st.segment = 'overall'
        WHERE ps.data_version_id = $1
        ORDER BY p.canonical_name`,
      [version],
    )
  ).rows;

  // 1. Wikidata: name, country and the English Wikipedia article.
  const wd = new Map<string, WikidataFacts>();
  const ids = players.flatMap((p) => (p.cricinfo ? [p.cricinfo] : []));
  for (let i = 0; i < ids.length; i += 80) {
    for (const f of parseFacts(
      await fetchAllowed(wikidataUrl(factsQuery(ids.slice(i, i + 80))), 'json'),
    )) {
      wd.set(f.cricinfo, f);
    }
    await sleep(1000);
  }

  // 2. Wikipedia infobox: batting and bowling style (50 titles per request).
  const titles = [...new Set([...wd.values()].flatMap((f) => (f.enwiki ? [f.enwiki] : [])))];
  const wikitext = new Map<string, string>();
  let wikipediaError: string | null = null;
  for (let i = 0; i < titles.length && !wikipediaError; i += 50) {
    try {
      for (const [t, text] of parseWikipediaContent(
        await fetchAllowed(wikipediaContentUrl(titles.slice(i, i + 50)), 'json'),
      )) {
        wikitext.set(t, text);
      }
    } catch (error) {
      wikipediaError = (error as Error).message;
    }
    await sleep(1500);
  }

  // 3. Players whose Wikidata item has no article link (or no styles there): look the
  //    article up by name, accepted only when it cites the player's own ESPNcricinfo ID.
  const linkedStyles = (p: (typeof players)[number]) => {
    const f = p.cricinfo ? wd.get(p.cricinfo) : undefined;
    return f?.enwiki ? parseInfoboxStyles(wikitext.get(f.enwiki) ?? '') : null;
  };
  const byName = new Map<string, ReturnType<typeof parseInfoboxStyles>>();
  const lookups = players.filter((p) => {
    if (!p.cricinfo || wikipediaError) return false;
    const st = linkedStyles(p);
    return (!p.batting && !st?.battingStyle) || (p.bowled && !p.bowling && !st?.bowlingStyle);
  });
  const titleOwner = new Map<string, (typeof players)[number]>();
  for (const p of lookups) {
    const label = (p.cricinfo ? wd.get(p.cricinfo)?.label : null) ?? p.name;
    const words = label.split(/\s+/);
    const short = words.length > 2 ? `${words[0]} ${words[words.length - 1]}` : null;
    for (const t of [
      label,
      `${label} (cricketer)`,
      ...(short ? [short, `${short} (cricketer)`] : []),
    ])
      if (!titleOwner.has(t)) titleOwner.set(t, p);
  }
  const lookupTitles = [...titleOwner.keys()];
  for (let i = 0; i < lookupTitles.length; i += 50) {
    try {
      for (const [t, text] of parseWikipediaContent(
        await fetchAllowed(wikipediaContentUrl(lookupTitles.slice(i, i + 50)), 'json'),
      )) {
        const owner = titleOwner.get(t);
        if (!owner?.cricinfo || byName.has(owner.id) || !citesCricinfo(text, owner.cricinfo))
          continue;
        byName.set(owner.id, parseInfoboxStyles(text));
      }
    } catch (error) {
      wikipediaError ??= (error as Error).message;
    }
    await sleep(1500);
  }

  const report = { names: 0, countries: 0, batting: 0, bowling: 0 };
  const missing: { name: string; gaps: string[] }[] = [];
  for (const p of players) {
    const f = p.cricinfo ? wd.get(p.cricinfo) : undefined;
    const linked = linkedStyles(p);
    const found = byName.get(p.id);
    const styles = {
      battingStyle: linked?.battingStyle ?? found?.battingStyle ?? null,
      bowlingStyle: linked?.bowlingStyle ?? found?.bowlingStyle ?? null,
    };
    const name = !p.reviewed && f?.label ? f.label.slice(0, 80) : null;
    const country = p.country ? null : (f?.country ?? null);
    const batting = p.batting ? null : (styles?.battingStyle ?? null);
    const bowling = p.bowling ? null : (styles?.bowlingStyle ?? null);
    if (name && name !== p.name) report.names += 1;
    if (country) report.countries += 1;
    if (batting) report.batting += 1;
    if (bowling) report.bowling += 1;
    const gaps = [
      ...((p.country ?? country) ? [] : ['country']),
      ...((p.batting ?? batting) ? [] : ['batting style']),
      ...(p.bowled && !(p.bowling ?? bowling) ? ['bowling style'] : []),
    ];
    if (gaps.length) missing.push({ name: name ?? p.name, gaps });
    if (dryRun || (!name && !country && !batting && !bowling)) continue;
    await pool.query(
      `UPDATE app_private.players SET
          canonical_name = coalesce($2, canonical_name),
          country_code = coalesce(country_code, $3),
          batting_style = coalesce(batting_style, $4),
          bowling_style = coalesce(bowling_style, $5),
          updated_at = now()
        WHERE id = $1`,
      [p.id, name, country, batting, bowling],
    );
  }

  console.warn(
    `${dryRun ? '[dry run] ' : ''}Version ${version}: ${players.length} players. Filled ` +
      `${report.names} full names, ${report.countries} countries, ${report.batting} batting styles, ` +
      `${report.bowling} bowling styles.`,
  );
  if (wikipediaError) {
    console.warn(
      `Batting/bowling styles skipped: Wikipedia was not reachable (${wikipediaError}). ` +
        'Allow en.wikipedia.org in the network settings, or fill them in the player sheet.',
    );
  }
  if (missing.length) {
    console.warn(`Still missing (fill via the player sheet, pnpm data:profiles):`);
    for (const m of missing) console.warn(`  ${m.name}: ${m.gaps.join(', ')}`);
  }
} finally {
  await pool.end();
}
