import { z } from 'zod';

/** Every tenant job carries the organization it acts for; the worker scopes it with RLS. */
export const tenantJobPayload = z.object({
  organizationId: z.uuid(),
});
export type TenantJobPayload = z.infer<typeof tenantJobPayload>;
