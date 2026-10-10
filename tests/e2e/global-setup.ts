import { seedDemo } from '../../scripts/data/seed-demo';
import { ensurePostgres, resetDatabase, runtimeUrl } from '../support/db';

export const E2E_MEDIA_DIR = '.local/e2e-media';

export default async function globalSetup() {
  await ensurePostgres();
  const db = process.env.E2E_DB_NAME ?? 'stumps_e2e';
  await resetDatabase(db);
  // A published demo pack (fictional players, original portraits) for card screens.
  await seedDemo(runtimeUrl(db), E2E_MEDIA_DIR);
}
