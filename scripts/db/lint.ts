/**
 * pnpm db:lint — static security/integrity lint of the migrated schema.
 * Fails if any app table lacks forced RLS or a backend policy, is reachable by
 * browser roles, has an unindexed foreign key, or is missing from the
 * retention ownership map; or if the runtime role is overprivileged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { ROOT, databaseUrlFor, adminUrl } from './lib';

const name = process.env.STUMPS_DB_NAME ?? 'stumps';
const client = new pg.Client({
  connectionString: process.env.DB_LINT_URL ?? databaseUrlFor(name, adminUrl()),
});
await client.connect();
const problems: string[] = [];

try {
  const schemaExists = await client.query(
    `SELECT 1 FROM pg_namespace WHERE nspname = 'app_private'`,
  );
  const tables = schemaExists.rowCount
    ? (
        await client.query<{ table: string; rls: boolean; forced: boolean }>(
          `SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'app_private' AND c.relkind IN ('r','p') ORDER BY 1`,
        )
      ).rows
    : [];

  const manifest = readFileSync(join(ROOT, 'docs', 'migration-manifest.md'), 'utf8');
  const browserRoles = (
    await client.query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated')`,
    )
  ).rows.map((r) => r.rolname);

  for (const t of tables) {
    const qualified = `app_private.${t.table}`;
    if (!t.rls) problems.push(`${qualified}: row level security not enabled`);
    if (!t.forced) problems.push(`${qualified}: row level security not forced`);
    const policies = await client.query(
      `SELECT 1 FROM pg_policies WHERE schemaname = 'app_private' AND tablename = $1`,
      [t.table],
    );
    if (policies.rowCount === 0)
      problems.push(`${qualified}: no RLS policy (backend role would be denied)`);
    for (const role of [...browserRoles, 'public']) {
      const grants = await client.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'app_private' AND table_name = $1 AND lower(grantee) = $2`,
        [t.table, role],
      );
      if (grants.rowCount)
        problems.push(`${qualified}: browser/public role '${role}' has table privileges`);
    }
    if (!manifest.includes(`\`${t.table}\``)) {
      problems.push(`${qualified}: missing from docs/migration-manifest.md retention map`);
    }
  }

  // Every foreign key must have an index whose leading columns match it.
  const unindexed = await client.query<{ table: string; fk: string }>(
    `SELECT c.conrelid::regclass::text AS table, c.conname AS fk
       FROM pg_constraint c
       JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE c.contype = 'f' AND n.nspname = 'app_private'
        AND NOT EXISTS (
          SELECT 1 FROM pg_index i
           WHERE i.indrelid = c.conrelid
             AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] @> c.conkey
             AND (i.indkey::int2[])[0:array_length(c.conkey,1)-1] <@ c.conkey
        )`,
  );
  for (const row of unindexed.rows)
    problems.push(`${row.table}: foreign key ${row.fk} has no supporting index`);

  for (const role of browserRoles) {
    const usage = await client.query(
      `SELECT has_schema_privilege($1, 'app_private', 'USAGE') AS u`,
      [role],
    );
    if (schemaExists.rowCount && usage.rows[0]?.u)
      problems.push(`role ${role} has USAGE on app_private`);
  }

  const runtime = await client.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreatedb: boolean;
    rolcreaterole: boolean;
  }>(
    `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = 'app_runtime'`,
  );
  const r = runtime.rows[0];
  if (r && (r.rolsuper || r.rolbypassrls || r.rolcreatedb || r.rolcreaterole)) {
    problems.push('app_runtime must be NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE');
  }
  if (r) {
    const owns = await client.query(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app_private' AND pg_get_userbyid(c.relowner)='app_runtime'`,
    );
    if (owns.rowCount)
      problems.push('app_runtime owns app_private objects (migration owner must differ)');
    const create = await client.query(
      `SELECT has_schema_privilege('app_runtime','app_private','CREATE') AS c`,
    );
    if (create.rows[0]?.c) problems.push('app_runtime has CREATE on app_private (no DDL allowed)');
  }

  // SECURITY DEFINER functions must pin search_path.
  const definers = await client.query<{ fn: string }>(
    `SELECT p.oid::regprocedure::text AS fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname IN ('app_private','public') AND p.prosecdef
        AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) cfg WHERE cfg LIKE 'search_path=%')`,
  );
  for (const d of definers.rows)
    problems.push(`SECURITY DEFINER function ${d.fn} lacks a fixed search_path`);

  if (problems.length) {
    console.error(`db:lint failed with ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
  } else {
    console.warn(`db:lint ok — ${tables.length} app_private table(s) checked in '${name}'`);
  }
} finally {
  await client.end();
}
