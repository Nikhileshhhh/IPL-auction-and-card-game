import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { assignAdmin, BootstrapRefused } from '../../scripts/bootstrap-admin/assign';
import { connect, createUser, databaseUrlFor, resetDatabase } from '../support/db';

const DB = 'stumps_it_admin';
let admin: pg.Client;

beforeAll(async () => {
  await resetDatabase(DB);
  admin = await connect(databaseUrlFor(DB));
});
afterAll(async () => admin?.end());

describe('protected admin bootstrap', () => {
  it('refuses unverified email and users without an enrolled profile', async () => {
    await createUser(admin, 'unverified_op', { confirmed: false });
    await expect(
      assignAdmin(admin, { email: 'unverified_op@example.test', role: 'super_admin' }),
    ).rejects.toThrow(/not verified/);
    await admin.query(
      `INSERT INTO auth.users (email, email_confirmed_at) VALUES ('noprofile@example.test', now())`,
    );
    await expect(
      assignAdmin(admin, { email: 'noprofile@example.test', role: 'super_admin' }),
    ).rejects.toThrow(/enrollment/);
  });

  it('the first administrator must be a super admin', async () => {
    await createUser(admin, 'first_operator');
    await expect(
      assignAdmin(admin, { email: 'first_operator@example.test', role: 'operator' }),
    ).rejects.toBeInstanceOf(BootstrapRefused);
  });

  it('bootstraps exactly one super admin, then requires approval by an existing super admin', async () => {
    const first = await createUser(admin, 'root_admin');
    const result = await assignAdmin(admin, {
      email: 'root_admin@example.test',
      role: 'super_admin',
    });
    expect(result).toMatchObject({ userId: first, bootstrap: true });

    await createUser(admin, 'second_admin');
    await expect(
      assignAdmin(admin, { email: 'second_admin@example.test', role: 'super_admin' }),
    ).rejects.toThrow(/approved-by/);
    const second = await assignAdmin(admin, {
      email: 'second_admin@example.test',
      role: 'operator',
      approvedBy: first,
    });
    expect(second.bootstrap).toBe(false);
    const audit = await admin.query(
      `SELECT count(*)::int AS n FROM app_private.admin_audit WHERE action = 'admin.assigned'`,
    );
    expect(audit.rows[0]).toEqual({ n: 2 });
  });

  it('concurrent bootstrap attempts cannot create two unapproved super admins', async () => {
    const name = 'stumps_it_admin_race';
    await resetDatabase(name);
    const a = await connect(databaseUrlFor(name));
    const b = await connect(databaseUrlFor(name));
    try {
      await createUser(a, 'racer_one');
      await createUser(a, 'racer_two');
      const results = await Promise.allSettled([
        assignAdmin(a, { email: 'racer_one@example.test', role: 'super_admin' }),
        assignAdmin(b, { email: 'racer_two@example.test', role: 'super_admin' }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const supers = await a.query(
        `SELECT count(*)::int AS n FROM app_private.admin_assignments WHERE role = 'super_admin'`,
      );
      expect(supers.rows[0]).toEqual({ n: 1 });
    } finally {
      await a.end();
      await b.end();
    }
  });
});

describe('initial access code (operator)', () => {
  it('sets the first code once, audits it, and refuses silent overwrites', async () => {
    const { hashAccessCode, setInitialAccessCode } =
      await import('../../scripts/bootstrap-admin/access-code');
    const name = 'stumps_it_initial_code';
    await resetDatabase(name);
    const client = await connect(databaseUrlFor(name));
    try {
      const pepper = Buffer.alloc(32, 7).toString('base64url');
      await setInitialAccessCode(client, await hashAccessCode('first-gate-code-123', pepper));
      const cfg = await client.query(
        'SELECT code_hash IS NOT NULL AS set, version::int FROM app_private.access_config',
      );
      expect(cfg.rows[0]).toEqual({ set: true, version: 2 });
      await expect(
        setInitialAccessCode(client, await hashAccessCode('second-code-xyz', pepper)),
      ).rejects.toThrow(/already set/);
      const audit = await client.query(
        `SELECT count(*)::int AS n FROM app_private.admin_audit WHERE action = 'access.bootstrap'`,
      );
      expect(audit.rows[0]).toEqual({ n: 1 });
    } finally {
      await client.end();
    }
  });
});
