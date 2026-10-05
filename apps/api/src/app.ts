import Fastify, { type FastifyError } from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import { healthSchema } from '../../../packages/contracts/src/index.ts';

export async function createApp(
  config: Config,
  readiness: () => Promise<void>,
) {
  const app = Fastify({
    bodyLimit: 64 * 1024,
    trustProxy: false,
    genReqId: () => randomUUID(),
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
                'password',
                'password_hash',
                'token',
                'content',
                'DATABASE_URL',
              ],
              censor: '[REDACTED]',
            },
          },
    logController: new Fastify.LogController({ disableRequestLogging: true }),
  });
  await app.register(helmet);
  await app.register(cors, { origin: config.WEB_ORIGIN, credentials: false });
  await app.register(rateLimit, { max: 1000, timeWindow: '15 minutes' });
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Habit Tracker API',
        version: '0.1.0',
        description:
          'Implemented foundation endpoints. Product endpoints are added with their tested implementation.',
      },
    },
  });
  if (config.NODE_ENV !== 'production')
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
  });
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-ID', request.id);
    return payload;
  });
  app.addHook('onResponse', async (request, reply) => {
    request.log.info(
      {
        requestId: request.id,
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
        durationMs: reply.elapsedTime,
      },
      'request completed',
    );
  });
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const status =
      error.statusCode && error.statusCode >= 400 && error.statusCode < 500
        ? error.statusCode
        : 500;
    if (status === 500)
      request.log.error(
        { requestId: request.id, errorType: error.name },
        'request failed',
      );
    void reply.code(status).send({
      success: false,
      error: {
        code: status,
        message:
          status === 500
            ? 'An unexpected error occurred'
            : status === 429
              ? 'Too many requests'
              : status === 400
                ? 'Validation failed'
                : 'Request rejected',
        requestId: request.id,
      },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      success: false,
      error: {
        code: 404,
        message: 'Resource not found',
        requestId: request.id,
      },
    }),
  );
  app.get(
    '/health/live',
    { schema: { tags: ['Health'], response: { 200: healthSchema } } },
    async () => ({ status: 'ok' }),
  );
  app.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        response: { 200: healthSchema, 503: healthSchema },
      },
    },
    async (_request, reply) => {
      try {
        await readiness();
        return { status: 'ok' };
      } catch {
        return reply.code(503).send({ status: 'unavailable' });
      }
    },
  );
  app.get('/api/v1/openapi.json', { schema: { hide: true } }, async () =>
    app.swagger(),
  );
  return app;
}
