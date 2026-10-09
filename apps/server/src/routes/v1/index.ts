import type { FastifyInstance } from 'fastify';
import { API_VERSION, CONTRACTS_VERSION, SPEC_VERSION } from '@stumps/contracts';
import { success } from '../../http/envelope';

/** Versioned API root. Feature modules register here as their phases land. */
export async function v1Routes(app: FastifyInstance) {
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
}
