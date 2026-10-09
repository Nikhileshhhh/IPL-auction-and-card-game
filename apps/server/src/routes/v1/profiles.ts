import type { FastifyInstance } from 'fastify';
import { OnboardingRequestSchema, UsernameSchema } from '@stumps/contracts';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { parseBody } from '../../http/validation';
import { authenticateMember } from '../../modules/auth/service';
import { completeOnboarding, usernameAvailable } from '../../modules/profiles/onboarding';
import { consumeRate, RATE_RULES } from '../../modules/security/rate-limit';
import type { RuntimeDeps } from '../../runtime';

export async function profileRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  app.get('/profiles/availability', async (request) => {
    const ctx = await authenticateMember(deps, requireIngress(request));
    await consumeRate(deps.pool, deps.secrets.lookupKey, RATE_RULES.usernameCheck, ctx.userId);
    const parsed = UsernameSchema.safeParse(
      (request.query as { username?: string }).username ?? '',
    );
    if (!parsed.success) return success({ available: false }, request.id, new Date());
    return success(
      await usernameAvailable(deps.pool, parsed.data, ctx.userId),
      request.id,
      new Date(),
    );
  });

  app.patch('/profiles/me', async (request) => {
    const ctx = await authenticateMember(deps, requireIngress(request));
    const body = parseBody(OnboardingRequestSchema, request.body);
    const updated = await completeOnboarding(deps.pool, ctx, body);
    return success(
      {
        userId: ctx.userId,
        username: updated.username,
        displayName: updated.display_name,
        onboarded: true,
      },
      request.id,
      new Date(),
    );
  });
}
