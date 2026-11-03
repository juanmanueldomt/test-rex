import type { Scenario } from '@testrex/contracts';
import { Alert, Badge, Button, Tabs, TabsContent, TabsList, TabsTrigger } from '@testrex/ui';
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader } from '../../components/common';
import { formatRelative, RelativeTime, StatusBadge, userName } from '../../components/scenario-ui';
import { api, errorMessage } from '../../lib/api';
import { invalidateScenarios, keys, meQuery, scenarioApi, scenarioQuery } from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import { ScenarioTestCases } from '../test-cases/ScenarioTestCases';
import { AttachmentsPanel } from './attachments';
import { CommentsThread, LinksPanel } from './collaboration';
import { useAttachmentResolver, useScenarioAccess } from './common';
import { HistoryTab, RichTextSections, ScenarioProperties } from './revisions';

export type ScenarioTab = 'details' | 'cases' | 'history';
export const SCENARIO_TABS: readonly ScenarioTab[] = ['details', 'cases', 'history'];

export function ScenarioPage({
  orgSlug,
  appKey,
  scenarioKey,
  tab,
}: {
  orgSlug: string;
  appKey: string;
  scenarioKey: string;
  tab: ScenarioTab;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useSuspenseQuery(meQuery).data;
  const { canWrite, canComment, canModerate } = useScenarioAccess(orgSlug, appKey);
  const resolveImageSrc = useAttachmentResolver(orgSlug, appKey);
  const scenario = useSuspenseQuery(scenarioQuery(orgSlug, appKey, scenarioKey)).data;
  const deleted = Boolean(scenario.deletedAt);
  const editable = canWrite && !deleted;

  const afterChange = async (updated: Scenario, message: string) => {
    queryClient.setQueryData(keys.scenario(orgSlug, appKey, scenarioKey), updated);
    await invalidateScenarios(orgSlug, appKey);
    toast.success(message);
  };
  const remove = useMutation({
    mutationFn: () => api.delete<Scenario>(scenarioApi(orgSlug, appKey, scenario.key)),
    onSuccess: (updated) => afterChange(updated, t('scenario.deleted')),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const restore = useMutation({
    mutationFn: () => api.post<Scenario>(`${scenarioApi(orgSlug, appKey, scenario.key)}/restore`),
    onSuccess: (updated) => afterChange(updated, t('scenario.restored')),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const edit = () =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey/edit',
      params: { orgSlug, appKey, scenarioKey: scenario.key },
    });
  useShortcut({
    keys: 'e',
    description: t('shortcuts.edit'),
    group: 'scenarios',
    enabled: editable,
    handler: edit,
  });

  const setTab = (value: string) =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey',
      params: { orgSlug, appKey, scenarioKey },
      search: value === 'details' ? {} : { tab: value as ScenarioTab },
      replace: true,
    });

  return (
    <>
      <nav aria-label={t('scenario.breadcrumb')} className="mb-2 text-sm text-muted-foreground">
        <Link
          to="/o/$orgSlug/a/$appKey/scenarios"
          params={{ orgSlug, appKey }}
          className="hover:underline"
        >
          {t('workspace.tabs.scenarios')}
        </Link>
      </nav>
      {deleted ? (
        <Alert variant="warning" className="mb-6 flex-wrap items-center">
          <Trash2 aria-hidden />
          <span className="flex-1">
            {t('scenario.deletedBanner', {
              when: formatRelative(scenario.deletedAt!),
              name: userName(scenario.deletedBy),
            })}
          </span>
          {canWrite ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => restore.mutate()}
              disabled={restore.isPending}
            >
              <RotateCcw /> {t('scenario.restore')}
            </Button>
          ) : null}
        </Alert>
      ) : null}
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="key">{scenario.key}</Badge>
            <Badge variant="muted" title={t('scenario.currentRevision')}>
              {t('scenario.revision', { number: scenario.revision })}
            </Badge>
            <StatusBadge status={scenario.status} />
          </div>
        }
        title={scenario.title}
        actions={
          editable ? (
            <>
              <Button variant="outline" asChild>
                <Link
                  to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey/edit"
                  params={{ orgSlug, appKey, scenarioKey: scenario.key }}
                >
                  <Pencil /> {t('scenario.edit')}
                </Link>
              </Button>
              <ConfirmButton
                variant="ghost"
                title={t('scenario.deleteTitle', { key: scenario.key })}
                description={t('scenario.deleteBody')}
                confirmLabel={t('scenario.delete')}
                onConfirm={() => remove.mutate()}
                disabled={remove.isPending}
              >
                <Trash2 /> {t('scenario.delete')}
              </ConfirmButton>
            </>
          ) : null
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="details">{t('scenario.tabs.details')}</TabsTrigger>
          <TabsTrigger value="cases">
            {t('scenario.tabs.cases', { count: scenario.testCaseCount })}
          </TabsTrigger>
          <TabsTrigger value="history">{t('scenario.tabs.history')}</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="grid content-start gap-8">
              <RichTextSections
                description={scenario.description}
                stepsToReach={scenario.stepsToReach}
                resolveImageSrc={resolveImageSrc}
              />
              <CommentsThread
                orgSlug={orgSlug}
                appKey={appKey}
                scenarioKey={scenario.key}
                canComment={canComment && !deleted}
                canModerate={canModerate && !deleted}
                currentUserId={me.user.id}
                resolveImageSrc={resolveImageSrc}
              />
            </div>
            <aside aria-label={t('scenario.properties')} className="grid content-start gap-8">
              <ScenarioProperties
                value={scenario}
                extra={
                  <>
                    <div className="grid gap-1">
                      <dt className="text-xs font-medium text-muted-foreground">
                        {t('scenario.author')}
                      </dt>
                      <dd className="flex flex-wrap items-center gap-1 text-sm">
                        {userName(scenario.author)} · <RelativeTime value={scenario.createdAt} />
                      </dd>
                    </div>
                    <div className="grid gap-1">
                      <dt className="text-xs font-medium text-muted-foreground">
                        {t('scenario.lastUpdate')}
                      </dt>
                      <dd className="flex flex-wrap items-center gap-1 text-sm">
                        {userName(scenario.updatedBy)} · <RelativeTime value={scenario.updatedAt} />
                      </dd>
                    </div>
                  </>
                }
              />
              <LinksPanel
                orgSlug={orgSlug}
                appKey={appKey}
                scenarioKey={scenario.key}
                canWrite={editable}
              />
              <AttachmentsPanel
                orgSlug={orgSlug}
                appKey={appKey}
                scenarioKey={scenario.key}
                canWrite={editable}
              />
            </aside>
          </div>
        </TabsContent>

        <TabsContent value="cases">
          <ScenarioTestCases orgSlug={orgSlug} appKey={appKey} scenario={scenario} />
        </TabsContent>

        <TabsContent value="history">
          <HistoryTab
            orgSlug={orgSlug}
            appKey={appKey}
            scenarioKey={scenario.key}
            current={scenario.revision}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
