import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  EnrollRequestSchema,
  InviteCallbackRequestSchema,
  LoginRequestSchema,
  LogoutRequestSchema,
  RecoveryCompleteRequestSchema,
  RecoveryRequestSchema,
  SetPasswordRequestSchema,
} from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { sendDirectives } from '../../http/bff-directives';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import {
  authenticateMember,
  completeInvite,
  completeRecovery,
  enroll,
  login,
  logout,
  projectionOf,
  refresh,
  requestRecovery,
  setPassword,
} from '../../modules/auth/service';
import type { AuthTokens } from '../../modules/auth/provider';
import { redirectOrigin, type RuntimeDeps } from '../../runtime';

function sessionDirectives(
  reply: FastifyReply,
  tokens: AuthTokens,
  grant?: { token: string; expiresAt: Date },
) {
  sendDirectives(reply, {
    setSession: {
      scope: 'member',
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
    },
    ...(grant ? { setGate: { token: grant.token, expiresAt: grant.expiresAt.toISOString() } } : {}),
    rotateCsrf: true,
  });
}

export async function authRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  const authDeps = { ...deps, redirectOrigin: redirectOrigin(deps.env) };

  app.post('/auth/login', async (request, reply) => {
    const ingress = requireIngress(request);
    const body = parseBody(LoginRequestSchema, request.body);
    const result = await login(authDeps, { email: body.email, password: body.password, ingress });
    sessionDirectives(reply, result.tokens, result.grant);
    return success(result.projection, request.id, new Date());
  });

  app.post('/auth/enroll', async (request) => {
    const ingress = requireIngress(request);
    const body = parseBody(EnrollRequestSchema, request.body);
    return success(await enroll(authDeps, { email: body.email, ingress }), request.id, new Date());
  });

  app.post('/auth/callback', async (request, reply) => {
    const ingress = requireIngress(request);
    const body = parseBody(InviteCallbackRequestSchema, request.body);
    const result = await completeInvite(authDeps, {
      tokenHash: body.tokenHash,
      enrollment: body.enrollment,
      ingress,
    });
    sessionDirectives(reply, result.tokens, result.grant);
    return success({ ...result.projection, needsPassword: true }, request.id, new Date());
  });

  app.post('/auth/password', async (request) => {
    const ingress = requireIngress(request);
    const ctx = await authenticateMember(deps, ingress);
    const body = parseBody(SetPasswordRequestSchema, request.body);
    await setPassword(authDeps, ctx, body.password);
    return success({ updated: true }, request.id, new Date());
  });

  app.post('/auth/recovery', async (request) => {
    const ingress = requireIngress(request);
    const body = parseBody(RecoveryRequestSchema, request.body);
    return success(
      await requestRecovery(authDeps, { email: body.email, ingress }),
      request.id,
      new Date(),
    );
  });

  app.post('/auth/recovery/complete', async (request, reply) => {
    const ingress = requireIngress(request);
    const body = parseBody(RecoveryCompleteRequestSchema, request.body);
    const result = await completeRecovery(authDeps, {
      tokenHash: body.tokenHash,
      password: body.password,
      ingress,
    });
    sessionDirectives(reply, result.tokens, result.grant);
    return success(result.projection, request.id, new Date());
  });

  /** Cookie-only refresh: the BFF forwards the refresh token in the signed credential header. */
  app.post('/auth/refresh', async (request, reply) => {
    const ingress = requireIngress(request);
    const scope = (request.query as { scope?: string }).scope === 'admin' ? 'admin' : 'member';
    if (!ingress.refreshToken) throw new AppError('UNAUTHENTICATED', 'Sign in again.');
    try {
      const tokens = await refresh(authDeps, ingress.refreshToken, scope);
      sendDirectives(reply, {
        setSession: {
          scope,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt.toISOString(),
        },
      });
      return success({ expiresAt: tokens.expiresAt.toISOString() }, request.id, new Date());
    } catch (error) {
      sendDirectives(reply, { clearSession: scope });
      throw error;
    }
  });

  app.post('/auth/logout', async (request, reply) => {
    const ingress = requireIngress(request);
    const body = parseBody(LogoutRequestSchema, request.body);
    sendDirectives(reply, { clearSession: 'member', rotateCsrf: true });
    if (ingress.bearer) {
      const identity = await deps.auth.verifyAccessToken(ingress.bearer).catch(() => undefined);
      if (identity) await logout(authDeps, identity, body.scope, 'member');
    }
    return success({ signedOut: true }, request.id, new Date());
  });

  app.get('/me', async (request) => {
    const ctx = await authenticateMember(deps, requireIngress(request));
    return success(projectionOf(ctx), request.id, new Date());
  });
}
