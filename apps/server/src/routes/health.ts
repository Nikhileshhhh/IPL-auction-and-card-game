import type { FastifyInstance } from 'fastify';
import { runChecks, type ReadinessCheck } from '../http/readiness';
import { success } from '../http/envelope';

export interface HealthRouteOptions {
  readinessChecks: readonly ReadinessCheck[];
}

export async function healthRoutes(app: FastifyInstance, opts: HealthRouteOptions) {
  app.get('/health/live', async (request) =>
    success({ status: 'live' as const }, request.id, new Date()),
  );

  app.get('/health/ready', async (request, reply) => {
    const checks = await runChecks(opts.readinessChecks);
    const ready = checks.length > 0 && checks.every((check) => check.ok);
    reply.code(ready ? 200 : 503);
    return success(
      {
        status: ready ? ('ready' as const) : ('not_ready' as const),
        checks: checks.map(({ name, ok, detail }) =>
          detail ? { name, ok, detail } : { name, ok },
        ),
      },
      request.id,
      new Date(),
    );
  });
}
