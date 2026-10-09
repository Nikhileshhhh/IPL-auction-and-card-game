import type { FastifyInstance } from 'fastify';
import { AccessVerifyRequestSchema } from '@stumps/contracts';
import { AppError } from '../../http/app-error';
import { sendDirectives } from '../../http/bff-directives';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import { randomToken } from '../../security/crypto';
import { accessStatus, isAttemptToken, verifyAccessCode } from '../../modules/access-gate/service';
import { consumeRate, RATE_RULES } from '../../modules/security/rate-limit';
import type { RuntimeDeps } from '../../runtime';

export async function accessRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  /** S01 status. Mints the 256-bit attempt bucket token on first contact (≤10/15 min per IP). */
  app.get('/access/status', async (request, reply) => {
    const ingress = requireIngress(request);
    let attemptToken = isAttemptToken(ingress.attemptToken) ? ingress.attemptToken : undefined;
    if (!attemptToken) {
      await consumeRate(
        deps.pool,
        deps.secrets.lookupKey,
        RATE_RULES.attemptMint,
        ingress.clientIp,
      );
      attemptToken = randomToken();
      sendDirectives(reply, { setAttempt: { token: attemptToken } });
    }
    const status = await accessStatus(deps, { attemptToken, gateToken: ingress.gateToken });
    return success(status, request.id, new Date());
  });

  app.post('/access/verify', async (request, reply) => {
    const ingress = requireIngress(request);
    const body = parseBody(AccessVerifyRequestSchema, request.body);
    if (!isAttemptToken(ingress.attemptToken)) {
      throw new AppError('VALIDATION_FAILED', 'Reload the page and try again.');
    }
    const result = await verifyAccessCode(deps, {
      code: body.code,
      requestId: body.requestId,
      attemptToken: ingress.attemptToken,
      clientIp: ingress.clientIp,
    });
    if (result.outcome === 'granted' && result.grant) {
      sendDirectives(reply, {
        setGate: { token: result.grant.token, expiresAt: result.grant.expiresAt.toISOString() },
      });
      return success(result.status, request.id, new Date());
    }
    if (result.outcome === 'granted') {
      // Replayed success whose grant has since expired.
      throw new AppError('GATE_INVALID', 'Your verification expired. Enter the code again.', {
        status: result.status,
      });
    }
    if (result.outcome === 'locked') {
      throw new AppError('ACCESS_LOCKED', 'Too many incorrect codes. Try again later.', {
        status: result.status,
        retryAfterSeconds: result.status.lockedUntil
          ? Math.max(1, Math.ceil((Date.parse(result.status.lockedUntil) - Date.now()) / 1000))
          : 60,
      });
    }
    if (result.outcome === 'closed') {
      throw new AppError('GATE_INVALID', 'Access is not open right now.', {
        status: result.status,
      });
    }
    throw new AppError('GATE_INVALID', 'That code is not valid.', { status: result.status });
  });
}
