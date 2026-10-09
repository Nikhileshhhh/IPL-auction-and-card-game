import type { FastifyInstance } from 'fastify';
import { API_VERSION, CONTRACTS_VERSION, SPEC_VERSION } from '@stumps/contracts';
import { success } from '../../http/envelope';
import type { RuntimeDeps } from '../../runtime';
import { accessRoutes } from './access';
import { adminRoutes } from './admin';
import { authRoutes } from './auth';
import { profileRoutes } from './profiles';
import { realtimeRoutes } from './realtime';

/** Versioned API root. Feature modules register here as their phases land. */
export async function v1Routes(app: FastifyInstance, opts: { runtime?: RuntimeDeps }) {
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
  });

  app.get('/meta/version', async (request) =>
    success(
      { apiVersion: API_VERSION, specVersion: SPEC_VERSION, contractsVersion: CONTRACTS_VERSION },
      request.id,
      new Date(),
    ),
  );

  const runtime = opts.runtime;
  if (!runtime) return;
  await accessRoutes(app, runtime);
  await authRoutes(app, runtime);
  await profileRoutes(app, runtime);
  await adminRoutes(app, runtime);
  await realtimeRoutes(app, runtime);
}
