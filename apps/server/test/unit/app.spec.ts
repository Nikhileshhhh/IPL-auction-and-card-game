import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  FailureEnvelopeSchema,
  successEnvelopeSchema,
  ReadinessSchema,
  VersionInfoSchema,
} from '@stumps/contracts';
import { buildApp } from '../../src/app';
import { loadEnv } from '../../src/config/env';
import type { ReadinessCheck } from '../../src/http/readiness';

const env = loadEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
let app: FastifyInstance | undefined;

async function make(checks: ReadinessCheck[]) {
  app = await buildApp({ env, readinessChecks: checks });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('health endpoints', () => {
  it('liveness reports the process is alive without touching dependencies', async () => {
    const res = await (await make([])).inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, data: { status: 'live' } });
  });

  it('readiness is 503 when no checks are registered (liveness is not readiness)', async () => {
    const res = await (await make([])).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().data.status).toBe('not_ready');
  });

  it('readiness is 503 when a dependency check fails and names the failing check', async () => {
    const res = await (
      await make([
        {
          name: 'database',
          run: async () => ({ ok: false, detail: 'DATABASE_URL not configured' }),
        },
      ])
    ).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(successEnvelopeSchema(ReadinessSchema).parse(res.json()).data.checks).toEqual([
      { name: 'database', ok: false, detail: 'DATABASE_URL not configured' },
    ]);
  });

  it('readiness is 200 only when every check passes', async () => {
    const res = await (
      await make([{ name: 'database', run: async () => ({ ok: true }) }])
    ).inject({
      method: 'GET',
      url: '/health/ready',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('ready');
  });

  it('a hanging check times out instead of hanging readiness', async () => {
    const res = await (
      await make([{ name: 'slow', run: () => new Promise(() => undefined) }])
    ).inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
    expect(res.json().data.checks[0]).toMatchObject({
      name: 'slow',
      ok: false,
      detail: 'timed out',
    });
  }, 10_000);
});

describe('versioned API and error envelope', () => {
  it('serves version metadata under /v1 with private no-store caching', async () => {
    const res = await (await make([])).inject({ method: 'GET', url: '/v1/meta/version' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(successEnvelopeSchema(VersionInfoSchema).parse(res.json()).data.apiVersion).toBe('v1');
  });

  it('unknown routes return the shared NOT_FOUND envelope with a server request id', async () => {
    const res = await (
      await make([])
    ).inject({
      method: 'GET',
      url: '/v1/does-not-exist',
      headers: { 'x-request-id': 'client-chosen-id' },
    });
    expect(res.statusCode).toBe(404);
    const body = FailureEnvelopeSchema.parse(res.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(body.requestId).not.toBe('client-chosen-id');
  });

  it('oversized bodies are rejected with PAYLOAD_TOO_LARGE before reaching handlers', async () => {
    const instance = await make([]);
    const res = await instance.inject({
      method: 'POST',
      url: '/v1/meta/version',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ pad: 'x'.repeat(20_000) }),
    });
    expect(res.statusCode).toBe(400);
    expect(FailureEnvelopeSchema.parse(res.json()).error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('malformed JSON is VALIDATION_FAILED and leaks no parser internals', async () => {
    const instance = await make([]);
    instance.post('/v1/echo-test', async () => ({ ok: true }));
    const res = await instance.inject({
      method: 'POST',
      url: '/v1/echo-test',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    });
    expect(res.statusCode).toBe(400);
    const body = FailureEnvelopeSchema.parse(res.json());
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(body)).not.toMatch(/Unexpected|SyntaxError|at /);
  });

  it('unexpected exceptions become INTERNAL without stack traces', async () => {
    const instance = await make([]);
    instance.get('/v1/boom-test', async () => {
      throw new Error('database password is hunter2');
    });
    const res = await instance.inject({ method: 'GET', url: '/v1/boom-test' });
    expect(res.statusCode).toBe(500);
    const body = FailureEnvelopeSchema.parse(res.json());
    expect(body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
