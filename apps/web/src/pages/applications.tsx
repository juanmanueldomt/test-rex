import { hasAppPermission, hasOrgPermission, type AppContext } from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { AppWindow, Archive, Plus, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '../components/common';
import { api, errorMessage } from '../lib/api';
import { appQuery, appsQuery, invalidateOrg, orgQuery } from '../lib/queries';
import { ApplicationForm } from './OnboardingPage';

export function ApplicationsPage({
  orgSlug,
  showArchived,
  creating,
}: {
  orgSlug: string;
  showArchived: boolean;
  creating: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  const apps = useQuery(appsQuery(orgSlug, showArchived ? 'archived' : 'active'));
  const canCreate = hasOrgPermission(org.role, 'apps.create');
  const canArchive = hasOrgPermission(org.role, 'apps.archive');

  const setSearch = (search: { archived?: boolean; new?: 'app' }) =>
    navigate({ to: '/o/$orgSlug', params: { orgSlug }, search, replace: true });

  const onCreated = async (app: AppContext) => {
    toast.success(t('apps.created'));
    queryClient.setQueryData(appQuery(orgSlug, app.key).queryKey, app);
    await invalidateOrg(orgSlug);
    await navigate({ to: '/o/$orgSlug/a/$appKey', params: { orgSlug, appKey: app.key } });
  };

  return (
    <>
      <PageHeader
        title={t('apps.title')}
        description={t('apps.subtitle')}
        actions={
          <>
            {canArchive ? (
              <Button
                variant="ghost"
                onClick={() => setSearch(showArchived ? {} : { archived: true })}
              >
                <Archive /> {showArchived ? t('apps.hideArchived') : t('apps.showArchived')}
              </Button>
            ) : null}
            {canCreate ? (
              <Button onClick={() => setSearch({ new: 'app' })}>
                <Plus /> {t('apps.new')}
              </Button>
            ) : null}
          </>
        }
      />

      {apps.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      ) : apps.isError ? (
        <Alert variant="destructive">{errorMessage(apps.error)}</Alert>
      ) : apps.data.length === 0 ? (
        showArchived ? (
          <EmptyState icon={<Archive />} title={t('apps.emptyArchived')} />
        ) : canCreate ? (
          <EmptyState
            icon={<AppWindow />}
            title={t('apps.emptyAdminTitle')}
            description={t('apps.emptyAdminBody')}
            action={
              <Button onClick={() => setSearch({ new: 'app' })}>
                <Plus /> {t('apps.new')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<AppWindow />}
            title={t('apps.emptyMemberTitle')}
            description={t('apps.emptyMemberBody')}
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label={t('apps.title')}>
          {apps.data.map((app) => (
            <li key={app.id}>
              <Link
                to="/o/$orgSlug/a/$appKey"
                params={{ orgSlug, appKey: app.key }}
                className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="flex h-full flex-col gap-3 p-5 transition-colors hover:border-primary/50 hover:bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Badge variant="key">{app.key}</Badge>
                    {app.archivedAt ? <Badge variant="warning">{t('apps.archived')}</Badge> : null}
                  </div>
                  <div className="grid gap-1">
                    <h2 className="font-semibold">{app.name}</h2>
                    {app.description ? (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {app.description}
                      </p>
                    ) : null}
                  </div>
                  <p className="mt-auto text-xs text-muted-foreground">
                    {t('apps.yourRole', { role: t(`roles.${app.role}`) })}
                  </p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={creating && canCreate} onOpenChange={(open) => !open && void setSearch({})}>
        <DialogContent closeLabel={t('common.close')}>
          <DialogHeader>
            <DialogTitle>{t('apps.createTitle')}</DialogTitle>
            <DialogDescription>{t('apps.createBody')}</DialogDescription>
          </DialogHeader>
          <ApplicationForm orgSlug={orgSlug} onDone={onCreated} submitLabel={t('apps.create')} />
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Application name, key, role, settings link and the archived banner (workspace header). */
export function AppHeader({ orgSlug, appKey }: { orgSlug: string; appKey: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const org = useSuspenseQuery(orgQuery(orgSlug)).data;
  const app = useSuspenseQuery(appQuery(orgSlug, appKey)).data;
  const canManage = hasAppPermission(app.role, 'app.manage');

  const restore = useMutation({
    mutationFn: () => api.post<AppContext>(`/api/orgs/${orgSlug}/apps/${appKey}/restore`),
    onSuccess: async (updated) => {
      queryClient.setQueryData(appQuery(orgSlug, appKey).queryKey, updated);
      toast.success(t('appSettings.restored'));
      await invalidateOrg(orgSlug);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <Badge variant="key">{app.key}</Badge>
            <Badge variant="muted">{t(`roles.${app.role}`)}</Badge>
          </div>
        }
        title={app.name}
        description={app.description ?? undefined}
        actions={
          canManage ? (
            <Button variant="outline" asChild>
              <Link
                to="/o/$orgSlug/a/$appKey/settings"
                params={{ orgSlug, appKey }}
                search={{ tab: 'general' }}
              >
                <Settings /> {t('app.settings')}
              </Link>
            </Button>
          ) : null
        }
      />
      {app.archivedAt ? (
        <Alert variant="warning" className="mb-6 items-center">
          <Archive aria-hidden />
          <span className="flex-1">{t('app.archivedBanner')}</span>
          {hasOrgPermission(org.role, 'apps.archive') ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              {t('app.restore')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
    </>
  );
}
