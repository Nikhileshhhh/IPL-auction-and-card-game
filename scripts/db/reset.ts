/** pnpm db:reset — recreate the local database from migrations (+ demo seed). */
import { resetDatabase } from './lib';

const name = process.env.STUMPS_DB_NAME ?? 'stumps';
const result = await resetDatabase(name, { seed: process.env.SKIP_SEED !== '1' });
console.warn(
  `db:reset ok — database '${name}', ${result.migrations.length} migration(s) applied` +
    (result.migrations.length ? ` [${result.migrations.join(', ')}]` : '') +
    `, ${result.seeds.length} seed file(s)`,
);
