import { MIN_PASSWORD_LENGTH, signInSchema, signUpSchema } from '@testrex/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Info, MailWarning, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CenteredLayout } from '../components/common';
import { api, errorMessage } from '../lib/api';
import { signIn, signUp } from '../lib/auth';
import { instanceQuery, invitationPreviewQuery, meQuery } from '../lib/queries';
import { validate, type FieldErrors } from '../lib/validation';

/** Only same-origin paths are accepted as post-sign-in destinations. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith('/') && !target.startsWith('//') ? target : '/';
}

export function SignInPage({
  redirect,
  email: presetEmail,
}: {
  redirect?: string;
  email?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instance = useQuery(instanceQuery);
  const [values, setValues] = useState({ email: presetEmail ?? '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});

  const mutation = useMutation({
    mutationFn: () => signIn(values.email, values.password),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      await navigate({ to: safeRedirect(redirect) });
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(signInSchema, values);
    setErrors(result.errors ?? {});
    if (result.data) mutation.mutate();
  };

  const canRegister = instance.data?.signupEnabled || instance.data?.needsSetup;

  return (
    <CenteredLayout>
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-2xl">{t('auth.signInTitle')}</span>
          </CardTitle>
          <CardDescription>{t('auth.signInSubtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit} noValidate>
            {mutation.isError ? (
              <Alert variant="destructive">{errorMessage(mutation.error)}</Alert>
            ) : null}
            <Field label={t('auth.email')} error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  autoComplete="email"
                  autoFocus={!presetEmail}
                  value={values.email}
                  onChange={(e) => setValues({ ...values, email: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('auth.password')} error={errors.password}>
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="current-password"
                  autoFocus={Boolean(presetEmail)}
                  value={values.password}
                  onChange={(e) => setValues({ ...values, password: e.target.value })}
                />
              )}
            </Field>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('auth.signingIn') : t('auth.signIn')}
            </Button>
          </form>
          {canRegister ? (
            <p className="mt-6 text-center text-sm text-muted-foreground">
              {t('auth.noAccount')}{' '}
              <Link
                to="/sign-up"
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {t('auth.createAccount')}
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>
    </CenteredLayout>
  );
}

export function SignUpPage({ invite }: { invite?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const instance = useQuery(instanceQuery);
  const invitation = useQuery({
    ...invitationPreviewQuery(invite ?? ''),
    enabled: Boolean(invite),
  });
  const invitedEmail = invitation.data?.status === 'pending' ? invitation.data.email : undefined;
  const [values, setValues] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const email = invitedEmail ?? values.email;

  const mutation = useMutation({
    mutationFn: async () => {
      await signUp({ ...values, email }, invitedEmail ? invite : undefined);
      if (invitedEmail && invite) {
        return api.post<{ organization: { slug: string } }>(
          `/api/invitations/${encodeURIComponent(invite)}/accept`,
        );
      }
      return null;
    },
    onSuccess: async (accepted) => {
      await queryClient.invalidateQueries();
      if (accepted) {
        await navigate({ to: '/o/$orgSlug', params: { orgSlug: accepted.organization.slug } });
      } else {
        await navigate({ to: '/onboarding' });
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(signUpSchema, { ...values, email });
    setErrors(result.errors ?? {});
    if (result.data) mutation.mutate();
  };

  if (instance.isPending || (invite && invitation.isPending)) {
    return <CenteredLayout>{null}</CenteredLayout>;
  }

  const allowed = instance.data?.signupEnabled || instance.data?.needsSetup || invitedEmail;
  if (!allowed) {
    return (
      <CenteredLayout>
        <Card>
          <CardHeader>
            <MailWarning className="size-8 text-primary" aria-hidden />
            <CardTitle>
              <span className="text-2xl">{t('auth.signUpClosedTitle')}</span>
            </CardTitle>
            <CardDescription>{t('auth.signUpClosedBody')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="w-full">
              <Link to="/sign-in">{t('auth.signIn')}</Link>
            </Button>
          </CardContent>
        </Card>
      </CenteredLayout>
    );
  }

  const setup = instance.data?.needsSetup && !invitedEmail;
  const title = invitedEmail
    ? t('auth.joinTitle', { org: invitation.data?.organization.name })
    : setup
      ? t('auth.setupTitle')
      : t('auth.signUpTitle');
  const subtitle = invitedEmail
    ? t('auth.joinSubtitle')
    : setup
      ? t('auth.setupSubtitle')
      : t('auth.signUpSubtitle');

  return (
    <CenteredLayout>
      <Card>
        <CardHeader>
          {setup ? <ShieldCheck className="size-8 text-primary" aria-hidden /> : null}
          <CardTitle>
            <span className="text-2xl">{title}</span>
          </CardTitle>
          <CardDescription>{subtitle}</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit} noValidate>
            {mutation.isError ? (
              <Alert variant="destructive">{errorMessage(mutation.error)}</Alert>
            ) : null}
            <Field label={t('auth.name')} error={errors.name}>
              {(control) => (
                <Input
                  {...control}
                  autoComplete="name"
                  autoFocus
                  value={values.name}
                  onChange={(e) => setValues({ ...values, name: e.target.value })}
                />
              )}
            </Field>
            <Field label={t('auth.email')} error={errors.email}>
              {(control) => (
                <Input
                  {...control}
                  type="email"
                  autoComplete="email"
                  readOnly={Boolean(invitedEmail)}
                  value={email}
                  onChange={(e) => setValues({ ...values, email: e.target.value })}
                />
              )}
            </Field>
            <Field
              label={t('auth.password')}
              hint={t('auth.passwordHint', { min: MIN_PASSWORD_LENGTH })}
              error={errors.password}
            >
              {(control) => (
                <Input
                  {...control}
                  type="password"
                  autoComplete="new-password"
                  minLength={MIN_PASSWORD_LENGTH}
                  value={values.password}
                  onChange={(e) => setValues({ ...values, password: e.target.value })}
                />
              )}
            </Field>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? t('auth.signingUp') : t('auth.signUp')}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            {t('auth.haveAccount')}{' '}
            <Link
              to="/sign-in"
              search={invite ? { redirect: `/invite/${encodeURIComponent(invite)}` } : {}}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              {t('auth.signIn')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </CenteredLayout>
  );
}

export function InvitePage({ token }: { token: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const preview = useQuery({ ...invitationPreviewQuery(token), retry: false });
  const me = useQuery({ ...meQuery, retry: false });

  const accept = useMutation({
    mutationFn: () =>
      api.post<{ organization: { slug: string } }>(
        `/api/invitations/${encodeURIComponent(token)}/accept`,
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries();
      await navigate({ to: '/o/$orgSlug', params: { orgSlug: result.organization.slug } });
    },
  });

  const switchAccount = useMutation({
    mutationFn: () => api.post('/api/auth/sign-out'),
    onSuccess: async () => {
      queryClient.clear();
      await navigate({
        to: '/sign-in',
        search: { redirect: `/invite/${encodeURIComponent(token)}`, email: preview.data?.email },
      });
    },
  });

  if (preview.isPending || me.isPending) return <CenteredLayout>{null}</CenteredLayout>;

  const card = (title: string, body: string, action?: ReactNode) => (
    <CenteredLayout>
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-2xl">{title}</span>
          </CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        {action ? <CardContent className="grid gap-2">{action}</CardContent> : null}
      </Card>
    </CenteredLayout>
  );

  if (preview.isError || !preview.data) {
    return card(t('invite.notFoundTitle'), t('invite.notFoundBody'));
  }
  const { organization, email, role, status } = preview.data;
  const org = organization.name;
  const home = (
    <Button asChild variant="outline">
      <Link to="/">{t('invite.goHome')}</Link>
    </Button>
  );

  if (status === 'expired') return card(t('invite.expiredTitle'), t('invite.expiredBody', { org }));
  if (status === 'revoked') return card(t('invite.revokedTitle'), t('invite.revokedBody', { org }));
  if (status === 'accepted') return card(t('invite.acceptedTitle'), t('invite.acceptedBody'), home);

  const currentEmail = me.data?.user.email;
  if (currentEmail && currentEmail.toLowerCase() !== email) {
    return card(
      t('invite.wrongAccountTitle'),
      t('invite.wrongAccountBody', { invited: email, current: currentEmail }),
      <Button onClick={() => switchAccount.mutate()} disabled={switchAccount.isPending}>
        {t('invite.switchAccount', { invited: email })}
      </Button>,
    );
  }

  return card(
    t('invite.title', { org }),
    t('invite.body', { org, role: t(`roles.${role}`) }),
    <>
      <Alert variant="info">
        <Info aria-hidden />
        <span>{t('invite.sentTo', { email })}</span>
      </Alert>
      {accept.isError ? <Alert variant="destructive">{errorMessage(accept.error)}</Alert> : null}
      {currentEmail ? (
        <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
          {accept.isPending ? t('invite.accepting') : t('invite.accept')}
        </Button>
      ) : (
        <>
          <Button asChild>
            <Link to="/sign-up" search={{ invite: token }}>
              {t('invite.signUp')}
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link
              to="/sign-in"
              search={{ redirect: `/invite/${encodeURIComponent(token)}`, email }}
            >
              {t('invite.signIn')}
            </Link>
          </Button>
        </>
      )}
    </>,
  );
}
