import {
  APP_ROLES,
  hasAppPermission,
  hasOrgPermission,
  updateAppSchema,
  type AppContext,
  type AppRole,
} from '@testrex/contracts';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Archive, ArchiveRestore, Lock } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader, RoleSelect } from '../components/common';
import { api, errorMessage } from '../lib/api';
import { appMembersQuery, appQuery, invalidateOrg, orgQuery } from '../lib/queries';
import { validate, type FieldErrors } from '../lib/validation';

export type AppSettingsTab = 'general' | 'members' | 'archive';

function GeneralSection({
  orgSlug,
  app,
  editable,
}: {
  orgSlug: string;
  app: AppContext;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(app.name);
  const [description, setDescription] = useState(app.description ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const save = useMutation({
    mutationFn: () =>
      api.patch<AppContext>(`/api/orgs/${orgSlug}/apps/${app.key}`, {
        name,
        description: description || null,
      }),
    onSuccess: async (updated) => {
      queryClient.setQueryData(appQuery(orgSlug, app.key).queryKey, updated);
      toast.success(t('common.saved'));
      await invalidateOrg(orgSlug);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = validate(updateAppSchema, { name, description: description || null });
    setErrors(result.errors ?? {});
    if (result.data) save.mutate();
  };
  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle>{t('appSettings.general')}</CardTitle>
          {!editable ? <CardDescription>{t('appSettings.readOnly')}</CardDescription> : null}
        </CardHeader>
        <CardContent className="grid max-w-xl gap-4">
          {save.isError ? <Alert variant="destructive">{errorMessage(save.error)}</Alert> : null}
          <Field label={t('appSettings.name')} error={errors.name}>
            {(control) => (
              <Input
                {...control}
                disabled={!editable}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('appSettings.description')} error={errors.description}>
            {(control) => (
              <Textarea
                {...control}
                disabled={!editable}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('appSettings.key')} hint={t('appSettings.keyLocked')}>
            {(control) => (
              <div className="flex items-center gap-2">
                <Input {...control} readOnly value={app.key} className="w-40 font-mono" />
                <Lock className="size-4 text-muted-foreground" aria-hidden />
              </div>
            )}
          </Field>
        </CardContent>
        {editable ? (
          <CardFooter>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}

function MembersSection({
  orgSlug,
  app,
  editable,
}: {
  orgSlug: string;
  app: AppContext;
  editable: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const members = useQuery(appMembersQuery(orgSlug, app.key));
  const change = useMutation({
    mutationFn: ({ userId, role }: { userId: string; name: string; role: AppRole | null }) =>
      role
        ? api.put(`/api/orgs/${orgSlug}/apps/${app.key}/members/${userId}`, { role })
        : api.delete(`/api/orgs/${orgSlug}/apps/${app.key}/members/${userId}`),
    onSuccess: async (_data, variables) => {
      toast.success(t('appSettings.accessUpdated', { name: variables.name }));
      await queryClient.invalidateQueries({ queryKey: appMembersQuery(orgSlug, app.key).queryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('appSettings.membersBody')}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('members.name')}</TableHead>
            <TableHead className="w-64">{t('members.role')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(members.data ?? []).map((member) => (
            <TableRow key={member.userId}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar name={member.name} />
                  <div className="grid">
                    <span className="font-medium">{member.name}</span>
                    <span className="text-xs text-muted-foreground">{member.email}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                {member.implicit ? (
                  <div className="grid">
                    <span>{t('roles.manager')}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('appSettings.via', { role: t(`roles.${member.orgRole}`).toLowerCase() })}
                    </span>
                  </div>
                ) : editable ? (
                  <RoleSelect
                    aria-label={t('members.roleFor', { name: member.name })}
                    roles={APP_ROLES}
                    includeNone
                    value={member.appRole}
                    disabled={change.isPending}
                    onChange={(role) =>
                      change.mutate({ userId: member.userId, name: member.name, role })
                    }
                  />
                ) : (
                  <span>{t(`roles.${member.appRole ?? 'none'}`)}</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ArchiveSection({ orgSlug, app }: { orgSlug: string; app: AppContext }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toggle = useMutation({
    mutationFn: () =>
      api.post<AppContext>(
        `/api/orgs/${orgSlug}/apps/${app.key}/${app.archivedAt ? 'restore' : 'archive'}`,
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData(appQuery(orgSlug, app.key).queryKey, updated);
      toast.success(updated.archivedAt ? t('appSettings.archived') : t('appSettings.restored'));
      await invalidateOrg(orgSlug);
      if (updated.archivedAt) await navigate({ to: '/o/$orgSlug', params: { orgSlug } });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  return (
    <Card className={app.archivedAt ? '' : 'border-destructive/40'}>
      <CardHeader>
        <CardTitle>
          {app.archivedAt ? t('appSettings.restoreTitle') : t('appSettings.archiveTitle')}
        </CardTitle>
        <CardDescription>
          {app.archivedAt ? t('appSettings.restoreBody') : t('appSettings.archiveBody')}
        </CardDescription>
      </CardHeader>
      <CardFooter>
        {app.archivedAt ? (
          <Button onClick={() => toggle.mutate()} disabled={toggle.isPending}>
            <ArchiveRestore /> {t('app.restore')}
          </Button>
        ) : (
          <ConfirmButton
            variant="destructive"
            title={t('appSettings.archiveConfirm', { app: app.name })}
            description={t('appSettings.archiveBody')}
            confirmLabel={t('appSettings.archive')}
            onConfirm={() => toggle.mutate()}
          >
            <Archive /> {t('appSettings.archive')}
          </ConfirmButton>
        )}
      </CardFooter>
    </Card>
  );
}

export function AppSettingsPage({
  orgSlug,
  appKey,
  tab,
}: {
  orgSlug: string;
  appKey: string;
  tab: AppSettingsTab;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  const app = useSuspenseQuery(appQuery(orgSlug, appKey)).data;
  const canManage = hasAppPermission(app.role, 'app.manage');
  const canArchive = hasOrgPermission(org.role, 'apps.archive');
  const editable = canManage && !app.archivedAt;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            to="/o/$orgSlug/a/$appKey"
            params={{ orgSlug, appKey }}
            className="flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <Badge variant="key">{app.key}</Badge> {app.name}
          </Link>
        }
        title={t('appSettings.title')}
      />
      {app.archivedAt ? (
        <Alert variant="warning" className="mb-6">
          <Archive aria-hidden />
          {t('app.archivedBanner')}
        </Alert>
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(value) =>
          void navigate({
            to: '/o/$orgSlug/a/$appKey/settings',
            params: { orgSlug, appKey },
            search: { tab: value as AppSettingsTab },
            replace: true,
          })
        }
      >
        <TabsList>
          <TabsTrigger value="general">{t('appSettings.general')}</TabsTrigger>
          <TabsTrigger value="members">{t('appSettings.members')}</TabsTrigger>
          {canArchive ? (
            <TabsTrigger value="archive">{t('appSettings.dangerZone')}</TabsTrigger>
          ) : null}
        </TabsList>
        <TabsContent value="general">
          <GeneralSection
            key={`${app.name}-${app.description}`}
            orgSlug={orgSlug}
            app={app}
            editable={editable}
          />
        </TabsContent>
        <TabsContent value="members">
          <MembersSection orgSlug={orgSlug} app={app} editable={editable} />
        </TabsContent>
        {canArchive ? (
          <TabsContent value="archive">
            <ArchiveSection orgSlug={orgSlug} app={app} />
          </TabsContent>
        ) : null}
      </Tabs>
    </>
  );
}
