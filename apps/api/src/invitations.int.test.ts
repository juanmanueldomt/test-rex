import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INVITATION_TTL_MS } from './services/invitations';
import {
  createHarness,
  createOrg,
  PUBLIC_URL,
  recordingMailer,
  signedUp,
  type Harness,
} from './testing/harness';

let container: StartedPostgreSqlContainer;

beforeAll(async () => {
  container = await startPostgres();
});

afterAll(async () => {
  await container?.stop();
});

async function withHarness(
  options: Parameters<typeof createHarness>[1],
  fn: (harness: Harness) => Promise<void>,
) {
  const harness = await createHarness(container, options);
  try {
    await fn(harness);
  } finally {
    await harness.close();
  }
}

function tokenFrom(link: string): string {
  expect(link.startsWith(`${PUBLIC_URL}/invite/`)).toBe(true);
  return decodeURIComponent(link.split('/invite/')[1]!);
}

describe('invitations without email delivery', () => {
  it('returns a copyable link; an existing user with the invited email accepts it', async () => {
    await withHarness({}, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const luis = await signedUp(harness, 'Luis', 'luis@example.com');
      const slug = await createOrg(owner, 'Acme QA');

      const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'Luis@Example.com',
        role: 'admin',
      });
      expect(invite.status).toBe(201);
      expect(invite.body.delivery).toBe('link');
      expect(invite.body.invitation).toMatchObject({
        email: 'luis@example.com',
        role: 'admin',
        status: 'pending',
      });
      const token = tokenFrom(invite.body.link);

      // Only the hash is stored.
      const stored = await harness.superPool.query('SELECT token_hash FROM invitations');
      expect(stored.rows[0].token_hash).not.toContain(token.split('.')[1]);

      const preview = await harness.client().get(`/api/invitations/${encodeURIComponent(token)}`);
      expect(preview.body).toMatchObject({
        organization: { name: 'Acme QA', slug },
        email: 'luis@example.com',
        role: 'admin',
        status: 'pending',
      });

      const accept = await luis.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
      expect(accept.status).toBe(200);
      expect(accept.body.organization.slug).toBe(slug);
      expect((await luis.get(`/api/orgs/${slug}`)).body.role).toBe('admin');

      // Single use.
      const again = await luis.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
      expect(again.status).toBe(410);
      expect(again.body.code).toBe('INVITATION_ACCEPTED');
      expect((await owner.get(`/api/orgs/${slug}/invitations`)).body).toEqual([]);
    });
  });

  it('refuses to accept from a different account', async () => {
    await withHarness({}, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const mallory = await signedUp(harness, 'Mallory', 'mallory@example.com');
      const slug = await createOrg(owner, 'Acme QA');
      const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      const token = tokenFrom(invite.body.link);
      const res = await mallory.post(`/api/invitations/${encodeURIComponent(token)}/accept`);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('INVITATION_WRONG_ACCOUNT');
      expect(res.body.message).toContain('luis@example.com');
      expect((await mallory.get(`/api/orgs/${slug}`)).status).toBe(404);
    });
  });

  it('expires after 7 days', async () => {
    let now = new Date('2026-09-23T10:00:00Z');
    await withHarness({ now: () => now }, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const luis = await signedUp(harness, 'Luis', 'luis@example.com');
      const slug = await createOrg(owner, 'Acme QA');
      const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      const token = encodeURIComponent(tokenFrom(invite.body.link));

      now = new Date(now.getTime() + INVITATION_TTL_MS + 1000);
      expect((await harness.client().get(`/api/invitations/${token}`)).body.status).toBe('expired');
      const res = await luis.post(`/api/invitations/${token}/accept`);
      expect(res.status).toBe(410);
      expect(res.body.code).toBe('INVITATION_EXPIRED');
      expect((await owner.get(`/api/orgs/${slug}/invitations`)).body[0].status).toBe('expired');
    });
  });

  it('rejects unknown or malformed tokens', async () => {
    await withHarness({}, async (harness) => {
      const client = harness.client();
      expect((await client.get('/api/invitations/garbage')).status).toBe(404);
      expect(
        (await client.get('/api/invitations/0192f5a0-0000-7000-8000-00000000000a.nope')).status,
      ).toBe(404);
    });
  });

  it('can be revoked, and a new invitation replaces a pending one', async () => {
    await withHarness({}, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const luis = await signedUp(harness, 'Luis', 'luis@example.com');
      const slug = await createOrg(owner, 'Acme QA');
      const first = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      const second = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'admin',
      });
      const pending = (await owner.get(`/api/orgs/${slug}/invitations`)).body;
      expect(pending).toHaveLength(1);
      expect(pending[0].role).toBe('admin');

      const oldToken = encodeURIComponent(tokenFrom(first.body.link));
      expect((await luis.post(`/api/invitations/${oldToken}/accept`)).body.code).toBe(
        'INVITATION_REVOKED',
      );

      expect(
        (await owner.delete(`/api/orgs/${slug}/invitations/${second.body.invitation.id}`)).status,
      ).toBe(204);
      const newToken = encodeURIComponent(tokenFrom(second.body.link));
      expect((await luis.post(`/api/invitations/${newToken}/accept`)).status).toBe(410);
    });
  });

  it('restricts who can invite and whom', async () => {
    await withHarness({}, async (harness) => {
      const owner = await signedUp(harness, 'Owner', 'owner@example.com');
      const admin = await signedUp(harness, 'Admin', 'admin@example.com');
      const member = await signedUp(harness, 'Member', 'member@example.com');
      const slug = await createOrg(owner, 'Acme QA');
      for (const [client, role] of [
        [admin, 'admin'],
        [member, 'member'],
      ] as const) {
        const inv = await owner.post(`/api/orgs/${slug}/invitations`, {
          email: client.user!.email,
          role,
        });
        await client.post(
          `/api/invitations/${encodeURIComponent(tokenFrom(inv.body.link))}/accept`,
        );
      }
      expect(
        (
          await member.post(`/api/orgs/${slug}/invitations`, {
            email: 'x@example.com',
            role: 'member',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await admin.post(`/api/orgs/${slug}/invitations`, {
            email: 'x@example.com',
            role: 'owner',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await admin.post(`/api/orgs/${slug}/invitations`, {
            email: 'x@example.com',
            role: 'admin',
          })
        ).status,
      ).toBe(201);
      const existing = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'MEMBER@example.com',
        role: 'member',
      });
      expect(existing.status).toBe(409);
      expect(existing.body.code).toBe('ALREADY_MEMBER');
    });
  });
});

describe('invitations with email delivery', () => {
  it('emails the link instead of returning it', async () => {
    const mailer = recordingMailer();
    await withHarness({ mailer }, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const slug = await createOrg(owner, 'Acme QA');
      expect((await harness.client().get('/api/instance')).body.emailDelivery).toBe(true);
      const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      expect(invite.status).toBe(201);
      expect(invite.body.delivery).toBe('email');
      expect(invite.body.link).toBeUndefined();
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]).toMatchObject({ to: 'luis@example.com' });
      expect(mailer.sent[0]!.text).toContain(`${PUBLIC_URL}/invite/`);
      expect(mailer.sent[0]!.subject).toContain('Acme QA');
    });
  });

  it('falls back to the link when sending fails', async () => {
    const failing = {
      enabled: true,
      async send() {
        throw new Error('SMTP down');
      },
    };
    await withHarness({ mailer: failing }, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const slug = await createOrg(owner, 'Acme QA');
      const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      expect(invite.status).toBe(201);
      expect(invite.body.delivery).toBe('link');
      expect(invite.body.link).toContain('/invite/');
    });
  });
});
