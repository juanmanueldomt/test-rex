import {
  BROWSERS,
  compactRunListQuery,
  parseRunListQueryLenient,
  RUN_STATUSES,
  type Browser,
  type ExecutionMode,
  type Run,
  type RunCounts,
  type RunListQuery,
  type RunStatus,
} from '@testrex/contracts';
import {
  Alert,
  Button,
  Combobox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
  Pagination,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@testrex/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { PlayCircle, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RelativeTime, userName } from '../../components/scenario-ui';
import { api, errorMessage, isApiError } from '../../lib/api';
import i18n from '../../lib/i18n';
import {
  appApi,
  automationQuery,
  invalidateRuns,
  runListQuery,
  scenarioListQuery,
  testCaseListQuery,
} from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import {
  formatDuration,
  formatPercent,
  RunStatusBadge,
  useTestingAccess,
} from '../test-cases/common';

export type RunSearch = Partial<Record<string, string | number | boolean>>;

export function validateRunSearch(raw: Record<string, unknown>): RunSearch {
  return compactRunListQuery(parseRunListQueryLenient(raw));
}

/** Same validated colors and neighbors as the report chart: green and red never touch. */
const SEGMENTS: { status: keyof RunCounts; color: string }[] = [
  { status: 'passed', color: 'var(--chart-passed)' },
  { status: 'blocked', color: 'var(--chart-blocked)' },
  { status: 'skipped', color: 'var(--chart-skipped)' },
  { status: 'failed', color: 'var(--chart-failed)' },
  { status: 'running', color: 'var(--chart-pending)' },
  { status: 'queued', color: 'var(--chart-pending)' },
  { status: 'untested', color: 'var(--chart-pending)' },
];

/** Stacked progress of a run's items; the numbers are also given as text. */
export function RunProgress({ counts, className }: { counts: RunCounts; className?: string }) {
  const { t } = useTranslation();
  const summary = SEGMENTS.filter((s) => counts[s.status] > 0)
    .map((s) => `${t(`runs.itemStatus.${s.status}`)}: ${counts[s.status]}`)
    .join(', ');
  return (
    <div className={cn('grid gap-1', className)}>
      <div
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={summary}
      >
        {SEGMENTS.map((segment) =>
          counts[segment.status] > 0 ? (
            <span
              key={segment.status}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                flexGrow: counts[segment.status],
                flexBasis: 0,
                background: segment.color,
              }}
            />
          ) : null,
        )}
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {t('runs.progress', {
          done: counts.passed + counts.failed + counts.blocked + counts.skipped,
          total: counts.total,
        })}
      </span>
    </div>
  );
}

/** Starts a run for a selection of scenarios and test cases. */
export function NewRunDialog({
  orgSlug,
  appKey,
  open,
  onOpenChange,
  initial,
}: {
  orgSlug: string;
  appKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: { scenarioIds?: string[]; testCaseIds?: string[] };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const settings = useQuery(automationQuery(orgSlug, appKey)).data;
  const scenarios = useQuery(scenarioListQuery(orgSlug, appKey, { size: 100 })).data?.items ?? [];
  const [caseSearch, setCaseSearch] = useState('');
  const cases =
    useQuery(testCaseListQuery(orgSlug, appKey, { q: caseSearch || undefined, size: 50 })).data
      ?.items ?? [];
  const [title, setTitle] = useState('');
  const [scenarioIds, setScenarioIds] = useState<string[]>(initial?.scenarioIds ?? []);
  const [testCaseIds, setTestCaseIds] = useState<string[]>(initial?.testCaseIds ?? []);
  const [selectedCases, setSelectedCases] = useState<{ value: string; label: string }[]>([]);
  const [modes, setModes] = useState<ExecutionMode[]>(['automated', 'manual']);
  const [baseUrl, setBaseUrl] = useState('');
  const [browser, setBrowser] = useState<Browser | ''>('');
  const [error, setError] = useState<string | null>(null);
  const caseOptions = [
    ...selectedCases,
    ...cases
      .filter((item) => !selectedCases.some((s) => s.value === item.id))
      .map((item) => ({ value: item.id, label: `${item.key} · ${item.title}` })),
  ];
  const create = useMutation({
    mutationFn: () =>
      api.post<Run>(`${appApi(orgSlug, appKey)}/runs`, {
        title,
        scenarioIds,
        testCaseIds,
        modes,
        ...(baseUrl ? { baseUrl } : {}),
        ...(browser ? { browser } : {}),
      }),
    onSuccess: async (run) => {
      await invalidateRuns(orgSlug, appKey);
      onOpenChange(false);
      toast.success(t('runs.started', { key: run.key }));
      await navigate({
        to: '/o/$orgSlug/a/$appKey/runs/$runKey',
        params: { orgSlug, appKey, runKey: run.key },
      });
    },
    onError: (failure) => {
      if (isApiError(failure, 400) && Array.isArray(failure.body.issues)) {
        const issue = (failure.body.issues as { message: string }[])[0];
        const key = `validation.${issue?.message}`;
        setError(i18n.exists(key) ? t(key) : errorMessage(failure));
        return;
      }
      setError(errorMessage(failure));
    },
  });
  const toggleMode = (mode: ExecutionMode, on: boolean) =>
    setModes((current) =>
      on ? [...new Set([...current, mode])] : current.filter((m) => m !== mode),
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('runs.newTitle')}</DialogTitle>
          <DialogDescription>{t('runs.newBody')}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create.mutate();
          }}
        >
          <Field label={t('runs.fields.title')} hint={t('runs.titleHint')}>
            {(control) => (
              <Input
                {...control}
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('runs.fields.scenarios')} hint={t('runs.scenariosHint')}>
            {(control) => (
              <Combobox
                {...control}
                label={t('runs.fields.scenarios')}
                multiple
                options={scenarios.map((s) => ({
                  value: s.id,
                  label: `${s.key} · ${s.title} (${s.testCaseCount})`,
                }))}
                value={scenarioIds}
                onChange={setScenarioIds}
                placeholder={t('runs.chooseScenarios')}
                searchPlaceholder={t('testCases.scenariosSearch')}
                emptyText={t('testCases.scenariosEmpty')}
              />
            )}
          </Field>
          <Field label={t('runs.fields.testCases')}>
            {(control) => (
              <Combobox
                {...control}
                label={t('runs.fields.testCases')}
                multiple
                options={caseOptions}
                value={testCaseIds}
                onChange={(values) => {
                  setTestCaseIds(values);
                  setSelectedCases(caseOptions.filter((option) => values.includes(option.value)));
                }}
                search={caseSearch}
                onSearchChange={setCaseSearch}
                placeholder={t('runs.chooseTestCases')}
                searchPlaceholder={t('testCases.searchPlaceholder')}
                emptyText={t('testCases.noMatches')}
              />
            )}
          </Field>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">{t('runs.fields.modes')}</legend>
            <div className="flex gap-4">
              {(['automated', 'manual'] as const).map((mode) => (
                <label key={mode} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={modes.includes(mode)}
                    onChange={(event) => toggleMode(mode, event.target.checked)}
                  />
                  {t(`testCases.mode.${mode}`)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={t('runs.fields.baseUrl')}
              hint={t('runs.baseUrlHint', { url: settings?.baseUrl ?? t('runs.notSet') })}
            >
              {(control) => (
                <Input
                  {...control}
                  type="url"
                  value={baseUrl}
                  placeholder={settings?.baseUrl ?? 'https://staging.example.com'}
                  onChange={(e) => setBaseUrl(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('runs.fields.browser')}>
              {(control) => (
                <NativeSelect
                  {...control}
                  value={browser}
                  onChange={(e) => setBrowser(e.target.value as Browser | '')}
                >
                  <option value="">
                    {t('runs.defaultBrowser', { browser: settings?.browser ?? 'chromium' })}
                  </option>
                  {BROWSERS.map((name) => (
                    <option key={name} value={name}>
                      {t(`automation.browsers.${name}`)}
                    </option>
                  ))}
                </NativeSelect>
              )}
            </Field>
          </div>
          {error ? <Alert variant="destructive">{error}</Alert> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                create.isPending ||
                modes.length === 0 ||
                scenarioIds.length + testCaseIds.length === 0
              }
            >
              <PlayCircle /> {t('runs.start')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RunsPage({
  orgSlug,
  appKey,
  search,
}: {
  orgSlug: string;
  appKey: string;
  search: RunSearch;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canExecute } = useTestingAccess(orgSlug, appKey);
  const query = useMemo(() => parseRunListQueryLenient(search), [search]);
  const list = useQuery(runListQuery(orgSlug, appKey, query));
  const [creating, setCreating] = useState(false);
  const setView = (patch: Partial<RunListQuery>) => {
    const next = { ...query, ...patch };
    if (!('page' in patch)) next.page = 1;
    void navigate({
      to: '/o/$orgSlug/a/$appKey/runs',
      params: { orgSlug, appKey },
      search: compactRunListQuery(next),
    });
  };
  useShortcut({
    keys: 'c',
    description: t('shortcuts.newRun'),
    group: 'runs',
    enabled: canExecute,
    handler: () => setCreating(true),
  });
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / query.size));
  return (
    <section aria-labelledby="runs-heading" className="grid gap-4">
      <h2 id="runs-heading" className="sr-only">
        {t('workspace.tabs.runs')}
      </h2>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            className="w-64"
            aria-label={t('runs.searchLabel')}
            placeholder={t('runs.searchPlaceholder')}
            defaultValue={query.q ?? ''}
            onKeyDown={(event) => {
              if (event.key === 'Enter')
                setView({ q: event.currentTarget.value.trim() || undefined });
            }}
          />
          <NativeSelect
            className="h-9 w-auto"
            aria-label={t('runs.statusFilter')}
            value={query.status?.[0] ?? ''}
            onChange={(event) =>
              setView({
                status: event.target.value ? [event.target.value as RunStatus] : undefined,
              })
            }
          >
            <option value="">{t('runs.anyStatus')}</option>
            {RUN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`runs.status.${status}`)}
              </option>
            ))}
          </NativeSelect>
        </div>
        {canExecute ? (
          <Button onClick={() => setCreating(true)}>
            <Plus /> {t('runs.new')}
          </Button>
        ) : null}
      </div>
      {list.isPending ? (
        <Skeleton className="h-48" />
      ) : list.isError ? (
        <Alert variant="destructive">{errorMessage(list.error)}</Alert>
      ) : total === 0 ? (
        <EmptyState
          icon={<PlayCircle />}
          title={t('runs.emptyTitle')}
          description={t('runs.emptyBody')}
          action={
            canExecute ? (
              <Button onClick={() => setCreating(true)}>
                <Plus /> {t('runs.new')}
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <Table aria-label={t('runs.gridLabel')}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('runs.columns.key')}</TableHead>
                <TableHead>{t('runs.columns.title')}</TableHead>
                <TableHead>{t('runs.columns.status')}</TableHead>
                <TableHead className="w-56">{t('runs.columns.progress')}</TableHead>
                <TableHead className="text-right">{t('runs.columns.passRate')}</TableHead>
                <TableHead className="text-right">{t('runs.columns.duration')}</TableHead>
                <TableHead>{t('runs.columns.started')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link
                      to="/o/$orgSlug/a/$appKey/runs/$runKey"
                      params={{ orgSlug, appKey, runKey: run.key }}
                      className="font-mono text-xs font-medium hover:underline"
                    >
                      {run.key}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      to="/o/$orgSlug/a/$appKey/runs/$runKey"
                      params={{ orgSlug, appKey, runKey: run.key }}
                      className="font-medium hover:underline"
                    >
                      {run.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>
                    <RunProgress counts={run.counts} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(run.passRate)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatDuration(run.durationMs)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1 text-sm">
                      {userName(run.createdBy)} · <RelativeTime value={run.createdAt} />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            className="justify-self-end"
            page={list.data.page}
            pageCount={pageCount}
            onPageChange={(page) => setView({ page })}
            label={t('scenarios.pagination')}
            previousLabel={t('scenarios.previousPage')}
            nextLabel={t('scenarios.nextPage')}
            pageLabel={(n) => t('scenarios.page', { page: n })}
          />
        </>
      )}
      {creating ? (
        <NewRunDialog
          orgSlug={orgSlug}
          appKey={appKey}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </section>
  );
}
