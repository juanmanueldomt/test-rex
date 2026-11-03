import {
  formatTag,
  type PlaywrightCode,
  type Run,
  type TestCase,
  type TestCaseVersionSummary,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Skeleton,
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
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, Copy, Download, Pencil, Play, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader } from '../../components/common';
import { MarkdownView } from '../../components/editor/RichText';
import {
  formatRelative,
  PriorityLabel,
  RelativeTime,
  StatusBadge,
  TagChip,
  userName,
} from '../../components/scenario-ui';
import { StepsView } from '../../components/steps';
import { api, errorMessage } from '../../lib/api';
import {
  appApi,
  datasetsQuery,
  globalStepsQuery,
  invalidateRuns,
  invalidateTestCases,
  testCaseApi,
  testCaseCodeQuery,
  testCaseQuery,
  testCaseVersionQuery,
  testCaseVersionsQuery,
  testKeys,
} from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import { useAttachmentResolver } from '../scenarios/common';
import { ReviseTestCaseDialog } from './ai';
import { LastResultBadge, ModeBadge, useTestingAccess } from './common';

export type TestCaseTab = 'steps' | 'code' | 'history';
export const TEST_CASE_TABS: readonly TestCaseTab[] = ['steps', 'code', 'history'];

/** Copyable, downloadable source code. */
export function CodeBlock({ code, label }: { code: PlaywrightCode; label: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      toast.success(t('common.copied'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the code stays selectable.
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([code.code], { type: 'text/typescript' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = code.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-sm text-muted-foreground">{code.fileName}</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? <Check /> : <Copy />} {t('common.copy')}
          </Button>
          <Button variant="outline" size="sm" onClick={download}>
            <Download /> {t('testCases.download')}
          </Button>
        </div>
      </div>
      <pre
        tabIndex={0}
        aria-label={label}
        className="max-h-[36rem] overflow-auto rounded-lg border bg-muted p-4 font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <code>{code.code}</code>
      </pre>
    </div>
  );
}

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="flex flex-wrap items-center gap-1 text-sm">{children}</dd>
    </div>
  );
}

function DatasetPreview({
  orgSlug,
  appKey,
  testCase,
}: {
  orgSlug: string;
  appKey: string;
  testCase: TestCase;
}) {
  const { t } = useTranslation();
  const dataset = useQuery(datasetsQuery(orgSlug, appKey)).data?.find(
    (d) => d.id === testCase.dataset?.id,
  );
  if (!testCase.dataset) return null;
  return (
    <section aria-labelledby="tc-dataset" className="grid gap-2">
      <h2 id="tc-dataset" className="text-sm font-semibold">
        {t('testCases.fields.dataset')}
      </h2>
      <p className="text-sm text-muted-foreground">
        {t('testCases.datasetRuns', { name: testCase.dataset.name, count: dataset?.rowCount ?? 0 })}{' '}
        {dataset?.columns.map((column) => (
          <code
            key={column}
            className="mr-1 rounded bg-muted px-1 font-mono text-xs"
          >{`{{${column}}}`}</code>
        ))}
      </p>
    </section>
  );
}

function HistoryTab({
  orgSlug,
  appKey,
  testCase,
  canEdit,
}: {
  orgSlug: string;
  appKey: string;
  testCase: TestCase;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const versions = useQuery(testCaseVersionsQuery(orgSlug, appKey, testCase.key));
  const [viewing, setViewing] = useState<number | null>(null);
  const version = useQuery({
    ...testCaseVersionQuery(orgSlug, appKey, testCase.key, viewing ?? 0),
    enabled: viewing !== null,
  });
  const restore = useMutation({
    mutationFn: (number: number) =>
      api.post<TestCase>(
        `${testCaseApi(orgSlug, appKey, testCase.key)}/versions/${number}/restore`,
        {
          baseVersion: testCase.version,
        },
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(testKeys.testCase(orgSlug, appKey, saved.key), saved);
      await invalidateTestCases(orgSlug, appKey);
      toast.success(t('testCases.versionRestored', { version: saved.version }));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const changes = (summary: TestCaseVersionSummary) =>
    summary.number === 1
      ? t('history.created')
      : summary.changedFields.map((field) => t(`testCases.fields.${field}`)).join(', ');
  if (versions.isPending) return <Skeleton className="h-32" />;
  if (versions.isError) return <Alert variant="destructive">{errorMessage(versions.error)}</Alert>;
  return (
    <>
      <Table aria-label={t('testCases.historyLabel')}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{t('testCases.versionColumn')}</TableHead>
            <TableHead>{t('testCases.source')}</TableHead>
            <TableHead>{t('history.author')}</TableHead>
            <TableHead>{t('history.when')}</TableHead>
            <TableHead>{t('history.changes')}</TableHead>
            <TableHead className="sr-only">{t('history.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {versions.data.map((summary) => (
            <TableRow key={summary.id}>
              <TableCell className="font-mono text-xs">v{summary.number}</TableCell>
              <TableCell>
                <Badge variant={summary.source === 'editor' ? 'muted' : 'default'}>
                  {t(`testCases.sources.${summary.source}`)}
                </Badge>
              </TableCell>
              <TableCell>{userName(summary.author)}</TableCell>
              <TableCell>
                <RelativeTime value={summary.createdAt} />
              </TableCell>
              <TableCell className="text-sm">
                {summary.restoredFrom
                  ? `${t('testCases.restoredFrom', { number: summary.restoredFrom })} · `
                  : ''}
                {changes(summary)}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setViewing(summary.number)}>
                    {t('testCases.view')}
                  </Button>
                  {canEdit && summary.number !== testCase.version && !testCase.deletedAt ? (
                    <ConfirmButton
                      size="sm"
                      variant="ghost"
                      destructive={false}
                      title={t('testCases.restoreVersionTitle', { number: summary.number })}
                      description={t('testCases.restoreVersionBody', {
                        next: testCase.version + 1,
                      })}
                      confirmLabel={t('history.restore')}
                      onConfirm={() => restore.mutate(summary.number)}
                    >
                      <RotateCcw /> {t('history.restore')}
                    </ConfirmButton>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent
          className="max-h-[90vh] max-w-3xl overflow-y-auto"
          closeLabel={t('common.close')}
        >
          <DialogHeader>
            <DialogTitle>
              {t('testCases.versionTitle', { key: testCase.key, number: viewing ?? 0 })}
            </DialogTitle>
          </DialogHeader>
          {version.data ? (
            <div className="grid gap-3">
              <p className="font-medium">{version.data.title}</p>
              <div className="flex flex-wrap gap-2">
                <StatusBadge status={version.data.status} />
                <ModeBadge mode={version.data.executionMode} />
                <PriorityLabel priority={version.data.priority} />
              </div>
              <StepsView steps={version.data.steps} />
            </div>
          ) : (
            <Skeleton className="h-40" />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function TestCasePage({
  orgSlug,
  appKey,
  testCaseKey,
  tab,
}: {
  orgSlug: string;
  appKey: string;
  testCaseKey: string;
  tab: TestCaseTab;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canEdit, canExecute, canUseAi } = useTestingAccess(orgSlug, appKey);
  const resolveImageSrc = useAttachmentResolver(orgSlug, appKey);
  const testCase = useSuspenseQuery(testCaseQuery(orgSlug, appKey, testCaseKey)).data;
  const code = useQuery({
    ...testCaseCodeQuery(orgSlug, appKey, testCaseKey),
    enabled: tab === 'code',
  });
  const hooks = useQuery(globalStepsQuery(orgSlug, appKey)).data ?? [];
  const [revising, setRevising] = useState(false);
  const deleted = Boolean(testCase.deletedAt);
  const editable = canEdit && !deleted;

  const afterChange = async (updated: TestCase, message: string) => {
    queryClient.setQueryData(testKeys.testCase(orgSlug, appKey, testCaseKey), updated);
    await invalidateTestCases(orgSlug, appKey);
    toast.success(message);
  };
  const remove = useMutation({
    mutationFn: () => api.delete<TestCase>(testCaseApi(orgSlug, appKey, testCase.key)),
    onSuccess: (updated) => afterChange(updated, t('testCases.deleted')),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const restore = useMutation({
    mutationFn: () => api.post<TestCase>(`${testCaseApi(orgSlug, appKey, testCase.key)}/restore`),
    onSuccess: (updated) => afterChange(updated, t('testCases.restored')),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const run = useMutation({
    mutationFn: () =>
      api.post<Run>(`${appApi(orgSlug, appKey)}/runs`, { testCaseIds: [testCase.id] }),
    onSuccess: async (created) => {
      await invalidateRuns(orgSlug, appKey);
      await navigate({
        to: '/o/$orgSlug/a/$appKey/runs/$runKey',
        params: { orgSlug, appKey, runKey: created.key },
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const edit = () =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/test-cases/$testCaseKey/edit',
      params: { orgSlug, appKey, testCaseKey: testCase.key },
    });
  useShortcut({
    keys: 'e',
    description: t('shortcuts.editTestCase'),
    group: 'testCases',
    enabled: editable,
    handler: edit,
  });
  const setTab = (value: string) =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/test-cases/$testCaseKey',
      params: { orgSlug, appKey, testCaseKey },
      search: value === 'steps' ? {} : { tab: value as TestCaseTab },
      replace: true,
    });
  const phaseHooks = (phase: 'beforeEach' | 'afterEach') =>
    hooks.filter((hook) => hook.phase === phase && hook.enabled).map((hook) => hook.name);

  return (
    <>
      <nav aria-label={t('scenario.breadcrumb')} className="mb-2 text-sm text-muted-foreground">
        <Link
          to="/o/$orgSlug/a/$appKey/test-cases"
          params={{ orgSlug, appKey }}
          className="hover:underline"
        >
          {t('workspace.tabs.testCases')}
        </Link>
      </nav>
      {deleted ? (
        <Alert variant="warning" className="mb-6 flex-wrap items-center">
          <Trash2 aria-hidden />
          <span className="flex-1">
            {t('testCases.deletedBanner', {
              when: formatRelative(testCase.deletedAt!),
              name: userName(testCase.deletedBy),
            })}
          </span>
          {canEdit ? (
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
            <Badge variant="key">{testCase.key}</Badge>
            <Badge variant="muted">{t('testCases.version', { number: testCase.version })}</Badge>
            <StatusBadge status={testCase.status} />
            <ModeBadge mode={testCase.executionMode} />
            <LastResultBadge result={testCase.lastResult} orgSlug={orgSlug} appKey={appKey} />
          </div>
        }
        title={testCase.title}
        actions={
          <>
            {canExecute && !deleted ? (
              <Button
                onClick={() => run.mutate()}
                disabled={run.isPending || testCase.stepCount === 0}
              >
                <Play /> {t('testCases.runNow')}
              </Button>
            ) : null}
            {editable && canUseAi ? (
              <Button variant="outline" onClick={() => setRevising(true)}>
                <Sparkles /> {t('ai.improve')}
              </Button>
            ) : null}
            {editable ? (
              <>
                <Button variant="outline" onClick={edit}>
                  <Pencil /> {t('scenario.edit')}
                </Button>
                <ConfirmButton
                  variant="ghost"
                  title={t('testCases.deleteTitle', { key: testCase.key })}
                  description={t('testCases.deleteBody')}
                  confirmLabel={t('scenario.delete')}
                  onConfirm={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  <Trash2 /> {t('scenario.delete')}
                </ConfirmButton>
              </>
            ) : null}
          </>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="steps">
            {t('testCases.tabs.steps', { count: testCase.stepCount })}
          </TabsTrigger>
          <TabsTrigger value="code">{t('testCases.tabs.code')}</TabsTrigger>
          <TabsTrigger value="history">{t('testCases.tabs.history')}</TabsTrigger>
        </TabsList>
        <TabsContent value="steps">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="grid content-start gap-6">
              {testCase.description ? (
                <section aria-labelledby="tc-description" className="grid gap-2">
                  <h2 id="tc-description" className="text-sm font-semibold">
                    {t('testCases.fields.description')}
                  </h2>
                  <MarkdownView markdown={testCase.description} resolveImageSrc={resolveImageSrc} />
                </section>
              ) : null}
              {testCase.preconditions ? (
                <section aria-labelledby="tc-preconditions" className="grid gap-2">
                  <h2 id="tc-preconditions" className="text-sm font-semibold">
                    {t('testCases.fields.preconditions')}
                  </h2>
                  <MarkdownView
                    markdown={testCase.preconditions}
                    resolveImageSrc={resolveImageSrc}
                  />
                </section>
              ) : null}
              <DatasetPreview orgSlug={orgSlug} appKey={appKey} testCase={testCase} />
              <section aria-labelledby="tc-steps" className="grid gap-2">
                <h2 id="tc-steps" className="text-sm font-semibold">
                  {t('testCases.fields.steps')}
                </h2>
                {phaseHooks('beforeEach').length ? (
                  <p className="text-xs text-muted-foreground">
                    {t('testCases.beforeEachNote', { names: phaseHooks('beforeEach').join(', ') })}
                  </p>
                ) : null}
                <StepsView steps={testCase.steps} emptyText={t('testCases.noSteps')} />
                {phaseHooks('afterEach').length ? (
                  <p className="text-xs text-muted-foreground">
                    {t('testCases.afterEachNote', { names: phaseHooks('afterEach').join(', ') })}
                  </p>
                ) : null}
              </section>
            </div>
            <aside aria-label={t('testCases.properties')}>
              <dl className="grid gap-4 rounded-lg border bg-card p-4">
                <Property label={t('testCases.fields.scenarios')}>
                  {testCase.scenarios.map((scenario) => (
                    <Link
                      key={scenario.id}
                      to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
                      params={{ orgSlug, appKey, scenarioKey: scenario.key }}
                      className="grid rounded-md border px-2 py-1 text-xs hover:border-primary/60"
                    >
                      <span className="font-mono">{scenario.key}</span>
                      <span className={scenario.deleted ? 'line-through' : undefined}>
                        {scenario.title}
                      </span>
                    </Link>
                  ))}
                </Property>
                <Property label={t('scenario.fields.priority')}>
                  <PriorityLabel priority={testCase.priority} />
                </Property>
                <Property label={t('scenario.fields.tags')}>
                  {testCase.tags.length ? (
                    testCase.tags.map((tag) => <TagChip key={tag} tag={tag} />)
                  ) : (
                    <span className="text-muted-foreground">{t('scenario.noTags')}</span>
                  )}
                </Property>
                <Property label={t('testCases.fields.dataset')}>
                  {testCase.dataset?.name ?? (
                    <span className="text-muted-foreground">{t('testCases.noDataset')}</span>
                  )}
                </Property>
                <Property label={t('scenario.author')}>
                  {userName(testCase.author)} · <RelativeTime value={testCase.createdAt} />
                </Property>
                <Property label={t('scenario.lastUpdate')}>
                  {userName(testCase.updatedBy)} · <RelativeTime value={testCase.updatedAt} />
                </Property>
                {testCase.tags.length ? (
                  <p className="text-xs text-muted-foreground">
                    {t('testCases.tagsInCode', { tags: testCase.tags.map(formatTag).join(' ') })}
                  </p>
                ) : null}
              </dl>
            </aside>
          </div>
        </TabsContent>
        <TabsContent value="code">
          <p className="mb-3 text-sm text-muted-foreground">{t('testCases.codeIntro')}</p>
          {code.data ? (
            <CodeBlock code={code.data} label={t('testCases.codeLabel', { key: testCase.key })} />
          ) : code.isError ? (
            <Alert variant="destructive">{errorMessage(code.error)}</Alert>
          ) : (
            <Skeleton className="h-64" />
          )}
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab orgSlug={orgSlug} appKey={appKey} testCase={testCase} canEdit={canEdit} />
        </TabsContent>
      </Tabs>
      {canUseAi ? (
        <ReviseTestCaseDialog
          orgSlug={orgSlug}
          appKey={appKey}
          testCase={testCase}
          open={revising}
          onOpenChange={setRevising}
        />
      ) : null}
    </>
  );
}
