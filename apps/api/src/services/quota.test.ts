import { describe, expect, it } from 'vitest';
import { unlimitedQuota, type QuotaAction } from './quota';

describe('unlimitedQuota (self-hosted)', () => {
  it.each<QuotaAction>(['organization.create', 'application.create', 'member.add'])(
    'allows %s',
    async (action) => {
      await expect(
        unlimitedQuota.check(action, { organizationId: 'any', plan: 'self_hosted' }),
      ).resolves.toBeUndefined();
    },
  );
});
