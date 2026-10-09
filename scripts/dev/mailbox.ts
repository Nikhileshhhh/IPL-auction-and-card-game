/** pnpm dev:mailbox — print the latest local "emails" (LocalAuthProvider only). */
import pg from 'pg';
import { adminUrl, databaseUrlFor } from '../db/lib';

const client = new pg.Client({
  connectionString: databaseUrlFor(process.env.STUMPS_DB_NAME ?? 'stumps', adminUrl()),
});
await client.connect();
try {
  const rows = await client.query(
    'SELECT created_at, kind, email, link FROM auth_local.outbox ORDER BY id DESC LIMIT 10',
  );
  for (const row of rows.rows)
    console.warn(`${row.created_at.toISOString()}  ${row.kind}  ${row.email}\n  ${row.link}`);
  if (rows.rowCount === 0) console.warn('mailbox empty');
} finally {
  await client.end();
}
