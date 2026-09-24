import { api } from './api';

/** Mirrors INVITATION_HEADER in @testrex/auth. */
const INVITATION_HEADER = 'x-testrex-invitation';

export function signIn(email: string, password: string) {
  return api.post('/api/auth/sign-in/email', { email, password });
}

export function signUp(
  input: { name: string; email: string; password: string },
  invitationToken?: string,
) {
  return api.post(
    '/api/auth/sign-up/email',
    input,
    invitationToken ? { [INVITATION_HEADER]: invitationToken } : undefined,
  );
}

export function signOut() {
  return api.post('/api/auth/sign-out');
}
