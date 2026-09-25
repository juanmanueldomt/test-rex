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

  it('allows uploads of any size regardless of stored bytes', async () => {
    await expect(
      unlimitedQuota.check('storage.upload', {
        organizationId: 'any',
        plan: 'self_hosted',
        bytes: 10 * 1024 ** 3,
        usageBytes: 10 * 1024 ** 4,
      }),
    ).resolves.toBeUndefined();
  });
});
