/**
 * Error code registry. Must stay identical to `schema/error-codes.json`
 * (verified by `pnpm contracts:check`).
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: { http: 400, retryable: false },
  UNKNOWN_COMMAND: { http: 400, retryable: false },
  PAYLOAD_TOO_LARGE: { http: 400, retryable: false },
  UNAUTHENTICATED: { http: 401, retryable: false },
  SESSION_REVOKED: { http: 401, retryable: false },
  BAD_CREDENTIALS: { http: 401, retryable: false },
  GATE_INVALID: { http: 403, retryable: false },
  GATE_REQUIRED: { http: 403, retryable: false },
  FORBIDDEN: { http: 403, retryable: false },
  BANNED: { http: 403, retryable: false },
  ADMIN_REQUIRED: { http: 403, retryable: false },
  MFA_REQUIRED: { http: 403, retryable: false },
  STEP_UP_REQUIRED: { http: 403, retryable: false },
  ORIGIN_FORBIDDEN: { http: 403, retryable: false },
  CSRF_INVALID: { http: 403, retryable: false },
  TICKET_INVALID: { http: 403, retryable: false },
  SELECTOR_ONLY: { http: 403, retryable: false },
  NOT_RECIPIENT: { http: 403, retryable: false },
  CHAT_FORBIDDEN: { http: 403, retryable: false },
  NOT_FOUND: { http: 404, retryable: false },
  JOIN_FAILED: { http: 404, retryable: false },
  STATE_CONFLICT: { http: 409, retryable: false },
  VERSION_CONFLICT: { http: 409, retryable: false },
  STALE_CONFIG: { http: 409, retryable: false },
  STALE_COMPARISON: { http: 409, retryable: false },
  STALE_BID: { http: 409, retryable: false },
  ALREADY_LEADING: { http: 409, retryable: false },
  CONTROL_EPOCH_STALE: { http: 409, retryable: false },
  IDEMPOTENCY_CONFLICT: { http: 409, retryable: false },
  FRANCHISE_TAKEN: { http: 409, retryable: false },
  VOTE_IN_PROGRESS: { http: 409, retryable: false },
  VOTE_ALREADY_CAST: { http: 409, retryable: false },
  ALREADY_COMPLETED: { http: 409, retryable: false },
  USERNAME_TAKEN: { http: 409, retryable: false },
  ROOM_GONE: { http: 410, retryable: false },
  RESULTS_EXPIRED: { http: 410, retryable: false },
  CALLBACK_EXPIRED: { http: 410, retryable: false },
  VOTE_EXPIRED: { http: 410, retryable: false },
  RULE_VIOLATION: { http: 422, retryable: false },
  ROOM_FULL: { http: 422, retryable: false },
  GAME_MISMATCH: { http: 422, retryable: false },
  GAME_STARTED: { http: 422, retryable: false },
  NOT_READY: { http: 422, retryable: false },
  CONFIG_INVALID: { http: 422, retryable: false },
  POOL_INSUFFICIENT: { http: 422, retryable: false },
  PASSWORD_POLICY: { http: 422, retryable: false },
  EMAIL_LIMIT: { http: 429, retryable: true },
  BUDGET_RESERVE: { http: 422, retryable: false },
  SQUAD_FULL: { http: 422, retryable: false },
  OVERSEAS_LIMIT: { http: 422, retryable: false },
  XI_INFEASIBLE: { http: 422, retryable: false },
  LATE_BID: { http: 422, retryable: false },
  GAME_PAUSED: { http: 422, retryable: false },
  RTM_UNAVAILABLE: { http: 422, retryable: false },
  RETENTION_INVALID: { http: 422, retryable: false },
  PURSE_INVALID: { http: 422, retryable: false },
  PAUSE_NOT_ALLOWED: { http: 422, retryable: false },
  TEAM_FULL: { http: 422, retryable: false },
  VOTE_COOLDOWN: { http: 422, retryable: false },
  VOTE_LIMIT: { http: 422, retryable: false },
  PUBLISH_BLOCKED: { http: 422, retryable: false },
  MUTED: { http: 422, retryable: false },
  LAST_ADMIN: { http: 422, retryable: false },
  ACCESS_LOCKED: { http: 429, retryable: true },
  RATE_LIMITED: { http: 429, retryable: true },
  SERVICE_UNAVAILABLE: { http: 503, retryable: true },
  INTERNAL: { http: 500, retryable: false },
} as const satisfies Record<string, { http: number; retryable: boolean }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CODES[code].http;
}

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code].retryable;
}
