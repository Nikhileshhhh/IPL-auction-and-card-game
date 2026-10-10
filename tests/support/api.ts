import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import * as OTPAuth from 'otpauth';
import { INGRESS_HEADERS, canonicalIngress, credentialMaterial } from '@stumps/contracts';
import { buildApp } from '../../apps/server/src/app';
import { loadEnv } from '../../apps/server/src/config/env';
import { loadSecrets, type Secrets } from '../../apps/server/src/config/secrets';
import { LocalAuthProvider } from '../../apps/server/src/modules/auth/local-provider';
import { SecurityBus } from '../../apps/server/src/realtime/security-bus';
import {
  BFF_DIRECTIVES_HEADER,
  type BffDirectives,
} from '../../apps/server/src/http/bff-directives';
import { sha256 } from '../../apps/server/src/security/crypto';
import type { RuntimeDeps } from '../../apps/server/src/runtime';
import { createRoomRuntime } from '../../apps/server/src/modules/rooms/runtime';
import { connect, databaseUrlFor, resetDatabase, runtimeUrl } from './db';

export const TEST_ORIGIN = 'http://play.test';
export const ACCESS_CODE = 'correct-horse-battery-staple';

function secret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export interface TestApi {
  app: FastifyInstance;
  deps: RuntimeDeps;
  pool: pg.Pool;
  admin: pg.Client;
  secrets: Secrets;
  dbName: string;
  close(): Promise<void>;
  setAccessCode(
    code: string,
    options?: { policy?: 'REVOKE_EXISTING' | 'PRESERVE_EXISTING' },
  ): Promise<void>;
  client(ip?: string): BffClient;
  outbox(email: string): Promise<{ link: string; kind: string }[]>;
}

/** Spin up the real API (runtime deps + LocalAuthProvider) on a fresh database. */
export async function createTestApi(dbName: string): Promise<TestApi> {
  await resetDatabase(dbName);
  const env = loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_ORIGIN: TEST_ORIGIN,
    ALLOWED_ORIGINS: TEST_ORIGIN,
    AUTH_PROVIDER: 'local',
    LOCAL_AUTH_JWT_SECRET: secret(48),
    BFF_SIGNING_KEY: secret(),
    ACCESS_CODE_PEPPER_V1: secret(),
    ROOM_PASSWORD_PEPPER_V1: secret(),
    INVITE_LOOKUP_HMAC_KEY: secret(),
    DATA_ENCRYPTION_KEY_V1: secret(),
  });
  const pool = new pg.Pool({ connectionString: runtimeUrl(dbName), max: 8 });
  const secrets = loadSecrets(env);
  const auth = new LocalAuthProvider({
    nodeEnv: 'test',
    jwtSecret: env.LOCAL_AUTH_JWT_SECRET!,
    pool,
  });
  const deps: RuntimeDeps = {
    env,
    pool,
    secrets,
    auth,
    bus: new SecurityBus(),
    rooms: createRoomRuntime(pool, secrets),
  };
  const app = await buildApp({ env, readinessChecks: [], runtime: deps });
  await app.ready();
  const admin = await connect(databaseUrlFor(dbName));

  const api: TestApi = {
    app,
    deps,
    pool,
    admin,
    secrets,
    dbName,
    async close() {
      await app.close();
      await pool.end();
      await admin.end();
    },
    async setAccessCode(code, options = {}) {
      const hash = await secrets.accessCodeHasher.hash(code);
      await admin.query(
        `UPDATE app_private.access_config
            SET code_hash = $1, version = version + 1,
                min_valid_version = CASE WHEN $2 = 'REVOKE_EXISTING' THEN version + 1 ELSE min_valid_version END,
                rotation_policy = $2`,
        [hash, options.policy ?? 'REVOKE_EXISTING'],
      );
    },
    client(ip = '203.0.113.10') {
      return new BffClient(app, secrets.bffSigningKey, ip);
    },
    async outbox(email) {
      const res = await admin.query<{ link: string; kind: string }>(
        'SELECT link, kind FROM auth_local.outbox WHERE email = lower($1) ORDER BY id',
        [email],
      );
      return res.rows;
    },
  };
  return api;
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string; details?: Record<string, unknown> };
  };
  headers: Record<string, string | string[] | number | undefined>;
}

/**
 * Simulates the Next BFF: holds HttpOnly cookie values, signs every request,
 * applies directives and never exposes them as browser JSON.
 */
export class BffClient {
  attempt: string | undefined;
  gate: string | undefined;
  member: { accessToken: string; refreshToken: string } | undefined;
  adminSession: { accessToken: string; refreshToken: string } | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly key: Buffer,
    readonly ip: string,
    readonly origin = TEST_ORIGIN,
  ) {}

  /** Copy cookies to model a second tab in the same browser. */
  clone(): BffClient {
    const c = new BffClient(this.app, this.key, this.ip, this.origin);
    c.attempt = this.attempt;
    c.gate = this.gate;
    c.member = this.member && { ...this.member };
    c.adminSession = this.adminSession && { ...this.adminSession };
    return c;
  }

  signedHeaders(
    method: string,
    url: string,
    body: string,
    opts: { admin?: boolean; refresh?: string } = {},
  ) {
    const session = opts.admin ? this.adminSession : this.member;
    const authorization = session ? `Bearer ${session.accessToken}` : '';
    const gate = this.gate ?? '';
    const attempt = this.attempt ?? '';
    const refresh = opts.refresh ?? '';
    const ts = Date.now();
    const nonce = randomBytes(18).toString('base64url');
    const canonical = canonicalIngress({
      method,
      pathWithQuery: url,
      timestampMs: ts,
      nonce,
      clientIp: this.ip,
      origin: this.origin,
      bodySha256: sha256(body).toString('hex'),
      credentialsSha256: sha256(credentialMaterial(authorization, gate, attempt, refresh)).toString(
        'hex',
      ),
    });
    const headers: Record<string, string> = {
      [INGRESS_HEADERS.timestamp]: String(ts),
      [INGRESS_HEADERS.nonce]: nonce,
      [INGRESS_HEADERS.clientIp]: this.ip,
      [INGRESS_HEADERS.origin]: this.origin,
      [INGRESS_HEADERS.signature]: createHmac('sha256', this.key)
        .update(canonical)
        .digest('base64url'),
    };
    if (authorization) headers.authorization = authorization;
    if (gate) headers[INGRESS_HEADERS.gate] = gate;
    if (attempt) headers[INGRESS_HEADERS.attempt] = attempt;
    if (refresh) headers[INGRESS_HEADERS.refresh] = refresh;
    if (body) headers['content-type'] = 'application/json';
    return headers;
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    payload?: unknown,
    opts: { admin?: boolean; refresh?: string; rawHeaders?: Record<string, string> } = {},
  ): Promise<ApiResponse<T>> {
    const body = payload === undefined ? '' : JSON.stringify(payload);
    const headers = { ...this.signedHeaders(method, url, body, opts), ...(opts.rawHeaders ?? {}) };
    const res = await this.app.inject({ method, url, headers, ...(body ? { payload: body } : {}) });
    const directives = res.headers[BFF_DIRECTIVES_HEADER];
    if (typeof directives === 'string')
      this.apply(JSON.parse(Buffer.from(directives, 'base64url').toString()) as BffDirectives);
    return { status: res.statusCode, body: res.json(), headers: res.headers };
  }

  /** Mutation with an `Idempotency-Key` (fresh unless a retry key is supplied). */
  async mutate<T = unknown>(
    method: 'POST' | 'PATCH',
    url: string,
    payload: unknown = {},
    key: string = randomUUID(),
  ): Promise<ApiResponse<T>> {
    return this.request<T>(method, url, payload, { rawHeaders: { 'idempotency-key': key } });
  }

  apply(d: BffDirectives) {
    if (d.setAttempt) this.attempt = d.setAttempt.token;
    if (d.setGate) this.gate = d.setGate.token;
    if (d.clearGate) this.gate = undefined;
    if (d.clearSession === 'member') this.member = undefined;
    if (d.clearSession === 'admin') this.adminSession = undefined;
    if (d.setSession?.scope === 'member')
      this.member = {
        accessToken: d.setSession.accessToken,
        refreshToken: d.setSession.refreshToken,
      };
    if (d.setSession?.scope === 'admin')
      this.adminSession = {
        accessToken: d.setSession.accessToken,
        refreshToken: d.setSession.refreshToken,
      };
  }

  async passGate(code = ACCESS_CODE) {
    if (!this.attempt) await this.request('GET', '/v1/access/status');
    return this.request('POST', '/v1/access/verify', { code, requestId: randomUUID() });
  }
}

/** Full happy path: gate → enroll → invite link → callback → password → onboard. */
let ipCounter = 0;
/** Distinct TEST-NET addresses so per-IP rate limits model separate visitors. */
export function nextIp(): string {
  ipCounter += 1;
  return `198.18.${Math.floor(ipCounter / 250) % 250}.${(ipCounter % 250) + 1}`;
}

export async function onboardMember(
  api: TestApi,
  username: string,
  password = 'a-long-test-password',
) {
  const client = api.client(nextIp());
  await client.passGate();
  const email = `${username}@example.test`;
  const enroll = await client.request('POST', '/v1/auth/enroll', { email });
  if (enroll.status !== 200) throw new Error(`enroll failed ${JSON.stringify(enroll.body)}`);
  const [mail] = await api.outbox(email);
  const link = new URL(mail!.link);
  const callback = await client.request('POST', '/v1/auth/callback', {
    tokenHash: link.searchParams.get('token_hash'),
    enrollment: link.searchParams.get('enrollment'),
  });
  if (callback.status !== 200) throw new Error(`callback failed ${JSON.stringify(callback.body)}`);
  await client.request('POST', '/v1/auth/password', { password });
  const onboard = await client.request('PATCH', '/v1/profiles/me', {
    username,
    displayName: username.toUpperCase(),
    visibility: 'members',
    activityVisible: true,
  });
  if (onboard.status !== 200) throw new Error(`onboarding failed ${JSON.stringify(onboard.body)}`);
  const me = await client.request<{ userId: string }>('GET', '/v1/me');
  return { client, email, password, userId: me.body.data!.userId };
}

/** Grant an admin role with an open MFA enrollment window (operator path). */
export async function makeAdmin(api: TestApi, userId: string) {
  await api.admin.query(
    `INSERT INTO app_private.admin_assignments (user_id, role, mfa_enrollment_until)
     VALUES ($1, 'super_admin', now() + interval '1 hour')`,
    [userId],
  );
}

export function totpCode(secret: string): string {
  return new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(secret),
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
  }).generate();
}

/** Admin login + first-factor enrollment + AAL2 verification. Returns the TOTP secret. */
export async function adminSignIn(
  api: TestApi,
  email: string,
  password: string,
  client = api.client(nextIp()),
) {
  const login = await client.request<{ factorIds: string[]; enrollmentAllowed: boolean }>(
    'POST',
    '/v1/admin/auth/login',
    { email, password },
  );
  if (login.status !== 200) throw new Error(`admin login failed ${JSON.stringify(login.body)}`);
  const enroll = await client.request<{ factorId: string; secret: string }>(
    'POST',
    '/v1/admin/auth/mfa/enroll',
    undefined,
    {
      admin: true,
      refresh: client.adminSession!.refreshToken,
    },
  );
  if (enroll.status !== 200) throw new Error(`enroll failed ${JSON.stringify(enroll.body)}`);
  const { factorId, secret } = enroll.body.data!;
  const verified = await verifyTotp(client, factorId, secret);
  if (verified.status !== 200)
    throw new Error(`mfa verify failed ${JSON.stringify(verified.body)}`);
  return { client, factorId, secret };
}

export async function verifyTotp(client: BffClient, factorId: string, secret: string) {
  const challenge = await client.request<{ challengeId: string }>(
    'POST',
    '/v1/admin/auth/mfa/challenge',
    { factorId },
    { admin: true, refresh: client.adminSession!.refreshToken },
  );
  return client.request(
    'POST',
    '/v1/admin/auth/mfa',
    {
      factorId,
      challengeId: challenge.body.data!.challengeId,
      code: totpCode(secret),
    },
    { admin: true, refresh: client.adminSession!.refreshToken },
  );
}
