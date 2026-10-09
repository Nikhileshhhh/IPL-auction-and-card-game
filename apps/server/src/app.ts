import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import { MAX_PAYLOAD_BYTES } from '@stumps/contracts';
import type { ServerEnv } from './config/env';
import { loggerOptions } from './observability/logger';
import { AppError } from './http/app-error';
import { failure } from './http/envelope';
import type { ReadinessCheck } from './http/readiness';
import { healthRoutes } from './routes/health';
import { v1Routes } from './routes/v1/index';

export interface AppDependencies {
  env: ServerEnv;
  readinessChecks: readonly ReadinessCheck[];
}

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions(deps.env.LOG_LEVEL),
    bodyLimit: MAX_PAYLOAD_BYTES,
    // Request IDs are generated server-side only; incoming headers are not trusted.
    genReqId: () => `req_${randomUUID()}`,
    requestIdHeader: false,
    trustProxy: false,
  });

  await app.register(cookie);

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    reply.header('X-Content-Type-Options', 'nosniff');
  });

  app.setErrorHandler((error: FastifyError | AppError, request, reply) => {
    const now = new Date();
    if (error instanceof AppError) {
      return reply
        .code(error.httpStatus)
        .send(failure(error.code, error.message, request.id, now, error.details));
    }
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply
        .code(400)
        .send(failure('PAYLOAD_TOO_LARGE', 'Request body is too large.', request.id, now));
    }
    if (
      error.validation ||
      error.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' ||
      error.statusCode === 400
    ) {
      return reply
        .code(400)
        .send(failure('VALIDATION_FAILED', 'Request is malformed.', request.id, now));
    }
    request.log.error({ err: { type: error.name, code: error.code } }, 'unhandled error');
    return reply.code(500).send(failure('INTERNAL', 'Something went wrong.', request.id, now));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send(failure('NOT_FOUND', 'Not found.', request.id, new Date())),
  );

  await app.register(healthRoutes, { readinessChecks: deps.readinessChecks });
  await app.register(v1Routes, { prefix: '/v1' });

  return app;
}
