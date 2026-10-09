import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../../apps/server/src/app';
import { loadEnv } from '../../apps/server/src/config/env';
import { databaseCheck } from '../../apps/server/src/http/readiness';
import { schemaCheck } from '../../apps/server/src/db/schema-version';
import { createEmptyDatabase, resetDatabase, runtimeUrl } from '../support/db';

const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
let migrated: pg.Pool;

beforeAll(async () => {
  await resetDatabase('stumps_it_ready');
  migrated = new pg.Pool({ connectionString: runtimeUrl('stumps_it_ready'), max: 2 });
});
afterAll(async () => migrated?.end());

describe('readiness against a real database', () => {
  it('is ready only when the database is reachable and the schema is current', async () => {
    const app = await buildApp({
      env,
      readinessChecks: [databaseCheck(migrated), schemaCheck(migrated)],
    });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data.checks).toEqual([
      { name: 'database', ok: true },
      { name: 'schema', ok: true },
    ]);
  });

  it('reports not ready when the schema is older than this build requires', async () => {
    const app = await buildApp({ env, readinessChecks: [schemaCheck(migrated, '999_future')] });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    await app.close();
    expect(res.statusCode).toBe(503);
    expect(res.json().data.checks[0].detail).toMatch(/older than required/);
  });

  it('reports not ready on an unmigrated database', async () => {
    const url = await createEmptyDatabase('stumps_it_unmigrated');
    const pool = new pg.Pool({ connectionString: url, max: 1 });
    const app = await buildApp({ env, readinessChecks: [schemaCheck(pool)] });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    await app.close();
    await pool.end();
    expect(res.statusCode).toBe(503);
  });
});
