import { z } from 'zod';

/** Environment variables whose values must never appear in logs. */
export const SECRET_KEYS: ReadonlySet<string> = new Set([
  'APP_SECRET',
  'DATABASE_URL',
  'DATABASE_MIGRATION_URL',
  'SMTP_URL',
]);

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const portMessage = 'must be a port number between 1 and 65535';
const port = z.coerce
  .number({ error: portMessage })
  .int(portMessage)
  .min(1, portMessage)
  .max(65535, portMessage);

const postgresUrl = z.url({
  protocol: /^postgres(ql)?$/,
  error: 'must be a postgres:// connection URL',
});

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Runtime connection. Must be a role subject to Row-Level Security. */
  DATABASE_URL: postgresUrl,
  /** Schema owner connection for migrations and the job queue. Falls back to DATABASE_URL. */
  DATABASE_MIGRATION_URL: postgresUrl.optional(),
  APP_SECRET: z.string().min(32, 'must be at least 32 characters'),
});

export const apiEnvSchema = baseEnvSchema.extend({
  HOST: z.string().default('0.0.0.0'),
  PORT: port.default(8080),
  AUTO_MIGRATE: booleanFlag.default(true),
  /** URL people use to open testRex; used for links, cookies and origin checks. */
  PUBLIC_URL: z
    .url({ protocol: /^https?$/, error: 'must be an http(s) URL' })
    .default('http://localhost:8080')
    .transform((url) => url.replace(/\/+$/, '')),
  /** Let anyone register. When false, only the first user and invited people can. */
  ALLOW_SIGNUP: booleanFlag.default(false),
  /** SMTP server for invitation emails, e.g. smtps://user:pass@smtp.example.com:465 */
  SMTP_URL: z.url({ protocol: /^smtps?$/, error: 'must be an smtp:// or smtps:// URL' }).optional(),
  SMTP_FROM: z.string().default('testRex <no-reply@localhost>'),
  /** Directory containing the built web app. Defaults to the bundled location. */
  WEB_DIST_DIR: z.string().optional(),
});

export const workerEnvSchema = baseEnvSchema.extend({
  HEALTH_HOST: z.string().default('0.0.0.0'),
  HEALTH_PORT: port.default(8081),
});

export type ApiConfig = z.infer<typeof apiEnvSchema>;
export type WorkerConfig = z.infer<typeof workerEnvSchema>;
