import { MIN_PASSWORD_LENGTH } from '@testrex/contracts';
import type { z } from 'zod';
import i18n from './i18n';

export type FieldErrors = Record<string, string>;

/**
 * Validates with a shared contract schema. Schema messages are i18n keys (e.g.
 * "email.invalid"), translated here so client and server agree on the rules.
 */
export function validate<S extends z.ZodType>(
  schema: S,
  values: unknown,
): { data: z.infer<S>; errors: null } | { data: null; errors: FieldErrors } {
  const result = schema.safeParse(values);
  if (result.success) return { data: result.data, errors: null };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path.join('.');
    if (errors[field]) continue;
    const key = `validation.${issue.message}`;
    errors[field] = i18n.exists(key)
      ? i18n.t(key, { min: MIN_PASSWORD_LENGTH })
      : i18n.t('errors.generic');
  }
  return { data: null, errors };
}
