import type pg from 'pg';

export interface AssignAdminInput {
  email: string;
  role: 'super_admin' | 'operator';
  /** Required whenever an active super admin already exists (second-admin workflow). */
  approvedBy?: string;
}

export class BootstrapRefused extends Error {}

/**
 * Protected operator procedure (master §9.1 step 2, DB/realtime §2.3). Runs with
 * migration credentials; the runtime role has no INSERT on admin_assignments,
 * and no application endpoint can create the first super admin.
 */
export async function assignAdmin(client: pg.Client, input: AssignAdminInput) {
  await client.query('BEGIN');
  try {
    // Serialize concurrent bootstrap attempts.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('stumps.bootstrap-admin'))`);
    const user = await client.query<{ id: string; email_confirmed_at: Date | null }>(
      'SELECT id, email_confirmed_at FROM auth.users WHERE lower(email) = lower($1)',
      [input.email],
    );
    const target = user.rows[0];
    if (!target) throw new BootstrapRefused('No Auth user with that email.');
    if (!target.email_confirmed_at)
      throw new BootstrapRefused('Email ownership is not verified yet.');
    const profile = await client.query('SELECT 1 FROM app_private.profiles WHERE user_id = $1', [
      target.id,
    ]);
    if (profile.rowCount !== 1)
      throw new BootstrapRefused('The user has not completed enrollment (no profile).');

    const supers = await client.query<{ user_id: string }>(
      `SELECT user_id FROM app_private.admin_assignments WHERE role = 'super_admin' AND revoked_at IS NULL`,
    );
    let assignedBy: string | null = null;
    if (supers.rowCount && supers.rowCount > 0) {
      if (!input.approvedBy || !supers.rows.some((r) => r.user_id === input.approvedBy)) {
        throw new BootstrapRefused(
          'An active super admin exists; --approved-by <super admin user id> is required.',
        );
      }
      if (input.approvedBy === target.id)
        throw new BootstrapRefused('An admin cannot approve their own assignment.');
      assignedBy = input.approvedBy;
    } else if (input.role !== 'super_admin') {
      throw new BootstrapRefused('The first administrator must be a super admin.');
    }

    await client.query(
      `INSERT INTO app_private.admin_assignments (user_id, role, assigned_by, mfa_enrollment_until)
       VALUES ($1, $2, $3, now() + interval '1 hour')
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, assigned_by = EXCLUDED.assigned_by,
         assigned_at = now(), revoked_at = NULL, mfa_enrollment_until = EXCLUDED.mfa_enrollment_until`,
      [target.id, input.role, assignedBy],
    );
    await client.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'admin.assigned', 'admin_assignment', jsonb_build_object('role', $2::text, 'bootstrap', $3::boolean))`,
      [assignedBy, input.role, assignedBy === null],
    );
    await client.query('COMMIT');
    return { userId: target.id, role: input.role, bootstrap: assignedBy === null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
