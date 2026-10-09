import type pg from 'pg';
import type { AttemptStatus } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { dbNow, withTransaction, type Tx } from '../../db/transaction';
import { hmac, randomToken, sha256 } from '../../security/crypto';
import type { Secrets } from '../../config/secrets';
import { one } from '../../db/rows';

export const MAX_FAILURES = 3;
export const PREAUTH_TTL_MS = 10 * 60_000;
export const BOUND_TTL_MS = 12 * 60 * 60_000;
export const BOUND_IDLE_MS = 2 * 60 * 60_000;
export const IP_FAILURE_LIMIT = 30;
export const IP_WINDOW_MS = 15 * 60_000;
const RECEIPT_TTL_MS = 24 * 60 * 60_000;

export interface GateDeps {
  pool: pg.Pool;
  secrets: Secrets;
}

interface AccessConfigRow {
  version: string;
  min_valid_version: string;
  code_hash: string | null;
  pepper_version: number;
  expires_at: Date | null;
  window_seconds: number;
  lockout_seconds: number;
  rotation_policy: 'REVOKE_EXISTING' | 'PRESERVE_EXISTING';
}

interface AttemptRow {
  window_started_at: Date;
  failures: number;
  locked_until: Date | null;
}

export interface VerifyResult {
  status: AttemptStatus;
  outcome: 'granted' | 'rejected' | 'locked' | 'closed';
  grant?: { token: string; expiresAt: Date };
}

export interface GrantRow {
  id: string;
  kind: 'preauth' | 'bound';
  userId: string | null;
  accessVersion: string;
  expiresAt: Date;
}

export function bucketHash(
  secrets: Secrets,
  kind: 'cookie' | 'ip' | 'user',
  value: string,
): Buffer {
  return hmac(secrets.lookupKey, `bucket:${kind}`, value);
}

export function isAttemptToken(value: string | undefined): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

async function loadConfig(tx: Tx): Promise<AccessConfigRow> {
  const res = await tx.query<AccessConfigRow>(
    `SELECT version::text, min_valid_version::text, code_hash, pepper_version, expires_at,
            window_seconds, lockout_seconds, rotation_policy
       FROM app_private.access_config WHERE id = 1`,
  );
  const row = res.rows[0];
  if (!row) throw new AppError('INTERNAL', 'Access configuration missing.');
  return row;
}

function isOpen(config: AccessConfigRow, now: Date): boolean {
  return config.code_hash !== null && (config.expires_at === null || config.expires_at > now);
}

/** Window bookkeeping shared by verify and status. */
function effectiveAttempt(row: AttemptRow | undefined, config: AccessConfigRow, now: Date) {
  if (!row)
    return { failures: 0, lockedUntil: null as Date | null, windowStartedAt: now, reset: false };
  const locked = row.locked_until !== null && row.locked_until > now;
  const windowExpired =
    row.window_started_at.getTime() + config.window_seconds * 1000 <= now.getTime();
  if (!locked && (windowExpired || row.locked_until !== null)) {
    return { failures: 0, lockedUntil: null, windowStartedAt: now, reset: true };
  }
  return {
    failures: row.failures,
    lockedUntil: locked ? row.locked_until : null,
    windowStartedAt: row.window_started_at,
    reset: false,
  };
}

function statusFor(
  failures: number,
  lockedUntil: Date | null,
  gateStatus: AttemptStatus['gateStatus'],
): AttemptStatus {
  return {
    gateStatus: lockedUntil ? 'locked' : gateStatus,
    remainingAttempts: lockedUntil ? 0 : Math.max(0, MAX_FAILURES - failures),
    ...(lockedUntil ? { lockedUntil: lockedUntil.toISOString() } : {}),
  };
}

/** Cheap pre-hash IP limit (30 failures / 15 min) — never takes the bucket lock. */
async function ipBlocked(pool: pg.Pool, ipBucket: Buffer): Promise<boolean> {
  const res = await pool.query<{ failures: number; window_started_at: Date }>(
    `SELECT failures, window_started_at FROM app_private.access_attempts WHERE bucket_hash = $1`,
    [ipBucket],
  );
  const row = res.rows[0];
  if (!row) return false;
  return (
    row.failures >= IP_FAILURE_LIMIT && row.window_started_at.getTime() + IP_WINDOW_MS > Date.now()
  );
}

async function recordIpFailure(tx: Tx, ipBucket: Buffer, now: Date) {
  await tx.query(
    `INSERT INTO app_private.access_attempts (bucket_hash, kind, window_started_at, failures, expires_at)
     VALUES ($1, 'ip', $2, 1, $2::timestamptz + interval '1 day')
     ON CONFLICT (bucket_hash) DO UPDATE SET
       failures = CASE WHEN app_private.access_attempts.window_started_at + interval '15 minutes' <= $2
                       THEN 1 ELSE app_private.access_attempts.failures + 1 END,
       window_started_at = CASE WHEN app_private.access_attempts.window_started_at + interval '15 minutes' <= $2
                       THEN $2 ELSE app_private.access_attempts.window_started_at END,
       expires_at = $2::timestamptz + interval '1 day'`,
    [ipBucket, now],
  );
}

async function issueGrant(
  tx: Tx,
  secrets: Secrets,
  input: {
    kind: 'preauth' | 'bound';
    userId: string | null;
    authSessionId: string | null;
    accessVersion: string;
    expiresAt: Date;
  },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const token = randomToken();
  const res = await tx.query<{ id: string }>(
    `INSERT INTO app_private.gate_grants (token_hash, token_ciphertext, user_id, auth_session_id, access_version, kind, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      sha256(token),
      Buffer.from(secrets.encryptor.encrypt(token, 'gate-grant')),
      input.userId,
      input.authSessionId,
      input.accessVersion,
      input.kind,
      input.expiresAt,
    ],
  );
  return { id: one(res).id, token, expiresAt: input.expiresAt };
}

/**
 * POST /access/verify. Concurrent submissions for one attempt bucket serialize
 * on its row lock, so a third failure locks the window before a fourth guess
 * is evaluated (E01). A retried requestId replays its stored outcome without
 * counting or comparing again (DB/realtime §11).
 */
export async function verifyAccessCode(
  deps: GateDeps,
  input: { code: string; requestId: string; attemptToken: string; clientIp: string },
): Promise<VerifyResult> {
  const cookieBucket = bucketHash(deps.secrets, 'cookie', input.attemptToken);
  const ipBucket = bucketHash(deps.secrets, 'ip', input.clientIp);
  if (await ipBlocked(deps.pool, ipBucket)) {
    throw new AppError('RATE_LIMITED', 'Too many attempts from this network. Try again later.', {
      retryAfterSeconds: IP_WINDOW_MS / 1000,
    });
  }

  return withTransaction(
    deps.pool,
    async (tx) => {
      const now = await dbNow(tx);
      const config = await loadConfig(tx);
      await tx.query(
        `INSERT INTO app_private.access_attempts (bucket_hash, kind, window_started_at, failures, expires_at)
         VALUES ($1, 'cookie', $2, 0, $2::timestamptz + interval '1 day') ON CONFLICT (bucket_hash) DO NOTHING`,
        [cookieBucket, now],
      );
      const attempt = (
        await tx.query<AttemptRow>(
          `SELECT window_started_at, failures, locked_until FROM app_private.access_attempts
            WHERE bucket_hash = $1 FOR UPDATE`,
          [cookieBucket],
        )
      ).rows[0];

      const prior = await tx.query<{
        outcome: VerifyResult['outcome'];
        response: AttemptStatus;
        grant_id: string | null;
      }>(
        `SELECT outcome, response, grant_id FROM app_private.access_request_receipts
          WHERE bucket_hash = $1 AND request_id = $2`,
        [cookieBucket, input.requestId],
      );
      const replay = prior.rows[0];
      if (replay) return replayReceipt(tx, deps.secrets, replay, now);

      const state = effectiveAttempt(attempt, config, now);
      let result: VerifyResult;
      let grantId: string | null = null;

      const codeHash = config.code_hash;
      if (!isOpen(config, now) || codeHash === null) {
        result = {
          outcome: 'closed',
          status: statusFor(state.failures, state.lockedUntil, 'closed'),
        };
      } else if (state.lockedUntil) {
        // A correct code while locked does not unlock (DB/realtime §2.2).
        result = {
          outcome: 'locked',
          status: statusFor(state.failures, state.lockedUntil, 'locked'),
        };
      } else if (
        await deps.secrets.accessCodeHasher.verify(codeHash, input.code, config.pepper_version)
      ) {
        const expiresAt = new Date(
          Math.min(now.getTime() + PREAUTH_TTL_MS, config.expires_at?.getTime() ?? Infinity),
        );
        const grant = await issueGrant(tx, deps.secrets, {
          kind: 'preauth',
          userId: null,
          authSessionId: null,
          accessVersion: config.version,
          expiresAt,
        });
        grantId = grant.id;
        await tx.query(
          `UPDATE app_private.access_attempts SET failures = 0, locked_until = NULL, window_started_at = $2
            WHERE bucket_hash = $1`,
          [cookieBucket, now],
        );
        result = {
          outcome: 'granted',
          status: {
            gateStatus: 'preauth',
            remainingAttempts: MAX_FAILURES,
            grantExpiresAt: expiresAt.toISOString(),
          },
          grant: { token: grant.token, expiresAt },
        };
      } else {
        const failures = state.failures + 1;
        const lockedUntil =
          failures >= MAX_FAILURES ? new Date(now.getTime() + config.lockout_seconds * 1000) : null;
        await tx.query(
          `UPDATE app_private.access_attempts
              SET failures = $2, locked_until = $3, window_started_at = $4,
                  expires_at = GREATEST($4::timestamptz + make_interval(secs => $5), COALESCE($3, $4)) + interval '1 day'
            WHERE bucket_hash = $1`,
          [cookieBucket, failures, lockedUntil, state.windowStartedAt, config.window_seconds],
        );
        await recordIpFailure(tx, ipBucket, now);
        result = {
          outcome: lockedUntil ? 'locked' : 'rejected',
          status: statusFor(failures, lockedUntil, 'none'),
        };
      }

      await tx.query(
        `INSERT INTO app_private.access_request_receipts (bucket_hash, request_id, outcome, response, grant_id, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          cookieBucket,
          input.requestId,
          result.outcome === 'closed' ? 'rejected' : result.outcome,
          JSON.stringify(result.status),
          grantId,
          new Date(now.getTime() + RECEIPT_TTL_MS),
        ],
      );
      return result;
    },
    { statementTimeoutMs: 5_000 },
  );
}

async function replayReceipt(
  tx: Tx,
  secrets: Secrets,
  receipt: { outcome: VerifyResult['outcome']; response: AttemptStatus; grant_id: string | null },
  now: Date,
): Promise<VerifyResult> {
  if (receipt.outcome !== 'granted' || !receipt.grant_id) {
    return { outcome: receipt.outcome, status: receipt.response };
  }
  // Re-bind the SAME opaque grant instead of minting unlimited grants.
  const grant = await tx.query<{
    token_ciphertext: Buffer;
    expires_at: Date;
    revoked_at: Date | null;
  }>('SELECT token_ciphertext, expires_at, revoked_at FROM app_private.gate_grants WHERE id = $1', [
    receipt.grant_id,
  ]);
  const row = grant.rows[0];
  if (!row || row.revoked_at || row.expires_at <= now) {
    return {
      outcome: 'granted',
      status: { gateStatus: 'expired', remainingAttempts: MAX_FAILURES },
    };
  }
  const token = secrets.encryptor.decrypt(row.token_ciphertext.toString('utf8'), 'gate-grant');
  return {
    outcome: 'granted',
    status: receipt.response,
    grant: { token, expiresAt: row.expires_at },
  };
}

/** GET /access/status for the attempt bucket and current grant. */
export async function accessStatus(
  deps: GateDeps,
  input: { attemptToken: string | undefined; gateToken: string | undefined },
): Promise<AttemptStatus> {
  return withTransaction(
    deps.pool,
    async (tx) => {
      const now = await dbNow(tx);
      const config = await loadConfig(tx);
      if (input.gateToken) {
        const grant = await findValidGrant(tx, input.gateToken, now);
        if (grant) {
          return {
            gateStatus: grant.kind,
            remainingAttempts: MAX_FAILURES,
            grantExpiresAt: grant.expiresAt.toISOString(),
          };
        }
      }
      if (!isOpen(config, now)) return { gateStatus: 'closed', remainingAttempts: 0 };
      if (!input.attemptToken) return { gateStatus: 'none', remainingAttempts: MAX_FAILURES };
      const row = (
        await tx.query<AttemptRow>(
          'SELECT window_started_at, failures, locked_until FROM app_private.access_attempts WHERE bucket_hash = $1',
          [bucketHash(deps.secrets, 'cookie', input.attemptToken)],
        )
      ).rows[0];
      const state = effectiveAttempt(row, config, now);
      return statusFor(state.failures, state.lockedUntil, 'none');
    },
    { readOnly: true },
  );
}

/**
 * Validate an opaque grant token: unrevoked, unexpired, at least the minimum
 * valid access version, code not expired, and (for bound grants) inside the
 * 2-hour idle window. Returns null when invalid.
 */
export async function findValidGrant(
  tx: Tx,
  token: string,
  now: Date,
): Promise<(GrantRow & { lastSeenAt: Date }) | null> {
  const res = await tx.query<{
    id: string;
    kind: 'preauth' | 'bound';
    user_id: string | null;
    access_version: string;
    expires_at: Date;
    last_seen_at: Date;
  }>(
    `SELECT g.id, g.kind, g.user_id, g.access_version::text, g.expires_at, g.last_seen_at
       FROM app_private.gate_grants g
       JOIN app_private.access_config c ON c.id = 1
      WHERE g.token_hash = $1
        AND g.revoked_at IS NULL
        AND g.expires_at > $2
        AND g.access_version >= c.min_valid_version
        AND c.code_hash IS NOT NULL
        AND (c.expires_at IS NULL OR c.expires_at > $2)`,
    [sha256(token), now],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.kind === 'bound' && row.last_seen_at.getTime() + BOUND_IDLE_MS <= now.getTime())
    return null;
  return {
    id: row.id,
    kind: row.kind,
    userId: row.user_id,
    accessVersion: row.access_version,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
  };
}

/** Coalesced idle-window refresh (at most once a minute per grant). */
export async function touchGrant(tx: Tx, grantId: string, lastSeenAt: Date, now: Date) {
  if (now.getTime() - lastSeenAt.getTime() < 60_000) return;
  await tx.query('UPDATE app_private.gate_grants SET last_seen_at = $2 WHERE id = $1', [
    grantId,
    now,
  ]);
}

/**
 * After Auth succeeds, replace the presented grant with a fresh token bound to
 * the user (12 h TTL, never beyond code expiry). A grant bound to a different
 * user cannot be reused (GATE_REQUIRED).
 */
export async function bindGrant(
  tx: Tx,
  secrets: Secrets,
  input: { gateToken: string; userId: string; authSessionId: string; now: Date },
): Promise<{ id: string; token: string; expiresAt: Date }> {
  const grant = await findValidGrant(tx, input.gateToken, input.now);
  if (!grant) throw new AppError('GATE_REQUIRED', 'Verify the access code again.');
  if (grant.kind === 'bound' && grant.userId !== input.userId) {
    throw new AppError('GATE_REQUIRED', 'Verify the access code again.');
  }
  const config = await loadConfig(tx);
  await tx.query('UPDATE app_private.gate_grants SET revoked_at = $2 WHERE id = $1', [
    grant.id,
    input.now,
  ]);
  const expiresAt = new Date(
    Math.min(
      input.now.getTime() + BOUND_TTL_MS,
      config.expires_at?.getTime() ?? Number.POSITIVE_INFINITY,
    ),
  );
  return issueGrant(tx, secrets, {
    kind: 'bound',
    userId: input.userId,
    authSessionId: input.authSessionId,
    accessVersion: grant.accessVersion,
    expiresAt,
  });
}

export interface RotationInput {
  newCode: string;
  expiresAt: Date | null;
  windowSeconds: number;
  lockoutSeconds: number;
  rotationPolicy: 'REVOKE_EXISTING' | 'PRESERVE_EXISTING';
  expectedVersion: string;
  actorId: string;
}

/**
 * Rotate the website code (A + step-up). Overwrites the hash (old hashes are
 * never retained), bumps the version, and in revoke mode advances
 * min_valid_version and revokes every outstanding grant immediately.
 */
export async function rotateAccessCode(deps: GateDeps, input: RotationInput) {
  const hash = await deps.secrets.accessCodeHasher.hash(input.newCode);
  return withTransaction(deps.pool, async (tx) => {
    const now = await dbNow(tx);
    const current = await tx.query<{ version: string; min_valid_version: string }>(
      'SELECT version::text, min_valid_version::text FROM app_private.access_config WHERE id = 1 FOR UPDATE',
    );
    const row = one(current);
    if (row.version !== input.expectedVersion) {
      throw new AppError('VERSION_CONFLICT', 'The access settings changed. Reload and try again.', {
        currentVersion: row.version,
      });
    }
    if (input.expiresAt && input.expiresAt <= now) {
      throw new AppError('RULE_VIOLATION', 'Expiry must be in the future.');
    }
    const newVersion = (BigInt(row.version) + 1n).toString();
    const minValid =
      input.rotationPolicy === 'REVOKE_EXISTING' ? newVersion : row.min_valid_version;
    await tx.query(
      `UPDATE app_private.access_config
          SET version = $1, min_valid_version = $2, code_hash = $3, pepper_version = $4, expires_at = $5,
              window_seconds = $6, lockout_seconds = $7, rotation_policy = $8, updated_by = $9,
              updated_at = $10, rotated_at = $10
        WHERE id = 1`,
      [
        newVersion,
        minValid,
        hash,
        deps.secrets.accessCodeHasher.pepperVersion,
        input.expiresAt,
        input.windowSeconds,
        input.lockoutSeconds,
        input.rotationPolicy,
        input.actorId,
        now,
      ],
    );
    let revoked = 0;
    if (input.rotationPolicy === 'REVOKE_EXISTING') {
      const res = await tx.query(
        'UPDATE app_private.gate_grants SET revoked_at = $1 WHERE revoked_at IS NULL',
        [now],
      );
      revoked = res.rowCount ?? 0;
    }
    await tx.query(
      `INSERT INTO app_private.admin_audit (actor_id, action, target_class, safe_diff)
       VALUES ($1, 'access.rotated', 'access_config', $2)`,
      [
        input.actorId,
        JSON.stringify({
          fromVersion: row.version,
          toVersion: newVersion,
          policy: input.rotationPolicy,
          expiresAt: input.expiresAt?.toISOString() ?? null,
          windowSeconds: input.windowSeconds,
          lockoutSeconds: input.lockoutSeconds,
          revokedGrants: revoked,
        }),
      ],
    );
    return { version: newVersion, minValidVersion: minValid, revokedGrants: revoked };
  });
}

export async function readAccessSettings(pool: pg.Pool) {
  const res = await pool.query<{
    version: string;
    min_valid_version: string;
    configured: boolean;
    expires_at: Date | null;
    window_seconds: number;
    lockout_seconds: number;
    rotation_policy: string;
    rotated_at: Date | null;
  }>(
    `SELECT version::text, min_valid_version::text, code_hash IS NOT NULL AS configured, expires_at,
            window_seconds, lockout_seconds, rotation_policy, rotated_at
       FROM app_private.access_config WHERE id = 1`,
  );
  return one(res);
}
