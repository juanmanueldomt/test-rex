import { AsyncLocalStorage } from 'node:async_hooks';
import { MIN_PASSWORD_LENGTH, type SessionUser } from '@testrex/contracts';
import { schema, type Database } from '@testrex/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, count, eq, gt, lt } from 'drizzle-orm';

export const AUTH_BASE_PATH = '/api/auth';
/** Sign-up requests carry the invitation token in this header when public sign-up is off. */
export const INVITATION_HEADER = 'x-testrex-invitation';

export const LOCKOUT_MAX_FAILURES = 10;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export interface SignupPolicy {
  /** Anyone may register. When false, only the first user or invited people may. */
  allowPublicSignup: boolean;
  /** True when `token` is a valid, pending invitation addressed to `email`. */
  isInvited(email: string, token: string): Promise<boolean>;
}

export interface CreateAuthOptions {
  db: Database;
  secret: string;
  /** Public URL of the instance, e.g. https://testrex.example.com */
  baseURL: string;
  signup: SignupPolicy;
  /** Clock override for tests. */
  now?: () => Date;
}

export interface AuthSession {
  user: SessionUser;
  sessionId: string;
}

export interface TestrexAuth {
  /** Handles every request under /api/auth/* (sign-up, sign-in, sign-out, session). */
  handle(request: Request): Promise<Response>;
  /** Resolves the signed-in user from request headers (cookie), or null. */
  getSession(headers: Headers): Promise<AuthSession | null>;
  /** Whether any account exists yet. */
  hasUsers(): Promise<boolean>;
}

interface SignupContext {
  allowed: boolean;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function createAuth(options: CreateAuthOptions): TestrexAuth {
  const { db } = options;
  const now = options.now ?? (() => new Date());
  const signupContext = new AsyncLocalStorage<SignupContext>();

  async function hasUsers(): Promise<boolean> {
    const rows = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
    return rows.length > 0;
  }

  const auth = betterAuth({
    appName: 'testRex',
    baseURL: options.baseURL,
    basePath: AUTH_BASE_PATH,
    secret: options.secret,
    trustedOrigins: [new URL(options.baseURL).origin],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 128,
      autoSignIn: true,
    },
    user: {
      additionalFields: {
        isInstanceAdmin: { type: 'boolean', defaultValue: false, input: false },
      },
    },
    advanced: {
      cookiePrefix: 'testrex',
      useSecureCookies: options.baseURL.startsWith('https://'),
      database: { generateId: () => schema.newId() },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // Fail closed: users are only created through a sign-up that passed the policy.
          before: async (user) => {
            if (!signupContext.getStore()?.allowed) return false;
            const first = !(await hasUsers());
            return { data: { ...user, isInstanceAdmin: first } };
          },
        },
      },
    },
  });

  async function recentFailures(email: string): Promise<number> {
    const since = new Date(now().getTime() - LOCKOUT_WINDOW_MS);
    const [row] = await db
      .select({ n: count() })
      .from(schema.authFailedAttempts)
      .where(
        and(
          eq(schema.authFailedAttempts.email, email),
          gt(schema.authFailedAttempts.attemptedAt, since),
        ),
      );
    return row?.n ?? 0;
  }

  async function recordFailure(email: string): Promise<void> {
    const cutoff = new Date(now().getTime() - LOCKOUT_WINDOW_MS);
    await db.insert(schema.authFailedAttempts).values({ email, attemptedAt: now() });
    await db
      .delete(schema.authFailedAttempts)
      .where(
        and(
          eq(schema.authFailedAttempts.email, email),
          lt(schema.authFailedAttempts.attemptedAt, cutoff),
        ),
      );
  }

  async function readEmail(request: Request): Promise<string> {
    const body = (await request
      .clone()
      .json()
      .catch(() => ({}))) as { email?: unknown };
    return typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  }

  async function handleSignIn(request: Request): Promise<Response> {
    const email = await readEmail(request);
    if (email && (await recentFailures(email)) >= LOCKOUT_MAX_FAILURES) {
      return json(429, {
        code: 'TOO_MANY_ATTEMPTS',
        message: 'Too many failed sign-in attempts. Try again in a few minutes.',
      });
    }
    const response = await auth.handler(request);
    if (email && response.status === 401) await recordFailure(email);
    return response;
  }

  async function handleSignUp(request: Request): Promise<Response> {
    const email = await readEmail(request);
    const token = request.headers.get(INVITATION_HEADER);
    const allowed =
      options.signup.allowPublicSignup ||
      !(await hasUsers()) ||
      (token !== null && email !== '' && (await options.signup.isInvited(email, token)));
    if (!allowed) {
      return json(403, {
        code: 'SIGNUP_REQUIRES_INVITATION',
        message: 'Registration on this instance requires an invitation.',
      });
    }
    return signupContext.run({ allowed: true }, () => auth.handler(request));
  }

  return {
    hasUsers,

    async handle(request) {
      const path = new URL(request.url).pathname;
      if (request.method === 'POST' && path === `${AUTH_BASE_PATH}/sign-in/email`) {
        return handleSignIn(request);
      }
      if (request.method === 'POST' && path === `${AUTH_BASE_PATH}/sign-up/email`) {
        return handleSignUp(request);
      }
      return auth.handler(request);
    },

    async getSession(headers) {
      const result = await auth.api.getSession({ headers });
      if (!result) return null;
      const user = result.user as typeof result.user & { isInstanceAdmin?: boolean };
      return {
        sessionId: result.session.id,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          isInstanceAdmin: Boolean(user.isInstanceAdmin),
        },
      };
    },
  };
}
