/**
 * Operator-only: assign an administrator role.
 *   MIGRATION_DATABASE_URL=... tsx scripts/bootstrap-admin/index.ts --email a@b.c [--role operator] [--approved-by <uuid>]
 * Requires the elevated migration connection; never runs inside the web or API process.
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { assignAdmin } from './assign';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    role: { type: 'string', default: 'super_admin' },
    'approved-by': { type: 'string' },
  },
});
const url = process.env.MIGRATION_DATABASE_URL;
if (!url) throw new Error('MIGRATION_DATABASE_URL is required (operator credentials)');
if (!values.email) throw new Error('--email is required');
if (values.role !== 'super_admin' && values.role !== 'operator')
  throw new Error('--role must be super_admin or operator');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const result = await assignAdmin(client, {
    email: values.email,
    role: values.role,
    ...(values['approved-by'] ? { approvedBy: values['approved-by'] } : {}),
  });
  console.warn(
    `Assigned ${result.role} to user ${result.userId}${result.bootstrap ? ' (bootstrap)' : ''}.`,
  );
} finally {
  await client.end();
}
