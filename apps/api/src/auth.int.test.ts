import { INVITATION_HEADER, LOCKOUT_MAX_FAILURES, LOCKOUT_WINDOW_MS } from '@testrex/auth';
import { startPostgres } from '@testrex/db/testing';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, createOrg, PASSWORD, signedUp, type Harness } from './testing/harness';

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

describe('registration, sign-in and sign-out', () => {
  it('registers, keeps the session, signs out and rejects the replayed cookie', async () => {
    await withHarness({}, async (harness) => {
      const client = harness.client();
      const signUp = await client.signUp('Ana García', 'ana@example.com');
      expect(signUp.status).toBe(200);

      const me = await client.get('/api/me');
      expect(me.status).toBe(200);
      expect(me.body.user).toMatchObject({ name: 'Ana García', email: 'ana@example.com' });
      expect(me.body.organizations).toEqual([]);

      const setCookie = String(signUp.headers['set-cookie']);
      expect(setCookie).toMatch(/testrex\.session_token=/);
      expect(setCookie).toMatch(/HttpOnly/i);

      const oldCookie = client.cookieHeader;
      expect((await client.post('/api/auth/sign-out')).status).toBe(200);
      expect((await client.get('/api/me')).status).toBe(401);

      const replay = harness.client();
      replay.setCookieHeader(oldCookie);
      expect((await replay.get('/api/me')).status).toBe(401);

      const signIn = await client.signIn('ana@example.com');
      expect(signIn.status).toBe(200);
      expect((await client.get('/api/me')).status).toBe(200);
    });
  });

  it('treats emails case-insensitively', async () => {
    await withHarness({}, async (harness) => {
      await signedUp(harness, 'Ana', 'ana@example.com');
      const duplicate = await harness.client().signUp('Other Ana', 'Ana@Example.com');
      expect(duplicate.status).toBeGreaterThanOrEqual(400);
      expect(duplicate.status).toBeLessThan(500);
      expect(duplicate.body.code).toMatch(/USER_ALREADY_EXISTS/);

      expect((await harness.client().signIn('ANA@example.com')).status).toBe(200);
    });
  });

  it('rejects passwords shorter than 10 characters', async () => {
    await withHarness({}, async (harness) => {
      const res = await harness.client().post('/api/auth/sign-up/email', {
        name: 'Bo',
        email: 'bo@example.com',
        password: 'short1',
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('PASSWORD_TOO_SHORT');
    });
  });

  it('lands on the last used organization after sign-in', async () => {
    await withHarness({}, async (harness) => {
      const ana = await signedUp(harness, 'Ana');
      await createOrg(ana, 'Acme QA');
      const beta = await createOrg(ana, 'Beta Labs');
      await ana.get('/api/orgs/acme-qa');
      await ana.post('/api/auth/sign-out');
      await ana.signIn(ana.user!.email);
      expect((await ana.get('/api/me')).body.lastOrganizationSlug).toBe('acme-qa');
      await ana.get(`/api/orgs/${beta}`);
      expect((await ana.get('/api/me')).body.lastOrganizationSlug).toBe(beta);
    });
  });
});

describe('sign-up policy', () => {
  it('makes the first user of an empty instance the administrator, even with sign-up disabled', async () => {
    await withHarness({ allowSignup: false }, async (harness) => {
      const instance = await harness.client().get('/api/instance');
      expect(instance.body).toEqual({
        signupEnabled: false,
        needsSetup: true,
        emailDelivery: false,
      });

      const first = await signedUp(harness, 'Root');
      expect((await first.get('/api/me')).body.user.isInstanceAdmin).toBe(true);
      expect((await harness.client().get('/api/instance')).body.needsSetup).toBe(false);

      // Once someone exists, uninvited registration is closed.
      const second = await harness.client().signUp('Second', 'second@example.com');
      expect(second.status).toBe(403);
    });
  });

  it('only lets invited people register when sign-up is disabled', async () => {
    await withHarness({ allowSignup: false }, async (harness) => {
      const owner = await signedUp(harness, 'Owner');
      const slug = await createOrg(owner, 'Acme QA');

      const stranger = await harness.client().signUp('Stranger', 'stranger@example.com');
      expect(stranger.status).toBe(403);
      expect(stranger.body.code).toBe('SIGNUP_REQUIRES_INVITATION');

      const invite = await owner.post(`/api/orgs/${slug}/invitations`, {
        email: 'luis@example.com',
        role: 'member',
      });
      const token = decodeURIComponent(invite.body.link.split('/invite/')[1]);

      // The token only works for the invited address.
      const wrongEmail = await harness
        .client()
        .signUp('Mallory', 'mallory@example.com', { [INVITATION_HEADER]: token });
      expect(wrongEmail.status).toBe(403);

      const luis = harness.client();
      const res = await luis.signUp('Luis', 'luis@example.com', { [INVITATION_HEADER]: token });
      expect(res.status).toBe(200);
      expect((await luis.get('/api/me')).body.user.isInstanceAdmin).toBe(false);
    });
  });

  it('does not make later users administrators', async () => {
    await withHarness({ allowSignup: true }, async (harness) => {
      await signedUp(harness, 'First');
      const second = await signedUp(harness, 'Second');
      expect((await second.get('/api/me')).body.user.isInstanceAdmin).toBe(false);
    });
  });
});

describe('sign-in protection', () => {
  it('uses one generic message for unknown emails and wrong passwords', async () => {
    await withHarness({}, async (harness) => {
      await signedUp(harness, 'Ana', 'ana@example.com');
      const wrongPassword = await harness.client().signIn('ana@example.com', 'wrong-password-1');
      const unknownEmail = await harness.client().signIn('nobody@example.com', 'wrong-password-1');
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
      expect(wrongPassword.body.message).toMatch(/invalid email or password/i);
    });
  });

  it('locks an email after 10 failures in 15 minutes, until the window expires', async () => {
    let now = new Date('2026-09-23T10:00:00Z');
    await withHarness({ now: () => now }, async (harness) => {
      await signedUp(harness, 'Ana', 'ana@example.com');
      const client = harness.client();
      for (let i = 0; i < LOCKOUT_MAX_FAILURES; i++) {
        expect((await client.signIn('ana@example.com', `wrong-password-${i}`)).status).toBe(401);
      }
      // Even the correct password is refused while locked.
      const locked = await client.signIn('ana@example.com', PASSWORD);
      expect(locked.status).toBe(429);
      expect(locked.body.code).toBe('TOO_MANY_ATTEMPTS');
      // Other accounts are unaffected.
      expect((await client.signIn('other@example.com', 'wrong-password-x')).status).toBe(401);

      now = new Date(now.getTime() + LOCKOUT_WINDOW_MS + 1000);
      expect((await client.signIn('ana@example.com', PASSWORD)).status).toBe(200);
    });
  });
});
