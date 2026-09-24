import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiError } from './http/errors';
import type { QuotaAction, QuotaService } from './services/quota';
import { createHarness, createOrg, signedUp } from './testing/harness';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await container?.stop();
});

describe('quota hooks', () => {
  it('are consulted when creating organizations, applications and members', async () => {
    const calls: Array<{ action: QuotaAction; plan?: string }> = [];
    const quota: QuotaService = {
      async check(action, context) {
        calls.push({ action, plan: context.plan });
      },
    };
    const harness = await createHarness(container, { quota });
    try {
      const ana = await signedUp(harness, 'Ana');
      const slug = await createOrg(ana, 'Acme QA');
      await ana.post(`/api/orgs/${slug}/apps`, { name: 'Checkout', key: 'CHK' });
      await ana.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      expect(calls).toEqual([
        { action: 'organization.create', plan: undefined },
        { action: 'application.create', plan: 'self_hosted' },
        { action: 'member.add', plan: 'self_hosted' },
      ]);
    } finally {
      await harness.close();
    }
  });

  it('a refusing quota blocks the action (cloud plans)', async () => {
    const quota: QuotaService = {
      async check(action) {
        if (action === 'application.create') {
          throw new ApiError(402, 'PLAN_LIMIT', 'Your plan does not allow more applications.');
        }
      },
    };
    const harness = await createHarness(container, { quota });
    try {
      const ana = await signedUp(harness, 'Ana');
      const slug = await createOrg(ana, 'Acme QA');
      const res = await ana.post(`/api/orgs/${slug}/apps`, { name: 'Checkout', key: 'CHK' });
      expect(res.status).toBe(402);
      expect((await ana.get(`/api/orgs/${slug}/apps`)).body).toEqual([]);
    } finally {
      await harness.close();
    }
  });
});
