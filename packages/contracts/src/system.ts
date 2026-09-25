import { z } from 'zod';

export const versionResponse = z.object({
  version: z.string(),
  commit: z.string(),
});
export type VersionResponse = z.infer<typeof versionResponse>;

export const healthResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['ok', 'failing', 'pending'])).optional(),
  /** Reasons for failing checks that operators can act on (e.g. storage not writable). */
  errors: z.record(z.string(), z.string()).optional(),
});
export type HealthResponse = z.infer<typeof healthResponse>;
