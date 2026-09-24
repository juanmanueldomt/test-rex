import type { ApiErrorBody } from '@testrex/contracts';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';

/** An error with a stable code that clients (and translations) can rely on. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }

  toBody(): ApiErrorBody {
    return { code: this.code, message: this.message, ...this.extra };
  }
}

export const unauthorized = () => new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue.');

/** Also used when the caller lacks access, so existence is never revealed. */
export const notFound = (message = 'Not found.') => new ApiError(404, 'NOT_FOUND', message);

export const forbidden = (code = 'FORBIDDEN', message = 'You do not have permission to do this.') =>
  new ApiError(403, code, message);

export const conflict = (code: string, message: string, extra?: Record<string, unknown>) =>
  new ApiError(409, code, message, extra);

export const badRequest = (code: string, message: string, extra?: Record<string, unknown>) =>
  new ApiError(400, code, message, extra);

/** Validates input with a shared schema; failures become a 400 listing each field. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
  throw badRequest('VALIDATION_FAILED', 'Some fields are invalid.', { issues });
}

/** Postgres unique_violation, optionally for a specific constraint. */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const cause = (error as { cause?: { code?: string; constraint?: string } })?.cause ?? error;
  const pgError = cause as { code?: string; constraint?: string };
  return pgError?.code === '23505' && (!constraint || pgError.constraint === constraint);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.status).send(error.toBody());
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return reply
        .code(status)
        .send({ code: 'BAD_REQUEST', message: (error as Error).message } satisfies ApiErrorBody);
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply
      .code(500)
      .send({ code: 'INTERNAL', message: 'Something went wrong.' } satisfies ApiErrorBody);
  });
}
