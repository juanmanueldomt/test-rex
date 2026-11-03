import {
  aggregateStatus,
  FINAL_ITEM_STATUSES,
  isFinal,
  type FinalItemStatus,
  type IterationResult,
  type Run,
  type RunItemDetail,
  type RunItemStatus,
  type StepResultStatus,
  type TestStep,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  cn,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  CircleStop,
  Download,
  ExternalLink,
  Flag,
  RotateCw,
  Save,
  Sparkles,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader } from '../../components/common';
import { RelativeTime, userName } from '../../components/scenario-ui';
import { ResultBadge, StepsView, useStepText } from '../../components/steps';
import { api, errorMessage } from '../../lib/api';
import { formatDateTime } from '../../lib/i18n';
import { invalidateRuns, runApi, runItemQuery, runQuery, testKeys } from '../../lib/queries';
import { ReviseTestCaseDialog } from '../test-cases/ai';
import {
  formatDuration,
  formatPercent,
  ItemStatusBadge,
  ModeBadge,
  RunStatusBadge,
  ScenarioChips,
  useTestingAccess,
} from '../test-cases/common';
import { RunProgress } from './RunsPage';

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-card p-4">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

function Artifacts({ iteration }: { iteration: IterationResult }) {
  const { t } = useTranslation();
  if (!iteration.artifacts?.length) return null;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{t('runs.artifacts')}</p>
      <div className="flex flex-wrap items-start gap-3">
        {iteration.artifacts.map((artifact) =>
          artifact.kind === 'screenshot' ? (
            <a
              key={artifact.id}
              href={artifact.url}
              target="_blank"
              rel="noopener"
              className="block"
            >
              <img
                src={artifact.url}
                alt={t('runs.screenshotAlt', { iteration: iteration.index + 1 })}
                className="max-h-56 rounded-md border"
              />
            </a>
          ) : artifact.kind === 'video' ? (
            <video
              key={artifact.id}
              src={artifact.url}
              controls
              className="max-h-56 rounded-md border"
            >
              <track kind="captions" />
            </video>
          ) : (
            <div key={artifact.id} className="grid gap-1 text-sm">
              <Button variant="outline" size="sm" asChild>
                <a href={artifact.url} download>
                  <Download /> {t('runs.trace')}
                </a>
              </Button>
              <a
                href="https://trace.playwright.dev"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary underline"
              >
                {t('runs.traceViewer')} <ExternalLink className="size-3" aria-hidden />
              </a>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

function IterationView({ item, iteration }: { item: RunItemDetail; iteration: IterationResult }) {
  const { t } = useTranslation();
  const before = iteration.hooks.filter((hook) => hook.phase === 'beforeEach');
  const after = iteration.hooks.filter((hook) => hook.phase === 'afterEach');
  const hookList = (hooks: typeof before, title: string) =>
    hooks.length ? (
      <div className="grid gap-1">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <ul className="flex flex-wrap gap-2">
          {hooks.map((hook) => (
            <li key={hook.hookId} className="flex items-center gap-1 text-sm">
              <ResultBadge status={hook.status} /> {hook.name}
            </li>
          ))}
        </ul>
      </div>
    ) : null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <ItemStatusBadge status={iteration.status} />
        {iteration.durationMs !== null ? (
          <span className="text-muted-foreground">{formatDuration(iteration.durationMs)}</span>
        ) : null}
        {iteration.data ? (
          <span className="flex flex-wrap gap-1">
            {Object.entries(iteration.data).map(([key, value]) => (
              <code key={key} className="rounded bg-muted px-1 font-mono text-xs">
                {key}={value}
              </code>
            ))}
          </span>
        ) : null}
      </div>
      {iteration.error ? (
        <Alert variant="destructive" className="grid gap-1">
          <p className="font-medium">{t('runs.failure')}</p>
          <pre className="whitespace-pre-wrap text-xs">{iteration.error.message}</pre>
          {iteration.url ? (
            <p className="text-xs">{t('runs.pageUrl', { url: iteration.url })}</p>
          ) : null}
        </Alert>
      ) : null}
      {hookList(before, t('automation.phases.beforeEach'))}
      <StepsView steps={item.steps} results={iteration.steps} />
      {hookList(after, t('automation.phases.afterEach'))}
      {iteration.consoleErrors?.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">
            {t('runs.consoleErrors', { count: iteration.consoleErrors.length })}
          </summary>
          <ul className="mt-2 grid gap-1 font-mono text-xs">
            {iteration.consoleErrors.map((message, index) => (
              <li key={index}>{message}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <Artifacts iteration={iteration} />
    </div>
  );
}

const STEP_CHOICES: StepResultStatus[] = ['passed', 'failed', 'blocked', 'skipped'];

/** Step-by-step execution of a manual item, one dataset row at a time. */
function ManualRunner({
  orgSlug,
  appKey,
  run,
  item,
  onSaved,
}: {
  orgSlug: string;
  appKey: string;
  run: Run;
  item: RunItemDetail;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const describe = useStepText();
  const queryClient = useQueryClient();
  const rows = item.dataset ? item.dataset.rows : [null];
  const initial = rows.map((_, index) => {
    const existing = item.iterations.find((iteration) => iteration.index === index);
    return {
      status: (existing && isFinal(existing.status) ? existing.status : '') as FinalItemStatus | '',
      steps: Object.fromEntries(
        (existing?.steps ?? []).map((step) => [
          step.stepId,
          { status: step.status, actual: step.actual ?? '' },
        ]),
      ) as Record<string, { status: StepResultStatus; actual: string }>,
    };
  });
  const [iterations, setIterations] = useState(initial);
  const [current, setCurrent] = useState(0);
  const [notes, setNotes] = useState(item.notes ?? '');
  const state = iterations[current]!;
  const suggested = (steps: Record<string, { status: StepResultStatus }>): FinalItemStatus | '' => {
    const statuses = item.steps.map((step) => steps[step.id]?.status ?? 'untested');
    if (statuses.every((status) => status === 'untested')) return '';
    const aggregated = aggregateStatus(
      statuses.map((s) => (s === 'untested' ? 'untested' : s)) as RunItemStatus[],
    );
    return isFinal(aggregated) ? aggregated : '';
  };
  const setStep = (step: TestStep, patch: Partial<{ status: StepResultStatus; actual: string }>) =>
    setIterations((all) =>
      all.map((iteration, index) => {
        if (index !== current) return iteration;
        const steps = {
          ...iteration.steps,
          [step.id]: {
            status: 'untested' as StepResultStatus,
            actual: '',
            ...iteration.steps[step.id],
            ...patch,
          },
        };
        return { steps, status: suggested(steps) || iteration.status };
      }),
    );
  const save = useMutation({
    mutationFn: () =>
      api.put<RunItemDetail>(`${runApi(orgSlug, appKey, run.key)}/items/${item.id}/result`, {
        iterations: iterations.map((iteration, index) => ({
          index,
          status: iteration.status,
          steps: Object.entries(iteration.steps).map(([stepId, result]) => ({
            stepId,
            status: result.status,
            actual: result.actual,
          })),
        })),
        notes,
      }),
    onSuccess: async (saved) => {
      queryClient.setQueryData(runItemQuery(orgSlug, appKey, run.key, item.id).queryKey, saved);
      await queryClient.invalidateQueries({ queryKey: testKeys.run(orgSlug, appKey, run.key) });
      await invalidateRuns(orgSlug, appKey);
      toast.success(t('runs.resultSaved'));
      onSaved();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const missing = iterations.findIndex((iteration) => !iteration.status);
  const hooks = (phase: 'beforeEach' | 'afterEach') =>
    run.hooks.filter((hook) => hook.phase === phase);
  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      {rows.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="iteration">{t('runs.iteration')}</Label>
          <NativeSelect
            id="iteration"
            className="w-auto"
            value={current}
            onChange={(e) => setCurrent(Number(e.target.value))}
          >
            {rows.map((row, index) => (
              <option key={index} value={index}>
                {t('runs.iterationOption', { number: index + 1 })}
                {row ? ` · ${row.join(', ')}` : ''}
                {iterations[index]?.status
                  ? ` · ${t(`runs.itemStatus.${iterations[index]!.status}`)}`
                  : ''}
              </option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
      {item.dataset && rows[current] ? (
        <p className="flex flex-wrap gap-1 text-sm">
          {item.dataset.columns.map((column, index) => (
            <code key={column} className="rounded bg-muted px-1 font-mono text-xs">
              {column}={rows[current]![index]}
            </code>
          ))}
        </p>
      ) : null}
      {hooks('beforeEach').length ? (
        <Alert variant="info">
          <Flag aria-hidden />
          <span>
            {t('runs.manualBeforeEach', {
              names: hooks('beforeEach')
                .map((h) => h.name)
                .join(', '),
            })}
          </span>
        </Alert>
      ) : null}
      <StepsView
        steps={item.steps}
        renderExtra={(step) => {
          const result = state.steps[step.id];
          return (
            <div className="mt-2 grid gap-2">
              <div
                role="radiogroup"
                aria-label={t('runs.stepResultFor', { step: describe.text(step) })}
                className="flex flex-wrap gap-1"
              >
                {STEP_CHOICES.map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    role="radio"
                    aria-checked={result?.status === status}
                    variant={
                      result?.status === status
                        ? status === 'failed'
                          ? 'destructive'
                          : 'default'
                        : 'outline'
                    }
                    onClick={() => setStep(step, { status })}
                  >
                    {t(`runs.itemStatus.${status}`)}
                  </Button>
                ))}
              </div>
              {result && result.status !== 'passed' && result.status !== 'untested' ? (
                <Textarea
                  aria-label={t('runs.actualFor', { step: describe.text(step) })}
                  placeholder={t('runs.actualPlaceholder')}
                  className="min-h-9"
                  rows={2}
                  value={result.actual}
                  onChange={(event) => setStep(step, { actual: event.target.value })}
                />
              ) : null}
            </div>
          );
        }}
      />
      {hooks('afterEach').length ? (
        <Alert variant="info">
          <Flag aria-hidden />
          <span>
            {t('runs.manualAfterEach', {
              names: hooks('afterEach')
                .map((h) => h.name)
                .join(', '),
            })}
          </span>
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="iteration-status">
            {rows.length > 1 ? t('runs.iterationResult') : t('runs.itemResult')}
          </Label>
          <NativeSelect
            id="iteration-status"
            value={state.status}
            onChange={(event) =>
              setIterations((all) =>
                all.map((iteration, index) =>
                  index === current
                    ? { ...iteration, status: event.target.value as FinalItemStatus }
                    : iteration,
                ),
              )
            }
          >
            <option value="">{t('runs.chooseResult')}</option>
            {FINAL_ITEM_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`runs.itemStatus.${status}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="notes">{t('runs.notes')}</Label>
          <Textarea
            id="notes"
            className="min-h-9"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>
      {missing >= 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('runs.missingResult', { number: missing + 1 })}
        </p>
      ) : null}
      <div>
        <Button type="submit" disabled={save.isPending || missing >= 0}>
          <Save /> {t('runs.saveResult')}
        </Button>
      </div>
    </form>
  );
}

function ItemDialog({
  orgSlug,
  appKey,
  run,
  itemId,
  onClose,
}: {
  orgSlug: string;
  appKey: string;
  run: Run;
  itemId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { canExecute, canUseAi } = useTestingAccess(orgSlug, appKey);
  const item = useQuery(runItemQuery(orgSlug, appKey, run.key, itemId));
  const [iterationIndex, setIterationIndex] = useState(0);
  const [fixing, setFixing] = useState(false);
  const open = run.status === 'queued' || run.status === 'running';
  const data = item.data;
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="max-h-[92vh] max-w-4xl overflow-y-auto"
        closeLabel={t('common.close')}
      >
        {data ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <Link
                  to="/o/$orgSlug/a/$appKey/test-cases/$testCaseKey"
                  params={{ orgSlug, appKey, testCaseKey: data.testCase.key }}
                  className="font-mono text-base hover:underline"
                >
                  {data.testCase.key}
                </Link>
                <span>{data.title}</span>
              </DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <ItemStatusBadge status={data.status} />
                <ModeBadge mode={data.executionMode} />
                <span>{t('testCases.version', { number: data.version })}</span>
                {data.durationMs !== null ? <span>{formatDuration(data.durationMs)}</span> : null}
                {data.executedBy ? (
                  <span>{t('runs.executedBy', { name: userName(data.executedBy) })}</span>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            {data.executionMode === 'automated' &&
            (data.status === 'failed' || data.status === 'blocked') &&
            canUseAi &&
            !data.testCase.deleted ? (
              <div>
                <Button variant="outline" onClick={() => setFixing(true)}>
                  <Sparkles /> {t('ai.fixWithAi')}
                </Button>
              </div>
            ) : null}
            {data.error && data.iterations.length === 0 ? (
              <Alert variant="destructive">{data.error}</Alert>
            ) : null}
            {data.executionMode === 'manual' && canExecute && open ? (
              <ManualRunner
                orgSlug={orgSlug}
                appKey={appKey}
                run={run}
                item={data}
                onSaved={onClose}
              />
            ) : data.iterations.length ? (
              <div className="grid gap-3">
                {data.iterations.length > 1 ? (
                  <div
                    role="group"
                    aria-label={t('runs.iterations')}
                    className="flex flex-wrap gap-1"
                  >
                    {data.iterations.map((iteration) => (
                      <Button
                        key={iteration.index}
                        size="sm"
                        aria-pressed={iterationIndex === iteration.index}
                        variant={iterationIndex === iteration.index ? 'default' : 'outline'}
                        onClick={() => setIterationIndex(iteration.index)}
                      >
                        {t('runs.iterationOption', { number: iteration.index + 1 })} ·{' '}
                        {t(`runs.itemStatus.${iteration.status}`)}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <IterationView
                  item={data}
                  iteration={data.iterations[iterationIndex] ?? data.iterations[0]!}
                />
                {data.notes ? (
                  <p className="text-sm">
                    <span className="font-medium">{t('runs.notes')}:</span> {data.notes}
                  </p>
                ) : null}
              </div>
            ) : (
              <StepsView steps={data.steps} />
            )}
            {fixing ? (
              <ReviseTestCaseDialog
                orgSlug={orgSlug}
                appKey={appKey}
                testCase={{ key: data.testCase.key, title: data.title, steps: data.steps }}
                failure={{ runKey: run.key, itemId: data.id }}
                open={fixing}
                onOpenChange={setFixing}
              />
            ) : null}
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{item.isError ? t('runs.items') : t('common.loading')}</DialogTitle>
            </DialogHeader>
            {item.isError ? (
              <Alert variant="destructive">{errorMessage(item.error)}</Alert>
            ) : (
              <Skeleton className="h-48" />
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

const ITEM_FILTERS: (RunItemStatus | 'all')[] = [
  'all',
  'failed',
  'blocked',
  'passed',
  'untested',
  'queued',
  'skipped',
];

export function RunPage({
  orgSlug,
  appKey,
  runKey,
  itemId,
}: {
  orgSlug: string;
  appKey: string;
  runKey: string;
  itemId?: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canExecute } = useTestingAccess(orgSlug, appKey);
  const run = useSuspenseQuery(runQuery(orgSlug, appKey, runKey)).data;
  const [filter, setFilter] = useState<RunItemStatus | 'all'>('all');
  const open = run.status === 'queued' || run.status === 'running';
  const setItem = (id: string | undefined) =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/runs/$runKey',
      params: { orgSlug, appKey, runKey },
      search: id ? { item: id } : {},
      replace: true,
    });
  const afterChange = async (updated: Run, message: string) => {
    queryClient.setQueryData(testKeys.run(orgSlug, appKey, runKey), updated);
    await invalidateRuns(orgSlug, appKey);
    toast.success(message);
  };
  const cancel = useMutation({
    mutationFn: () => api.post<Run>(`${runApi(orgSlug, appKey, runKey)}/cancel`),
    onSuccess: (updated) => afterChange(updated, t('runs.cancelled')),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const complete = useMutation({
    mutationFn: () => api.post<Run>(`${runApi(orgSlug, appKey, runKey)}/complete`),
    onSuccess: (updated) => afterChange(updated, t('runs.completedMessage')),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const rerun = useMutation({
    mutationFn: (scope: 'all' | 'failed') =>
      api.post<Run>(`${runApi(orgSlug, appKey, runKey)}/rerun`, { scope }),
    onSuccess: async (created) => {
      await invalidateRuns(orgSlug, appKey);
      toast.success(t('runs.started', { key: created.key }));
      await navigate({
        to: '/o/$orgSlug/a/$appKey/runs/$runKey',
        params: { orgSlug, appKey, runKey: created.key },
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const items = run.items.filter((item) => filter === 'all' || item.status === filter);
  const failedCount = run.counts.failed + run.counts.blocked;

  return (
    <>
      <nav aria-label={t('scenario.breadcrumb')} className="mb-2 text-sm text-muted-foreground">
        <Link
          to="/o/$orgSlug/a/$appKey/runs"
          params={{ orgSlug, appKey }}
          className="hover:underline"
        >
          {t('workspace.tabs.runs')}
        </Link>
      </nav>
      <PageHeader
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="key">{run.key}</Badge>
            <RunStatusBadge status={run.status} />
          </div>
        }
        title={run.title}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download /> {t('runs.export')} <ChevronDown aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <a href={`${runApi(orgSlug, appKey, runKey)}/report.json`} download>
                    {t('runs.exportJson')}
                  </a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={`${runApi(orgSlug, appKey, runKey)}/junit.xml`} download>
                    {t('runs.exportJunit')}
                  </a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canExecute && !open ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={rerun.isPending}>
                    <RotateCw /> {t('runs.rerun')} <ChevronDown aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => rerun.mutate('all')}>
                    {t('runs.rerunAll')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={failedCount === 0}
                    onSelect={() => rerun.mutate('failed')}
                  >
                    {t('runs.rerunFailed', { count: failedCount })}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canExecute && open && run.counts.queued + run.counts.running === 0 ? (
              <ConfirmButton
                variant="outline"
                destructive={false}
                title={t('runs.completeTitle')}
                description={t('runs.completeBody', { count: run.counts.untested })}
                confirmLabel={t('runs.complete')}
                onConfirm={() => complete.mutate()}
              >
                <Flag /> {t('runs.complete')}
              </ConfirmButton>
            ) : null}
            {canExecute && open ? (
              <ConfirmButton
                variant="ghost"
                title={t('runs.cancelTitle', { key: run.key })}
                description={t('runs.cancelBody')}
                confirmLabel={t('runs.cancel')}
                onConfirm={() => cancel.mutate()}
              >
                <CircleStop /> {t('runs.cancel')}
              </ConfirmButton>
            ) : null}
          </>
        }
      />
      {run.error ? (
        <Alert variant="destructive" className="mb-4">
          {run.error}
        </Alert>
      ) : null}
      <section aria-label={t('runs.summary')} className="mb-6 grid gap-4">
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label={t('runs.passRate')}
            value={formatPercent(run.passRate)}
            hint={t('runs.passRateHint', {
              passed: run.counts.passed,
              executed: run.counts.passed + run.counts.failed + run.counts.blocked,
            })}
          />
          <Stat
            label={t('runs.columns.duration')}
            value={formatDuration(run.durationMs)}
            hint={run.finishedAt ? formatDateTime(run.finishedAt) : t(`runs.status.${run.status}`)}
          />
          <Stat
            label={t('runs.failures')}
            value={failedCount}
            hint={t('runs.failuresHint', {
              failed: run.counts.failed,
              blocked: run.counts.blocked,
            })}
          />
          <Stat
            label={t('runs.items')}
            value={run.counts.total}
            hint={t('runs.pending', {
              count: run.counts.queued + run.counts.running + run.counts.untested,
            })}
          />
        </dl>
        <RunProgress counts={run.counts} />
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-muted-foreground">{t('runs.fields.baseUrl')}</dt>
            <dd className="break-all font-mono text-xs">{run.baseUrl ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('runs.fields.browser')}</dt>
            <dd>{t(`automation.browsers.${run.browser}`)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">{t('runs.startedBy')}</dt>
            <dd className="flex flex-wrap items-center gap-1">
              {userName(run.createdBy)} · <RelativeTime value={run.createdAt} />
            </dd>
          </div>
          {run.cancelledBy ? (
            <div>
              <dt className="text-xs text-muted-foreground">{t('runs.cancelledBy')}</dt>
              <dd>{userName(run.cancelledBy)}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {run.hookResults.length ? (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">{t('runs.globalSteps')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {run.hookResults.map((hook) => (
                <li key={`${hook.phase}-${hook.hookId}`} className="grid gap-1 text-sm">
                  <span className="flex flex-wrap items-center gap-2">
                    <ResultBadge status={hook.status} />
                    <span className="font-medium">{hook.name}</span>
                    <span className="text-muted-foreground">
                      {t(`automation.phases.${hook.phase}`)} · {formatDuration(hook.durationMs)}
                    </span>
                  </span>
                  {hook.error ? (
                    <span className="text-xs text-destructive">{hook.error}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {run.scenarios.length ? (
        <section aria-labelledby="run-scenarios" className="mb-6 grid gap-2">
          <h2 id="run-scenarios" className="text-base font-semibold">
            {t('runs.byScenario')}
          </h2>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('runs.scenario')}</TableHead>
                <TableHead className="w-56">{t('runs.columns.progress')}</TableHead>
                <TableHead className="text-right">{t('runs.columns.passRate')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {run.scenarios.map((entry) => (
                <TableRow key={entry.scenario.id}>
                  <TableCell>
                    <span className="font-mono text-xs">{entry.scenario.key}</span>{' '}
                    {entry.scenario.title}
                  </TableCell>
                  <TableCell>
                    <RunProgress counts={entry.counts} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(entry.passRate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section aria-labelledby="run-items" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="run-items" className="text-base font-semibold">
            {t('runs.testCases')}
          </h2>
          <div role="group" aria-label={t('runs.filterItems')} className="flex flex-wrap gap-1">
            {ITEM_FILTERS.map((status) => {
              const count = status === 'all' ? run.counts.total : run.counts[status];
              if (status !== 'all' && count === 0) return null;
              return (
                <Button
                  key={status}
                  size="sm"
                  variant={filter === status ? 'default' : 'outline'}
                  aria-pressed={filter === status}
                  onClick={() => setFilter(status)}
                >
                  {status === 'all' ? t('runs.all') : t(`runs.itemStatus.${status}`)} ({count})
                </Button>
              );
            })}
          </div>
        </div>
        <Table aria-label={t('runs.testCases')}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('testCases.columns.key')}</TableHead>
              <TableHead>{t('testCases.columns.title')}</TableHead>
              <TableHead>{t('runs.columns.status')}</TableHead>
              <TableHead>{t('testCases.columns.scenarios')}</TableHead>
              <TableHead>{t('runs.failure')}</TableHead>
              <TableHead className="text-right">{t('runs.columns.duration')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow
                key={item.id}
                className={cn(
                  'cursor-pointer',
                  (item.status === 'failed' || item.status === 'blocked') && 'bg-destructive/5',
                )}
                onClick={() => setItem(item.id)}
              >
                <TableCell className="font-mono text-xs">{item.testCase.key}</TableCell>
                <TableCell>
                  <button
                    type="button"
                    className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={(event) => {
                      event.stopPropagation();
                      setItem(item.id);
                    }}
                  >
                    {item.title}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <ModeBadge mode={item.executionMode} />
                    {item.iterationCount > 1 ? (
                      <Badge variant="muted">
                        {t('runs.iterationsCount', { count: item.iterationCount })}
                      </Badge>
                    ) : null}
                    {item.executionMode === 'manual' &&
                    item.status === 'untested' &&
                    canExecute &&
                    open ? (
                      <Badge>{t('runs.toExecute')}</Badge>
                    ) : null}
                  </div>
                </TableCell>
                <TableCell>
                  <ItemStatusBadge status={item.status} />
                </TableCell>
                <TableCell>
                  <ScenarioChips scenarios={item.scenarios} orgSlug={orgSlug} appKey={appKey} />
                </TableCell>
                <TableCell className="max-w-md">
                  {item.failedStep ? (
                    <p className="text-sm">
                      <span className="font-medium">
                        {t('runs.stepNumber', { number: item.failedStep.index + 1 })}
                      </span>{' '}
                      {item.failedStep.text}
                    </p>
                  ) : null}
                  {item.error ? (
                    <p className="line-clamp-2 text-xs text-destructive">
                      {item.error.split('\n')[0]}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(item.durationMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      {itemId ? (
        <ItemDialog
          orgSlug={orgSlug}
          appKey={appKey}
          run={run}
          itemId={itemId}
          onClose={() => setItem(undefined)}
        />
      ) : null}
    </>
  );
}
