import type { FastifyInstance } from 'fastify';
import {
  AccessRotationRequestSchema,
  AdminAbortSchema,
  Uuid,
  AdminChallengeRequestSchema,
  AdminMfaRequestSchema,
  LoginRequestSchema,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { sendDirectives } from '../../http/bff-directives';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import { randomToken } from '../../security/crypto';
import { readAccessSettings, rotateAccessCode } from '../../modules/access-gate/service';
import {
  adminChallenge,
  adminEnrollTotp,
  adminLogin,
  adminVerifyTotp,
  requireAdmin,
} from '../../modules/admin/service';
import { logout } from '../../modules/auth/service';
import { adminAbort, cleanupQueue, retryCleanup } from '../../modules/cleanup/admin';
import { redirectOrigin, type RuntimeDeps } from '../../runtime';

export async function adminRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  app.post('/admin/auth/login', async (request, reply) => {
    const ingress = requireIngress(request);
    const body = parseBody(LoginRequestSchema, request.body);
    const { tokens, result } = await adminLogin(deps, {
      email: body.email,
      password: body.password,
      ingress,
    });
    sendDirectives(reply, {
      setSession: {
        scope: 'admin',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt.toISOString(),
      },
      rotateCsrf: true,
    });
    return success(result, request.id, new Date());
  });

  app.post('/admin/auth/mfa/enroll', async (request) => {
    const ingress = requireIngress(request);
    const ctx = await requireAdmin(deps, ingress, { aal2: false });
    const enrollment = await adminEnrollTotp(deps, ctx, ingress, ingress.refreshToken);
    return success(enrollment, request.id, new Date());
  });

  /** Verified factor IDs for challenge/step-up (needs the provider session). */
  app.post('/admin/auth/mfa/factors', async (request) => {
    const ingress = requireIngress(request);
    await requireAdmin(deps, ingress, { aal2: false });
    if (!ingress.bearer || !ingress.refreshToken) {
      return success({ factorIds: [] as string[] }, request.id, new Date());
    }
    const factors = await deps.auth.listVerifiedFactors({
      accessToken: ingress.bearer,
      refreshToken: ingress.refreshToken,
      expiresAt: new Date(),
    });
    return success({ factorIds: factors.map((f) => f.id) }, request.id, new Date());
  });

  app.post('/admin/auth/mfa/challenge', async (request) => {
    const ingress = requireIngress(request);
    await requireAdmin(deps, ingress, { aal2: false });
    const body = parseBody(AdminChallengeRequestSchema, request.body);
    return success(
      await adminChallenge(deps, ingress, ingress.refreshToken, body.factorId),
      request.id,
      new Date(),
    );
  });

  /** Upgrades to AAL2 and doubles as step-up re-verification. */
  app.post('/admin/auth/mfa', async (request, reply) => {
    const ingress = requireIngress(request);
    const ctx = await requireAdmin(deps, ingress, { aal2: false });
    const body = parseBody(AdminMfaRequestSchema, request.body);
    const tokens = await adminVerifyTotp(deps, ctx, ingress, ingress.refreshToken, body);
    sendDirectives(reply, {
      setSession: {
        scope: 'admin',
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt.toISOString(),
      },
    });
    return success({ aal: 'aal2', role: ctx.role }, request.id, new Date());
  });

  app.post('/admin/auth/logout', async (request, reply) => {
    const ingress = requireIngress(request);
    sendDirectives(reply, { clearSession: 'admin', rotateCsrf: true });
    if (ingress.bearer) {
      const identity = await deps.auth.verifyAccessToken(ingress.bearer).catch(() => undefined);
      if (identity)
        await logout(
          { ...deps, redirectOrigin: redirectOrigin(deps.env) },
          identity,
          'current',
          'admin',
        );
    }
    return success({ signedOut: true }, request.id, new Date());
  });

  app.get('/admin/me', async (request) => {
    const ctx = await requireAdmin(deps, requireIngress(request), { aal2: true });
    return success(
      {
        userId: ctx.userId,
        role: ctx.role,
        stepUpValidUntil: ctx.stepUpAt
          ? new Date(ctx.stepUpAt.getTime() + 300_000).toISOString()
          : null,
      },
      request.id,
      new Date(),
    );
  });

  /** Current gate policy (never the code or its hash). */
  app.get('/admin/access', async (request) => {
    await requireAdmin(deps, requireIngress(request), { aal2: true });
    const row = await readAccessSettings(deps.pool);
    return success(
      {
        version: row.version,
        minValidVersion: row.min_valid_version,
        configured: row.configured,
        expiresAt: row.expires_at?.toISOString() ?? null,
        windowSeconds: row.window_seconds,
        lockoutSeconds: row.lockout_seconds,
        rotationPolicy: row.rotation_policy,
        rotatedAt: row.rotated_at?.toISOString() ?? null,
      },
      request.id,
      new Date(),
    );
  });

  /** S33 operations cleanup queue (safe fields only). */
  app.get('/admin/cleanup', async (request) => {
    await requireAdmin(deps, requireIngress(request), { aal2: true });
    return success(await cleanupQueue(deps.pool), request.id, new Date());
  });

  /** Retry a stuck cleanup now (expired, aborted or purging rooms only). */
  app.post('/admin/cleanup/:roomId/retry', async (request) => {
    const ctx = await requireAdmin(deps, requireIngress(request), { aal2: true });
    const roomId = Uuid.safeParse((request.params as { roomId: string }).roomId);
    if (!roomId.success) throw new AppError('NOT_FOUND', 'Room not found.');
    return success(await retryCleanup(deps.pool, ctx.userId, roomId.data), request.id, new Date());
  });

  /** Integrity abort: admin + AAL2 + step-up; no medals, no results period. */
  app.post('/admin/rooms/:id/abort', async (request) => {
    const ctx = await requireAdmin(deps, requireIngress(request), { aal2: true, stepUp: true });
    const roomId = Uuid.safeParse((request.params as { id: string }).id);
    if (!roomId.success) throw new AppError('NOT_FOUND', 'Room not found.');
    const body = parseBody(AdminAbortSchema, request.body);
    return success(
      await adminAbort(deps.pool, ctx.userId, roomId.data, body.reason),
      request.id,
      new Date(),
    );
  });

  /** Rotate the website code: admin + AAL2 + step-up within 5 minutes. */
  app.put('/admin/access', async (request) => {
    const ctx = await requireAdmin(deps, requireIngress(request), { aal2: true, stepUp: true });
    const body = parseBody(AccessRotationRequestSchema, request.body);
    const newCode = body.generate ? randomToken(16) : (body.newCode ?? '');
    if (newCode.length < 12) throw new AppError('VALIDATION_FAILED', 'Provide a new code.');
    const result = await rotateAccessCode(deps, {
      newCode,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      windowSeconds: body.windowSeconds,
      lockoutSeconds: body.lockoutSeconds,
      rotationPolicy: body.rotationPolicy,
      expectedVersion: body.version,
      actorId: ctx.userId,
    });
    if (body.rotationPolicy === 'REVOKE_EXISTING') {
      deps.bus.emit({ kind: 'access.revoked', minValidVersion: result.minValidVersion });
    }
    // A generated code is shown exactly once; it is never stored or logged.
    return success(
      { ...result, ...(body.generate ? { generatedCode: newCode } : {}) },
      request.id,
      new Date(),
    );
  });
}
