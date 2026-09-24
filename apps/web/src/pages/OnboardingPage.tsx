import {
  createAppSchema,
  createOrgSchema,
  ORG_ROLES,
  slugify,
  suggestAppKey,
  type AppContext,
  type CreateInvitationResponse,
  type OrgContext,
  type OrgRole,
} from '@testrex/contracts';
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
  Textarea,
} from '@testrex/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CenteredLayout, CopyField, RoleSelect } from '../components/common';
import { api, errorMessage, isApiError } from '../lib/api';
import { validate, type FieldErrors } from '../lib/validation';

const TOTAL_STEPS = 3;

function StepIndicator({ step }: { step: number }) {
  const { t } = useTranslation();
  return (
    <div className="mb-4 grid gap-2">
      <p className="text-sm font-medium text-muted-foreground">
        {t('onboarding.stepOf', { current: step, total: TOTAL_STEPS })}
      </p>
      <div className="flex gap-1.5" aria-hidden>
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${i < step ? 'bg-primary' : 'bg-muted'}`}
          />
        ))}
      </div>
    </div>
  );
}

function OrganizationStep({ onDone }: { onDone: (org: OrgContext) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const effectiveSlug = slugEdited ? slug : name ? slugify(name) : '';

  const mutation = useMutation({
    mutationFn: () => api.post<OrgContext>('/api/orgs', { name, slug: effectiveSlug }),
    onSuccess: onDone,
    onError: (error) => {
      if (
        isApiError(error) &&
        error.code === 'SLUG_TAKEN' &&
        typeof error.body.suggestion === 'string'
      ) {
        setSlug(error.body.suggestion);
        setSlugEdited(true);
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(createOrgSchema, { name, slug: effectiveSlug });
    setErrors(result.errors ?? {});
    if (result.data) mutation.mutate();
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {mutation.isError ? (
        <Alert variant="destructive">{errorMessage(mutation.error)}</Alert>
      ) : null}
      <Field label={t('onboarding.orgName')} error={errors.name}>
        {(control) => (
          <Input
            {...control}
            autoFocus
            placeholder={t('onboarding.orgNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t('onboarding.slug')}
        hint={t('onboarding.slugHint', {
          url: `${window.location.host}/o/${effectiveSlug || '…'}`,
        })}
        error={errors.slug}
      >
        {(control) => (
          <Input
            {...control}
            className="font-mono"
            value={effectiveSlug}
            onChange={(e) => {
              setSlugEdited(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
        )}
      </Field>
      <Button type="submit" disabled={mutation.isPending}>
        {t('common.continue')}
      </Button>
    </form>
  );
}

export function ApplicationForm({
  orgSlug,
  onDone,
  submitLabel,
}: {
  orgSlug: string;
  onDone: (app: AppContext) => void;
  submitLabel: string;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyEdited, setKeyEdited] = useState(false);
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const effectiveKey = keyEdited ? key : name ? suggestAppKey(name) : '';

  const mutation = useMutation({
    mutationFn: () =>
      api.post<AppContext>(`/api/orgs/${orgSlug}/apps`, {
        name,
        key: effectiveKey,
        description: description || undefined,
      }),
    onSuccess: onDone,
    onError: (error) => {
      if (
        isApiError(error) &&
        error.code === 'KEY_TAKEN' &&
        typeof error.body.suggestion === 'string'
      ) {
        setKey(error.body.suggestion);
        setKeyEdited(true);
      }
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(createAppSchema, { name, key: effectiveKey, description });
    setErrors(result.errors ?? {});
    if (result.data) mutation.mutate();
  };

  return (
    <form className="grid gap-4" onSubmit={submit} noValidate>
      {mutation.isError ? (
        <Alert variant="destructive">{errorMessage(mutation.error)}</Alert>
      ) : null}
      <Field label={t('onboarding.appName')} error={errors.name}>
        {(control) => (
          <Input
            {...control}
            autoFocus
            placeholder={t('onboarding.appNamePlaceholder')}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <Field
        label={t('onboarding.key')}
        hint={t('onboarding.keyHint', { example: `${effectiveKey || 'CHK'}-TC-1` })}
        error={errors.key}
      >
        {(control) => (
          <Input
            {...control}
            className="w-40 font-mono uppercase"
            maxLength={10}
            value={effectiveKey}
            onChange={(e) => {
              setKeyEdited(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
            }}
          />
        )}
      </Field>
      <Field
        label={`${t('onboarding.description')} (${t('common.optional')})`}
        error={errors.description}
      >
        {(control) => (
          <Textarea
            {...control}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        )}
      </Field>
      <Button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? t('apps.creating') : submitLabel}
      </Button>
    </form>
  );
}

interface InviteRow {
  email: string;
  role: OrgRole;
}

function InviteStep({
  org,
  app,
  onFinish,
}: {
  org: OrgContext;
  app: AppContext;
  onFinish: () => void;
}) {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InviteRow[]>([{ email: '', role: 'member' }]);
  const [links, setLinks] = useState<Array<{ email: string; link: string }>>([]);

  const mutation = useMutation({
    mutationFn: async () => {
      const created: Array<{ email: string; link: string }> = [];
      for (const row of rows.filter((r) => r.email.trim())) {
        const res = await api.post<CreateInvitationResponse>(
          `/api/orgs/${org.slug}/invitations`,
          row,
        );
        if (res.link) created.push({ email: row.email.trim(), link: res.link });
      }
      return created;
    },
    onSuccess: (created) => {
      if (created.length === 0) onFinish();
      else setLinks(created);
    },
  });

  if (links.length > 0) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">{t('onboarding.invitesReady')}</p>
        {links.map((item) => (
          <div key={item.email} className="grid gap-1">
            <p className="text-sm font-medium">{item.email}</p>
            <CopyField value={item.link} label={`${t('invitations.link')} ${item.email}`} />
          </div>
        ))}
        <Button onClick={onFinish}>{t('onboarding.finish', { app: app.name })}</Button>
      </div>
    );
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        mutation.mutate();
      }}
    >
      {mutation.isError ? (
        <Alert variant="destructive">{errorMessage(mutation.error)}</Alert>
      ) : null}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-[1fr_auto] items-end gap-2">
          <Field label={t('onboarding.inviteEmail')}>
            {(control) => (
              <Input
                {...control}
                type="email"
                placeholder="teammate@example.com"
                value={row.email}
                onChange={(e) =>
                  setRows(rows.map((r, i) => (i === index ? { ...r, email: e.target.value } : r)))
                }
              />
            )}
          </Field>
          <Field label={t('onboarding.inviteRole')}>
            {(control) => (
              <RoleSelect
                {...control}
                roles={ORG_ROLES}
                value={row.role}
                onChange={(role) =>
                  setRows(rows.map((r, i) => (i === index ? { ...r, role: role ?? 'member' } : r)))
                }
              />
            )}
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        className="justify-self-start"
        onClick={() => setRows([...rows, { email: '', role: 'member' }])}
      >
        <Plus /> {t('onboarding.addAnother')}
      </Button>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" onClick={onFinish}>
          {t('common.skip')}
        </Button>
        <Button type="submit" disabled={mutation.isPending || !rows.some((r) => r.email.trim())}>
          {t('onboarding.sendInvites')}
        </Button>
      </div>
    </form>
  );
}

export function OnboardingPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [org, setOrg] = useState<OrgContext | null>(null);
  const [app, setApp] = useState<AppContext | null>(null);
  const step = !org ? 1 : !app ? 2 : 3;

  const finish = async () => {
    await queryClient.invalidateQueries();
    await navigate({
      to: '/o/$orgSlug/a/$appKey',
      params: { orgSlug: org!.slug, appKey: app!.key },
    });
  };

  const [title, body] =
    step === 1
      ? [t('onboarding.orgTitle'), t('onboarding.orgBody')]
      : step === 2
        ? [t('onboarding.appTitle'), t('onboarding.appBody')]
        : [t('onboarding.inviteTitle'), t('onboarding.inviteBody')];

  return (
    <CenteredLayout>
      <StepIndicator step={step} />
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="text-2xl">{title}</span>
          </CardTitle>
          <CardDescription>{body}</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 1 ? (
            <OrganizationStep onDone={setOrg} />
          ) : step === 2 ? (
            <ApplicationForm
              orgSlug={org!.slug}
              onDone={setApp}
              submitLabel={t('common.continue')}
            />
          ) : (
            <InviteStep org={org!} app={app!} onFinish={finish} />
          )}
        </CardContent>
      </Card>
    </CenteredLayout>
  );
}
