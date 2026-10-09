import type pg from 'pg';

/**
 * TTL sweep for S/O tables (migration manifest retention map). Idempotent and
 * bounded; safe to run concurrently from several processes.
 */
export async function sweepSecurityTables(pool: pg.Pool): Promise<Record<string, number>> {
  const statements: [string, string][] = [
    [
      'access_request_receipts',
      'DELETE FROM app_private.access_request_receipts WHERE expires_at <= now()',
    ],
    ['access_attempts', 'DELETE FROM app_private.access_attempts WHERE expires_at <= now()'],
    [
      'socket_tickets',
      `DELETE FROM app_private.socket_tickets WHERE expires_at <= now() - interval '5 minutes'`,
    ],
    ['enrollment_invites', 'DELETE FROM app_private.enrollment_invites WHERE expires_at <= now()'],
    [
      'app_sessions',
      `DELETE FROM app_private.app_sessions
        WHERE (revoked_at IS NOT NULL AND revoked_at <= now() - interval '24 hours')
           OR expires_at <= now() - interval '24 hours'`,
    ],
    ['gate_grants', 'DELETE FROM app_private.gate_grants WHERE expires_at <= now()'],
    ['request_receipts', 'DELETE FROM app_private.request_receipts WHERE expires_at <= now()'],
    ['rate_counters', 'DELETE FROM app_private.rate_counters WHERE expires_at <= now()'],
    ['security_events', 'DELETE FROM app_private.security_events WHERE expires_at <= now()'],
    ['notifications', 'DELETE FROM app_private.notifications WHERE expires_at <= now()'],
    [
      'admin_audit',
      `DELETE FROM app_private.admin_audit WHERE occurred_at <= now() - interval '90 days'`,
    ],
  ];
  const counts: Record<string, number> = {};
  for (const [name, sql] of statements) {
    const res = await pool.query(sql);
    counts[name] = res.rowCount ?? 0;
  }
  return counts;
}

export function startSecurityCleanup(
  pool: pg.Pool,
  intervalMs = 5 * 60_000,
  onError?: (error: unknown) => void,
) {
  const timer = setInterval(() => {
    sweepSecurityTables(pool).catch((error: unknown) => onError?.(error));
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
