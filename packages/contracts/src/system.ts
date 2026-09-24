import { z } from 'zod';

export const versionResponse = z.object({
  version: z.string(),
  commit: z.string(),
});
export type VersionResponse = z.infer<typeof versionResponse>;

export const healthResponse = z.object({
  status: z.enum(['ok', 'unavailable']),
  checks: z.record(z.string(), z.enum(['ok', 'failing', 'pending'])).optional(),
});
export type HealthResponse = z.infer<typeof healthResponse>;
