/**
 * pnpm data:fetch — download the Cricsheet IPL archive and people register
 * (ODC-By 1.0) into CRICSHEET_DIR and write a source ledger entry.
 * Only the two allowlisted URLs below are fetched. Requires network access to
 * cricsheet.org (allow it in the environment's network settings if blocked).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  CRICSHEET_ATTRIBUTION,
  CRICSHEET_FILES,
  CRICSHEET_LICENCE,
  parseMatchesZip,
  parsePeople,
} from '../../apps/server/src/modules/cricket-data/sources';

const dir = resolve(process.env.CRICSHEET_DIR ?? 'data/raw/cricsheet');
await mkdir(dir, { recursive: true });

async function download(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'STUMPS-data-fetch/1.0' },
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

const ledger = [];
for (const entry of Object.values(CRICSHEET_FILES)) {
  let bytes: Buffer;
  try {
    bytes = await download(entry.url);
  } catch (error) {
    console.error(
      `Could not download ${entry.url}: ${(error as Error).message}\n` +
        'If this environment blocks cricsheet.org, allow it under Network access → Allowed domains.',
    );
    process.exit(1);
  }
  await writeFile(join(dir, entry.file), bytes);
  ledger.push({
    file: entry.file,
    url: entry.url,
    publisher: 'Cricsheet',
    licence: CRICSHEET_LICENCE,
    attribution: CRICSHEET_ATTRIBUTION,
    downloadedAt: new Date().toISOString(),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

const matches = parseMatchesZip(
  new Uint8Array(readFileSync(join(dir, CRICSHEET_FILES.matches.file))),
);
const people = parsePeople(readFileSync(join(dir, CRICSHEET_FILES.people.file), 'utf8'));
const dates = matches.map((m) => [...m.info.dates].sort()[0] ?? '').sort();
await writeFile(
  join(dir, 'ledger.json'),
  JSON.stringify(
    {
      entries: ledger,
      coverage: {
        matches: matches.length,
        people: people.size,
        from: dates[0],
        to: dates[dates.length - 1],
      },
    },
    null,
    2,
  ),
);
console.warn(
  `Cricsheet IPL archive ready: ${matches.length} matches (${dates[0]} → ${dates[dates.length - 1]}), ${people.size} registered people.\n` +
    'Next: import it from the admin catalog (S34) or POST /v1/admin/catalog/imports {"kind":"cricsheet"}.',
);
