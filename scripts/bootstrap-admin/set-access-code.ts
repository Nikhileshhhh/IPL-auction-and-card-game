/**
 * Operator-only: open the website gate for the first time.
 *   MIGRATION_DATABASE_URL=... ACCESS_CODE_PEPPER_V1=... pnpm ops:set-access-code [--generate]
 * Without --generate the code is read from stdin (never from argv, to keep it
 * out of shell history). A generated code is printed exactly once.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { generateAccessCode, hashAccessCode, setInitialAccessCode } from './access-code';

const url = process.env.MIGRATION_DATABASE_URL;
const pepper = process.env.ACCESS_CODE_PEPPER_V1;
if (!url || !pepper)
  throw new Error('MIGRATION_DATABASE_URL and ACCESS_CODE_PEPPER_V1 are required');
const generate = process.argv.includes('--generate');
const code = generate ? generateAccessCode() : readFileSync(0, 'utf8').trim();
if (code.length < 12 || code.length > 128)
  throw new Error('The access code must be 12–128 characters');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await setInitialAccessCode(client, await hashAccessCode(code, pepper));
  console.warn(generate ? `Access code set. Share it privately: ${code}` : 'Access code set.');
} finally {
  await client.end();
}
