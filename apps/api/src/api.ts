import { AUTH_BASE_PATH, createAuth } from '@testrex/auth';
import type { ApiConfig, Logger } from '@testrex/config';
import type { Database } from '@testrex/db';
import type { FastifyInstance } from 'fastify';
import { authBridge } from './http/auth-bridge';
import { forbidden, registerErrorHandler } from './http/errors';
import { createGuards } from './http/guards';
import { applicationRoutes } from './routes/applications';
import { auditRoutes } from './routes/audit';
import { invitationRoutes } from './routes/invitations';
import { memberRoutes } from './routes/members';
import { organizationRoutes } from './routes/organizations';
import { sessionRoutes } from './routes/session';
import type { ApiServices } from './services/index';
import { isInvited } from './services/invitations';
import { createMailer, type Mailer } from './services/mailer';
import { unlimitedQuota, type QuotaService } from './services/quota';

export interface CreateServicesOptions {
  config: ApiConfig;
  logger: Logger;
  db: Database;
  mailer?: Mailer;
  quota?: QuotaService;
  now?: () => Date;
}

export function createApiServices(options: CreateServicesOptions): ApiServices {
  const { config, db } = options;
  const now = options.now ?? (() => new Date());
  return {
    config,
    logger: options.logger,
    db,
    now,
    mailer: options.mailer ?? createMailer(config, options.logger),
    quota: options.quota ?? unlimitedQuota,
    auth: createAuth({
      db,
      secret: config.APP_SECRET,
      baseURL: config.PUBLIC_URL,
      now,
      signup: {
        allowPublicSignup: config.ALLOW_SIGNUP,
        isInvited: (email, token) => isInvited(db, email, token, now()),
      },
    }),
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export async function registerApi(app: FastifyInstance, services: ApiServices): Promise<void> {
  registerErrorHandler(app);
  app.decorateRequest('user', null);
  app.decorateRequest('org', null);
  app.decorateRequest('application', null);

  // Cookie-authenticated writes must come from our own origin (defense against CSRF on top
  // of SameSite cookies). Requests without Origin (non-browser clients) are allowed.
  const publicOrigin = new URL(services.config.PUBLIC_URL).origin;
  app.addHook('onRequest', async (req) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return;
    if (req.url.startsWith(`${AUTH_BASE_PATH}/`)) return; // Better Auth checks origins itself.
    const origin = req.headers.origin;
    if (origin && origin !== publicOrigin) {
      throw forbidden('ORIGIN_NOT_ALLOWED', 'Cross-site requests are not allowed.');
    }
  });

  const guards = createGuards(services);
  await authBridge(app, services);
  await sessionRoutes(app, services, guards);
  await organizationRoutes(app, services, guards);
  await memberRoutes(app, services, guards);
  await invitationRoutes(app, services, guards);
  await applicationRoutes(app, services, guards);
  await auditRoutes(app, services, guards);
}
