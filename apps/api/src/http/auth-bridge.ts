import { AUTH_BASE_PATH } from '@testrex/auth';
import type { FastifyInstance } from 'fastify';
import type { ApiServices } from '../services/index';
import { toHeaders } from './guards';

/** Forwards /api/auth/* to the auth service as standard Fetch requests. */
export async function authBridge(app: FastifyInstance, services: ApiServices): Promise<void> {
  await app.register(async (scope) => {
    // Hand the body over untouched instead of parsing and re-serializing it.
    scope.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) =>
      done(null, body),
    );

    scope.route({
      method: ['GET', 'POST'],
      url: `${AUTH_BASE_PATH}/*`,
      async handler(req, reply) {
        const url = new URL(req.url, services.config.PUBLIC_URL);
        const body = typeof req.body === 'string' && req.body.length > 0 ? req.body : undefined;
        const response = await services.auth.handle(
          new Request(url, { method: req.method, headers: toHeaders(req.headers), body }),
        );

        reply.code(response.status);
        response.headers.forEach((value, key) => {
          if (key !== 'set-cookie' && key !== 'content-length') reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header('set-cookie', cookies);
        return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
      },
    });
  });
}
