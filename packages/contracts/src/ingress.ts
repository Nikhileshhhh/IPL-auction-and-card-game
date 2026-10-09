/**
 * Signed BFF → API ingress envelope (DB/realtime §2.1). Both sides compute
 * HMAC-SHA256(BFF_SIGNING_KEY, canonical) with their platform crypto; this
 * module only defines the canonical string so it cannot drift.
 */
export const INGRESS_HEADERS = {
  timestamp: 'x-stumps-ts',
  nonce: 'x-stumps-nonce',
  clientIp: 'x-stumps-ip',
  origin: 'x-stumps-origin',
  signature: 'x-stumps-signature',
  gate: 'x-stumps-gate',
  attempt: 'x-stumps-attempt',
  /** Forwarded only for admin MFA calls that need a provider session. */
  refresh: 'x-stumps-refresh',
} as const;

/** Maximum clock skew / nonce lifetime for a signed request. */
export const INGRESS_MAX_AGE_MS = 60_000;

export interface IngressFields {
  method: string;
  /** Path including query string, exactly as sent to the API. */
  pathWithQuery: string;
  timestampMs: number;
  nonce: string;
  clientIp: string;
  origin: string;
  /** Hex SHA-256 of the raw request body ('' for no body). */
  bodySha256: string;
  /** Hex SHA-256 of `authorization|gate|attempt|refresh` header values joined by '\n'. */
  credentialsSha256: string;
}

export function canonicalIngress(fields: IngressFields): string {
  return [
    'STUMPS-INGRESS-V1',
    fields.method.toUpperCase(),
    fields.pathWithQuery,
    String(fields.timestampMs),
    fields.nonce,
    fields.clientIp,
    fields.origin,
    fields.bodySha256,
    fields.credentialsSha256,
  ].join('\n');
}

export function credentialMaterial(
  authorization: string,
  gate: string,
  attempt: string,
  refresh = '',
): string {
  return [authorization, gate, attempt, refresh].join('\n');
}
