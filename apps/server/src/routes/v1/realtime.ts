import type { FastifyInstance } from 'fastify';
import { success } from '../../http/envelope';
import { requireIngress } from '../../http/ingress';
import { authenticateMember } from '../../modules/auth/service';
import { issueTicket } from '../../realtime/tickets';
import type { RuntimeDeps } from '../../runtime';

export async function realtimeRoutes(app: FastifyInstance, deps: RuntimeDeps) {
  app.post('/socket-tickets', async (request) => {
    const ingress = requireIngress(request);
    const ctx = await authenticateMember(deps, ingress);
    const ticket = await issueTicket(
      deps.pool,
      deps.secrets,
      ctx,
      ingress.origin,
      deps.env.ALLOWED_ORIGINS,
    );
    return success(
      { ticket: ticket.ticket, expiresAt: ticket.expiresAt.toISOString() },
      request.id,
      new Date(),
    );
  });
}
