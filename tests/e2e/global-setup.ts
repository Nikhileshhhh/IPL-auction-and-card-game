import { ensurePostgres, resetDatabase } from '../support/db';

export default async function globalSetup() {
  await ensurePostgres();
  await resetDatabase(process.env.E2E_DB_NAME ?? 'stumps_e2e');
}
