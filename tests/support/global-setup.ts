import { ensurePostgres } from './db';

export default async function setup() {
  await ensurePostgres();
}
