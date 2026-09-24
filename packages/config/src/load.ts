import type { z } from 'zod';
import { SECRET_KEYS } from './env';

export interface ConfigIssue {
  key: string;
  message: string;
}

export class ConfigError extends Error {
  constructor(readonly issues: ConfigIssue[]) {
    super(
      ['Invalid configuration:', ...issues.map((i) => `  - ${i.key}: ${i.message}`)].join('\n'),
    );
    this.name = 'ConfigError';
  }
}

/**
 * Parses environment variables with the given schema. Every invalid or missing key is
 * reported at once. Empty strings are treated as unset.
 */
export function loadConfig<S extends z.ZodType>(
  schema: S,
  env: Record<string, string | undefined> = process.env,
): z.infer<S> {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = schema.safeParse(cleaned);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const key = issue.path.join('.') || '(root)';
    const message = cleaned[key] === undefined ? 'is required' : issue.message;
    return { key, message };
  });
  throw new ConfigError(issues);
}

const REDACTED = '[REDACTED]';

/** Returns a copy of the config that is safe to log. */
export function redactConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).map(([key, value]) => {
      if (!SECRET_KEYS.has(key) || value === undefined) return [key, value];
      return [key, typeof value === 'string' ? redactUrlOrValue(value) : REDACTED];
    }),
  );
}

/** Keeps the host/database of connection URLs for debugging but hides credentials. */
function redactUrlOrValue(value: string): string {
  try {
    const url = new URL(value);
    if (!url.host) return REDACTED;
    if (url.password) url.password = REDACTED;
    return url.toString();
  } catch {
    return REDACTED;
  }
}
