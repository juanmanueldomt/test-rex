import {
  BROWSERS,
  formatCsv,
  globalStepInputSchema,
  HOOK_PHASES,
  parseCsv,
  type AutomationSettings,
  type AutomationSettingsView,
  type Browser,
  type Dataset,
  type GlobalStep,
  type HookPhase,
  type TestStep,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  NativeSelect,
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
  Textarea,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowUp,
  Database,
  Download,
  Pencil,
  Plus,
  Save,
  Trash2,
  Upload,
  Workflow,
} from 'lucide-react';
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader } from '../../components/common';
import { RelativeTime, userName } from '../../components/scenario-ui';
import { StepsEditor, StepsView } from '../../components/steps';
import { api, errorMessage, isApiError } from '../../lib/api';
import i18n from '../../lib/i18n';
import {
  appApi,
  automationQuery,
  datasetQuery,
  datasetsQuery,
  globalStepsQuery,
  testKeys,
} from '../../lib/queries';
import { useTestingAccess } from '../test-cases/common';

export type AutomationTab = 'settings' | 'global-steps' | 'datasets';
export const AUTOMATION_TABS: readonly AutomationTab[] = ['settings', 'global-steps', 'datasets'];

function issuesToErrors(issues: { path: string; message: string }[]) {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = `validation.${issue.message}`;
    if (!errors[issue.path])
      errors[issue.path] = i18n.exists(key) ? i18n.t(key) : i18n.t('errors.generic');
  }
  return errors;
}

function SettingsSection({
  orgSlug,
  appKey,
  canEdit,
}: {
  orgSlug: string;
  appKey: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const current = useSuspenseQuery(automationQuery(orgSlug, appKey)).data;
  const [values, setValues] = useState(current);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const settings: AutomationSettings = {
        baseUrl: values.baseUrl,
        browser: values.browser,
        viewportWidth: values.viewportWidth,
        viewportHeight: values.viewportHeight,
        actionTimeoutMs: values.actionTimeoutMs,
        navigationTimeoutMs: values.navigationTimeoutMs,
        assertionTimeoutMs: values.assertionTimeoutMs,
        traceOnFailure: values.traceOnFailure,
        videoOnFailure: values.videoOnFailure,
      };
      return api.put<AutomationSettingsView>(`${appApi(orgSlug, appKey)}/automation`, settings);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(testKeys.automation(orgSlug, appKey), saved);
      setValues(saved);
      setErrors({});
      toast.success(t('automation.saved'));
    },
    onError: (error) => {
      if (isApiError(error, 400) && Array.isArray(error.body.issues)) {
        setErrors(issuesToErrors(error.body.issues as { path: string; message: string }[]));
        return;
      }
      toast.error(errorMessage(error));
    },
  });
  const number = (field: keyof AutomationSettingsView) => (event: ChangeEvent<HTMLInputElement>) =>
    setValues(
      (v) =>
        ({
          ...v,
          [field]: event.target.value === '' ? '' : Number(event.target.value),
        }) as typeof v,
    );
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid max-w-3xl gap-6">
      <Field
        label={t('automation.baseUrl')}
        hint={t('automation.baseUrlHint')}
        error={errors.baseUrl}
      >
        {(control) => (
          <Input
            {...control}
            type="url"
            disabled={!canEdit}
            value={values.baseUrl ?? ''}
            placeholder="https://staging.example.com"
            onChange={(event) => setValues((v) => ({ ...v, baseUrl: event.target.value || null }))}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('automation.browser')}>
          {(control) => (
            <NativeSelect
              {...control}
              disabled={!canEdit}
              value={values.browser}
              onChange={(event) =>
                setValues((v) => ({ ...v, browser: event.target.value as Browser }))
              }
            >
              {BROWSERS.map((browser) => (
                <option key={browser} value={browser}>
                  {t(`automation.browsers.${browser}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field label={t('automation.viewportWidth')} error={errors.viewportWidth}>
          {(control) => (
            <Input
              {...control}
              type="number"
              disabled={!canEdit}
              value={values.viewportWidth}
              onChange={number('viewportWidth')}
            />
          )}
        </Field>
        <Field label={t('automation.viewportHeight')} error={errors.viewportHeight}>
          {(control) => (
            <Input
              {...control}
              type="number"
              disabled={!canEdit}
              value={values.viewportHeight}
              onChange={number('viewportHeight')}
            />
          )}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label={t('automation.actionTimeout')}
          hint={t('automation.msHint')}
          error={errors.actionTimeoutMs}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              disabled={!canEdit}
              value={values.actionTimeoutMs}
              onChange={number('actionTimeoutMs')}
            />
          )}
        </Field>
        <Field
          label={t('automation.navigationTimeout')}
          hint={t('automation.msHint')}
          error={errors.navigationTimeoutMs}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              disabled={!canEdit}
              value={values.navigationTimeoutMs}
              onChange={number('navigationTimeoutMs')}
            />
          )}
        </Field>
        <Field
          label={t('automation.assertionTimeout')}
          hint={t('automation.assertionHint')}
          error={errors.assertionTimeoutMs}
        >
          {(control) => (
            <Input
              {...control}
              type="number"
              disabled={!canEdit}
              value={values.assertionTimeoutMs}
              onChange={number('assertionTimeoutMs')}
            />
          )}
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{t('automation.artifacts')}</legend>
        {(['traceOnFailure', 'videoOnFailure'] as const).map((field) => (
          <label key={field} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              disabled={!canEdit}
              checked={values[field]}
              onChange={(event) => setValues((v) => ({ ...v, [field]: event.target.checked }))}
            />
            {t(`automation.${field}`)}
          </label>
        ))}
      </fieldset>
      {current.updatedAt ? (
        <p className="text-xs text-muted-foreground">
          {t('automation.lastChange', { name: userName(current.updatedBy) })}{' '}
          <RelativeTime value={current.updatedAt} />
        </p>
      ) : null}
      {canEdit ? (
        <div>
          <Button type="submit" disabled={save.isPending}>
            <Save /> {t('common.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function GlobalStepDialog({
  orgSlug,
  appKey,
  phase,
  existing,
  onClose,
}: {
  orgSlug: string;
  appKey: string;
  phase: HookPhase;
  existing: GlobalStep | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(existing?.name ?? '');
  const [steps, setSteps] = useState<TestStep[]>(existing?.steps ?? []);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.patch<GlobalStep>(`${appApi(orgSlug, appKey)}/global-steps/${existing.id}`, {
            name,
            steps,
          })
        : api.post<GlobalStep>(`${appApi(orgSlug, appKey)}/global-steps`, { name, phase, steps }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testKeys.automation(orgSlug, appKey) });
      toast.success(t('automation.globalStepSaved'));
      onClose();
    },
    onError: (error) => {
      if (isApiError(error, 400) && Array.isArray(error.body.issues)) {
        setErrors(issuesToErrors(error.body.issues as { path: string; message: string }[]));
        return;
      }
      toast.error(errorMessage(error));
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const result = globalStepInputSchema.safeParse({ name, phase, steps });
    if (!result.success) {
      setErrors(
        issuesToErrors(
          result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
      return;
    }
    save.mutate();
  };
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92vh] max-w-5xl overflow-y-auto"
        closeLabel={t('common.close')}
      >
        <DialogHeader>
          <DialogTitle>
            {existing ? t('automation.editGlobalStep') : t('automation.newGlobalStep')} ·{' '}
            {t(`automation.phases.${phase}`)}
          </DialogTitle>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <Field label={t('automation.globalStepName')} error={errors.name}>
            {(control) => (
              <Input
                {...control}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </Field>
          {errors.steps ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.steps}
            </p>
          ) : null}
          <StepsEditor
            label={t('testCases.fields.steps')}
            steps={steps}
            onChange={setSteps}
            allowManual={false}
            errors={errors}
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={save.isPending}>
              <Save /> {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GlobalStepsSection({
  orgSlug,
  appKey,
  canEdit,
}: {
  orgSlug: string;
  appKey: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const steps = useQuery(globalStepsQuery(orgSlug, appKey));
  const [editing, setEditing] = useState<{ phase: HookPhase; existing: GlobalStep | null } | null>(
    null,
  );
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: testKeys.automation(orgSlug, appKey) });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: object }) =>
      api.patch(`${appApi(orgSlug, appKey)}/global-steps/${id}`, body),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${appApi(orgSlug, appKey)}/global-steps/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.success(t('automation.globalStepDeleted'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (steps.isPending) return <Skeleton className="h-64" />;
  if (steps.isError) return <Alert variant="destructive">{errorMessage(steps.error)}</Alert>;
  return (
    <div className="grid gap-6">
      <p className="max-w-3xl text-sm text-muted-foreground">{t('automation.globalStepsIntro')}</p>
      {HOOK_PHASES.map((phase) => {
        const list = steps.data.filter((step) => step.phase === phase);
        return (
          <Card key={phase}>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
              <div className="grid gap-1">
                <CardTitle className="text-base">{t(`automation.phases.${phase}`)}</CardTitle>
                <CardDescription>{t(`automation.phaseHints.${phase}`)}</CardDescription>
              </div>
              {canEdit ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setEditing({ phase, existing: null })}
                >
                  <Plus /> {t('automation.addGlobalStep')}
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-3">
              {list.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('automation.noGlobalSteps')}</p>
              ) : (
                list.map((step, index) => (
                  <section
                    key={step.id}
                    aria-label={step.name}
                    className="grid gap-2 rounded-lg border p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{step.name}</span>
                      {step.enabled ? null : (
                        <Badge variant="muted">{t('automation.disabled')}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t('automation.stepCount', { count: step.steps.length })}
                      </span>
                      {canEdit ? (
                        <div className="ml-auto flex items-center gap-1">
                          <label className="mr-2 flex items-center gap-1.5 text-xs">
                            <input
                              type="checkbox"
                              className="size-4 accent-primary"
                              checked={step.enabled}
                              onChange={(event) =>
                                update.mutate({
                                  id: step.id,
                                  body: { enabled: event.target.checked },
                                })
                              }
                            />
                            {t('automation.enabled')}
                          </label>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t('steps.moveUp', { number: index + 1 })}
                            disabled={index === 0}
                            onClick={() =>
                              update.mutate({ id: step.id, body: { position: index - 1 } })
                            }
                          >
                            <ArrowUp />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t('steps.moveDown', { number: index + 1 })}
                            disabled={index === list.length - 1}
                            onClick={() =>
                              update.mutate({ id: step.id, body: { position: index + 1 } })
                            }
                          >
                            <ArrowDown />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={t('automation.editNamed', { name: step.name })}
                            onClick={() => setEditing({ phase, existing: step })}
                          >
                            <Pencil />
                          </Button>
                          <ConfirmButton
                            size="icon"
                            variant="ghost"
                            aria-label={t('automation.deleteNamed', { name: step.name })}
                            title={t('automation.deleteGlobalStepTitle', { name: step.name })}
                            confirmLabel={t('scenario.delete')}
                            onConfirm={() => remove.mutate(step.id)}
                          >
                            <Trash2 />
                          </ConfirmButton>
                        </div>
                      ) : null}
                    </div>
                    <StepsView steps={step.steps} />
                  </section>
                ))
              )}
            </CardContent>
          </Card>
        );
      })}
      {editing ? (
        <GlobalStepDialog
          orgSlug={orgSlug}
          appKey={appKey}
          phase={editing.phase}
          existing={editing.existing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function DatasetsSection({
  orgSlug,
  appKey,
  canEdit,
}: {
  orgSlug: string;
  appKey: string;
  canEdit: boolean;
}) {
  const { t } = useTranslation();
  const datasets = useQuery(datasetsQuery(orgSlug, appKey));
  if (datasets.isPending) return <Skeleton className="h-40" />;
  if (datasets.isError) return <Alert variant="destructive">{errorMessage(datasets.error)}</Alert>;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-muted-foreground">{t('datasets.intro')}</p>
        {canEdit ? (
          <Button asChild>
            <Link
              to="/o/$orgSlug/a/$appKey/automation/datasets/$datasetId"
              params={{ orgSlug, appKey, datasetId: 'new' }}
            >
              <Plus /> {t('datasets.new')}
            </Link>
          </Button>
        ) : null}
      </div>
      {datasets.data.length === 0 ? (
        <EmptyState
          icon={<Database />}
          title={t('datasets.emptyTitle')}
          description={t('datasets.emptyBody')}
        />
      ) : (
        <Table aria-label={t('datasets.title')}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('datasets.name')}</TableHead>
              <TableHead>{t('datasets.columns')}</TableHead>
              <TableHead className="text-right">{t('datasets.rowsColumn')}</TableHead>
              <TableHead className="text-right">{t('datasets.usedBy')}</TableHead>
              <TableHead>{t('scenario.lastUpdate')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {datasets.data.map((dataset) => (
              <TableRow key={dataset.id}>
                <TableCell>
                  <Link
                    to="/o/$orgSlug/a/$appKey/automation/datasets/$datasetId"
                    params={{ orgSlug, appKey, datasetId: dataset.id }}
                    className="font-medium hover:underline"
                  >
                    {dataset.name}
                  </Link>
                  {dataset.description ? (
                    <p className="text-xs text-muted-foreground">{dataset.description}</p>
                  ) : null}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {dataset.columns.map((column) => (
                      <code
                        key={column}
                        className="rounded bg-muted px-1 font-mono text-xs"
                      >{`{{${column}}}`}</code>
                    ))}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{dataset.rowCount}</TableCell>
                <TableCell className="text-right tabular-nums">{dataset.testCaseCount}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1 text-sm">
                    {userName(dataset.updatedBy)} · <RelativeTime value={dataset.updatedAt} />
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

export function AutomationPage({
  orgSlug,
  appKey,
  tab,
}: {
  orgSlug: string;
  appKey: string;
  tab: AutomationTab;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canEdit } = useTestingAccess(orgSlug, appKey);
  return (
    <Tabs
      value={tab}
      onValueChange={(value) =>
        void navigate({
          to: '/o/$orgSlug/a/$appKey/automation',
          params: { orgSlug, appKey },
          search: value === 'settings' ? {} : { tab: value as AutomationTab },
          replace: true,
        })
      }
    >
      <TabsList>
        <TabsTrigger value="settings">{t('automation.tabs.settings')}</TabsTrigger>
        <TabsTrigger value="global-steps">
          <Workflow aria-hidden /> {t('automation.tabs.globalSteps')}
        </TabsTrigger>
        <TabsTrigger value="datasets">
          <Database aria-hidden /> {t('automation.tabs.datasets')}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="settings">
        <SettingsSection orgSlug={orgSlug} appKey={appKey} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="global-steps">
        <GlobalStepsSection orgSlug={orgSlug} appKey={appKey} canEdit={canEdit} />
      </TabsContent>
      <TabsContent value="datasets">
        <DatasetsSection orgSlug={orgSlug} appKey={appKey} canEdit={canEdit} />
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------------------------------------
// Dataset editor
// ---------------------------------------------------------------------------------------------

export function DatasetPage({
  orgSlug,
  appKey,
  datasetId,
}: {
  orgSlug: string;
  appKey: string;
  datasetId: string;
}) {
  const existing = useQuery({
    ...datasetQuery(orgSlug, appKey, datasetId),
    enabled: datasetId !== 'new',
  });
  if (datasetId !== 'new' && existing.isPending) return <Skeleton className="h-96" />;
  if (existing.isError) return <Alert variant="destructive">{errorMessage(existing.error)}</Alert>;
  return <DatasetEditor orgSlug={orgSlug} appKey={appKey} dataset={existing.data ?? null} />;
}

function DatasetEditor({
  orgSlug,
  appKey,
  dataset,
}: {
  orgSlug: string;
  appKey: string;
  dataset: Dataset | null;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canEdit } = useTestingAccess(orgSlug, appKey);
  const [name, setName] = useState(dataset?.name ?? '');
  const [description, setDescription] = useState(dataset?.description ?? '');
  const [columns, setColumns] = useState<string[]>(dataset?.columns ?? ['value']);
  const [rows, setRows] = useState<string[][]>(dataset?.rows ?? [['']]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const back = () =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/automation',
      params: { orgSlug, appKey },
      search: { tab: 'datasets' },
    });
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, columns, rows };
      return dataset
        ? api.put<Dataset>(`${appApi(orgSlug, appKey)}/datasets/${dataset.id}`, body)
        : api.post<Dataset>(`${appApi(orgSlug, appKey)}/datasets`, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testKeys.datasets(orgSlug, appKey) });
      toast.success(t('datasets.saved'));
      back();
    },
    onError: (error) => {
      if (isApiError(error, 400) && Array.isArray(error.body.issues)) {
        setErrors(issuesToErrors(error.body.issues as { path: string; message: string }[]));
        return;
      }
      toast.error(errorMessage(error));
    },
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`${appApi(orgSlug, appKey)}/datasets/${dataset!.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: testKeys.datasets(orgSlug, appKey) });
      toast.success(t('datasets.deleted'));
      back();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const importCsv = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const parsed = parseCsv(await file.text());
    if (parsed.columns.length === 0) {
      toast.error(t('datasets.csvEmpty'));
      return;
    }
    setColumns(parsed.columns);
    setRows(parsed.rows);
    toast.success(t('datasets.csvImported', { count: parsed.rows.length }));
  };
  const exportCsv = () => {
    const url = URL.createObjectURL(new Blob([formatCsv(columns, rows)], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name || 'dataset'}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const setCell = (row: number, column: number, value: string) =>
    setRows((current) =>
      current.map((r, i) => (i === row ? r.map((c, j) => (j === column ? value : c)) : r)),
    );
  return (
    <>
      <nav aria-label={t('scenario.breadcrumb')} className="mb-2 text-sm text-muted-foreground">
        <Link
          to="/o/$orgSlug/a/$appKey/automation"
          params={{ orgSlug, appKey }}
          search={{ tab: 'datasets' }}
          className="hover:underline"
        >
          {t('automation.tabs.datasets')}
        </Link>
      </nav>
      <PageHeader
        title={dataset ? dataset.name : t('datasets.new')}
        description={
          dataset
            ? t('datasets.usedByCount', { count: dataset.testCaseCount })
            : t('datasets.newBody')
        }
      />
      <form
        className="grid gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('datasets.name')} error={errors.name}>
            {(control) => (
              <Input
                {...control}
                disabled={!canEdit}
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            )}
          </Field>
          <Field label={t('datasets.description')} error={errors.description}>
            {(control) => (
              <Textarea
                {...control}
                disabled={!canEdit}
                className="min-h-9"
                rows={1}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            )}
          </Field>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setColumns((c) => [...c, `column${c.length + 1}`]);
                setRows((r) => r.map((row) => [...row, '']));
              }}
            >
              <Plus /> {t('datasets.addColumn')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRows((r) => [...r, columns.map(() => '')])}
            >
              <Plus /> {t('datasets.addRow')}
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <label className="cursor-pointer">
                <Upload /> {t('datasets.importCsv')}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(event) => void importCsv(event)}
                />
              </label>
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={exportCsv}>
              <Download /> {t('datasets.exportCsv')}
            </Button>
          </div>
        ) : null}
        {Object.keys(errors).filter((key) => key.startsWith('columns') || key.startsWith('rows'))
          .length ? (
          <Alert variant="destructive" className="grid gap-1">
            {Object.entries(errors)
              .filter(([key]) => key.startsWith('columns') || key.startsWith('rows'))
              .map(([key, message]) => (
                <span key={key}>
                  {key}: {message}
                </span>
              ))}
          </Alert>
        ) : null}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th scope="col" className="w-12 px-2 py-2 text-left text-xs text-muted-foreground">
                  #
                </th>
                {columns.map((column, index) => (
                  <th key={index} scope="col" className="min-w-40 px-2 py-2 text-left">
                    <div className="flex items-center gap-1">
                      <Input
                        aria-label={t('datasets.columnName', { number: index + 1 })}
                        className="h-8 font-mono text-xs"
                        disabled={!canEdit}
                        aria-invalid={Boolean(errors[`columns.${index}`])}
                        value={column}
                        onChange={(event) =>
                          setColumns((c) =>
                            c.map((name, i) => (i === index ? event.target.value : name)),
                          )
                        }
                      />
                      {canEdit && columns.length > 1 ? (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={t('datasets.removeColumn', { name: column })}
                          onClick={() => {
                            setColumns((c) => c.filter((_, i) => i !== index));
                            setRows((r) => r.map((row) => row.filter((_, i) => i !== index)));
                          }}
                        >
                          <Trash2 />
                        </Button>
                      ) : null}
                    </div>
                  </th>
                ))}
                <th scope="col" className="w-12">
                  <span className="sr-only">{t('history.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-t">
                  <td className="px-2 py-1 text-xs tabular-nums text-muted-foreground">
                    {rowIndex + 1}
                  </td>
                  {row.map((cell, columnIndex) => (
                    <td key={columnIndex} className="px-2 py-1">
                      <Input
                        aria-label={t('datasets.cell', {
                          row: rowIndex + 1,
                          column: columns[columnIndex] ?? '',
                        })}
                        className="h-8"
                        disabled={!canEdit}
                        value={cell}
                        onChange={(event) => setCell(rowIndex, columnIndex, event.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-1">
                    {canEdit ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={t('datasets.removeRow', { number: rowIndex + 1 })}
                        onClick={() => setRows((r) => r.filter((_, i) => i !== rowIndex))}
                      >
                        <Trash2 />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('datasets.iterationsHint', { count: rows.length })}
        </p>
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button type="submit" disabled={save.isPending}>
              <Save /> {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={back}>
              {t('common.cancel')}
            </Button>
            {dataset ? (
              <ConfirmButton
                className="ml-auto"
                variant="ghost"
                title={t('datasets.deleteTitle', { name: dataset.name })}
                description={t('datasets.deleteBody')}
                confirmLabel={t('scenario.delete')}
                onConfirm={() => remove.mutate()}
              >
                <Trash2 /> {t('scenario.delete')}
              </ConfirmButton>
            ) : null}
          </div>
        ) : null}
      </form>
    </>
  );
}
