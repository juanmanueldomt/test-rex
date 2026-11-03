import {
  createTestCaseSchema,
  formatTag,
  modeIssues,
  normalizeTag,
  tagSchema,
  TEST_CASE_PRIORITIES,
  TEST_CASE_STATUSES,
  updateTestCaseSchema,
  type ExecutionMode,
  type TestCase,
  type TestCaseConflictDetails,
  type TestCasePriority,
  type TestCaseStatus,
  type TestStep,
} from '@testrex/contracts';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
  Badge,
  Button,
  Combobox,
  Field,
  Input,
  NativeSelect,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { useBlocker, useNavigate } from '@tanstack/react-router';
import { Bot, Hand, Save, Video } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '../../components/common';
import { RichTextEditor } from '../../components/editor/RichText';
import { formatRelative } from '../../components/scenario-ui';
import { StepsEditor } from '../../components/steps';
import { api, errorMessage, isApiError } from '../../lib/api';
import i18n from '../../lib/i18n';
import {
  appApi,
  datasetsQuery,
  invalidateTestCases,
  scenarioListQuery,
  scenarioQuery,
  tagsQuery,
  testCaseApi,
  testCaseQuery,
  testKeys,
} from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import { useAttachmentResolver } from '../scenarios/common';
import { useTestingAccess } from './common';
import { RecorderDialog } from './RecorderDialog';

interface FormValues {
  title: string;
  status: TestCaseStatus;
  priority: TestCasePriority;
  executionMode: ExecutionMode;
  scenarioIds: string[];
  tags: string[];
  datasetId: string | null;
  description: string;
  preconditions: string;
  steps: TestStep[];
}

function valuesOf(testCase: TestCase): FormValues {
  return {
    title: testCase.title,
    status: testCase.status,
    priority: testCase.priority,
    executionMode: testCase.executionMode,
    scenarioIds: testCase.scenarios.map((s) => s.id),
    tags: testCase.tags,
    datasetId: testCase.dataset?.id ?? null,
    description: testCase.description,
    preconditions: testCase.preconditions,
    steps: testCase.steps,
  };
}

type Errors = Record<string, string>;

function errorsOf(issues: { path: string; message: string }[]): Errors {
  const errors: Errors = {};
  for (const issue of issues) {
    const path = issue.path.startsWith('steps.') ? issue.path : (issue.path.split('.')[0] ?? '');
    if (errors[path]) continue;
    const key = `validation.${issue.message}`;
    errors[path] = i18n.exists(key) ? i18n.t(key) : i18n.t('errors.generic');
  }
  return errors;
}

export function NewTestCasePage({
  orgSlug,
  appKey,
  scenarioKey,
}: {
  orgSlug: string;
  appKey: string;
  scenarioKey?: string;
}) {
  const scenario = useQuery({
    ...scenarioQuery(orgSlug, appKey, scenarioKey ?? ''),
    enabled: Boolean(scenarioKey),
  });
  if (scenarioKey && scenario.isPending) return null;
  return (
    <TestCaseForm
      orgSlug={orgSlug}
      appKey={appKey}
      initialScenario={
        scenario.data
          ? { id: scenario.data.id, key: scenario.data.key, title: scenario.data.title }
          : undefined
      }
    />
  );
}

export function EditTestCasePage({
  orgSlug,
  appKey,
  testCaseKey,
}: {
  orgSlug: string;
  appKey: string;
  testCaseKey: string;
}) {
  const { t } = useTranslation();
  const testCase = useSuspenseQuery(testCaseQuery(orgSlug, appKey, testCaseKey)).data;
  if (testCase.deletedAt) return <Alert variant="warning">{t('errors.TEST_CASE_DELETED')}</Alert>;
  return <TestCaseForm orgSlug={orgSlug} appKey={appKey} testCase={testCase} />;
}

function TestCaseForm({
  orgSlug,
  appKey,
  testCase,
  initialScenario,
}: {
  orgSlug: string;
  appKey: string;
  testCase?: TestCase;
  initialScenario?: { id: string; key: string; title: string };
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const ids = useId();
  const { canEdit } = useTestingAccess(orgSlug, appKey);
  const resolveImageSrc = useAttachmentResolver(orgSlug, appKey);
  const empty: FormValues = {
    title: '',
    status: 'draft',
    priority: 'medium',
    executionMode: 'automated',
    scenarioIds: initialScenario ? [initialScenario.id] : [],
    tags: [],
    datasetId: null,
    description: '',
    preconditions: '',
    steps: [],
  };
  const [initial, setInitial] = useState<FormValues>(() => (testCase ? valuesOf(testCase) : empty));
  const [values, setValues] = useState<FormValues>(initial);
  const [baseVersion, setBaseVersion] = useState(testCase?.version ?? 0);
  const [source, setSource] = useState<'editor' | 'recording'>('editor');
  const [errors, setErrors] = useState<Errors>({});
  const [conflict, setConflict] = useState<TestCaseConflictDetails | null>(null);
  const [recording, setRecording] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const leaving = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(field))),
    );
  };

  const scenarios = useQuery(scenarioListQuery(orgSlug, appKey, { size: 100 })).data?.items ?? [];
  const scenarioOptions = [
    ...scenarios.map((s) => ({ value: s.id, label: `${s.key} · ${s.title}` })),
    ...(testCase?.scenarios ?? [])
      .filter((link) => !scenarios.some((s) => s.id === link.id))
      .map((link) => ({ value: link.id, label: `${link.key} · ${link.title}` })),
    ...(initialScenario && !scenarios.some((s) => s.id === initialScenario.id)
      ? [{ value: initialScenario.id, label: `${initialScenario.key} · ${initialScenario.title}` }]
      : []),
  ];
  const datasets = useQuery(datasetsQuery(orgSlug, appKey)).data ?? [];
  const dataset = datasets.find((d) => d.id === values.datasetId);
  const [tagSearch, setTagSearch] = useState('');
  const suggestions = useQuery(tagsQuery(orgSlug, appKey, normalizeTag(tagSearch))).data ?? [];
  const tagOptions = [
    ...values.tags.map((tag) => ({ value: tag, label: formatTag(tag) })),
    ...suggestions
      .filter((tag) => !values.tags.includes(tag.name))
      .map((tag) => ({ value: tag.name, label: formatTag(tag.name) })),
  ];
  const addTag = (text: string) => {
    const parsed = tagSchema.safeParse(text);
    if (!parsed.success) {
      setErrors((current) => ({
        ...current,
        tags: t(`validation.${parsed.error.issues[0]?.message ?? 'tag.invalid'}`),
      }));
      return;
    }
    if (!values.tags.includes(parsed.data)) set('tags', [...values.tags, parsed.data]);
  };

  const save = useMutation({
    mutationFn: (payload: object) =>
      testCase
        ? api.patch<TestCase>(testCaseApi(orgSlug, appKey, testCase.key), payload)
        : api.post<TestCase>(`${appApi(orgSlug, appKey)}/test-cases`, payload),
    onSuccess: async (saved) => {
      queryClient.setQueryData(testKeys.testCase(orgSlug, appKey, saved.key), saved);
      await invalidateTestCases(orgSlug, appKey);
      if (testCase && saved.version === baseVersion) toast.info(t('form.noChanges'));
      else toast.success(testCase ? t('form.saved') : t('testCases.created', { key: saved.key }));
      leaving.current = true;
      setInitial(values);
      await navigate({
        to: '/o/$orgSlug/a/$appKey/test-cases/$testCaseKey',
        params: { orgSlug, appKey, testCaseKey: saved.key },
      });
    },
    onError: (error) => {
      if (isApiError(error, 409) && error.code === 'TEST_CASE_CHANGED') {
        setConflict(error.body as unknown as TestCaseConflictDetails);
        return;
      }
      if (isApiError(error, 400) && Array.isArray(error.body.issues)) {
        setErrors(errorsOf(error.body.issues as { path: string; message: string }[]));
        toast.error(t('errors.VALIDATION_FAILED'));
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (save.isPending) return;
    const payload = { ...values, source };
    const result = testCase
      ? updateTestCaseSchema.safeParse({ ...payload, baseVersion })
      : createTestCaseSchema.safeParse(payload);
    const issues = result.success
      ? []
      : result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
    if (testCase && result.success) {
      issues.push(
        ...modeIssues(values.executionMode, values.steps).map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
    if (issues.length) {
      setErrors(errorsOf(issues));
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    save.mutate(testCase ? { ...payload, baseVersion } : payload);
  };

  const cancel = () =>
    void navigate(
      testCase
        ? {
            to: '/o/$orgSlug/a/$appKey/test-cases/$testCaseKey',
            params: { orgSlug, appKey, testCaseKey: testCase.key },
          }
        : { to: '/o/$orgSlug/a/$appKey/test-cases', params: { orgSlug, appKey } },
    );

  useShortcut({
    keys: '$mod+s',
    description: t('shortcuts.save'),
    group: 'editing',
    allowInInputs: true,
    handler: () => submit(),
  });
  useShortcut({
    keys: 'Escape',
    description: t('shortcuts.cancel'),
    group: 'editing',
    enabled: !recording,
    handler: cancel,
  });
  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  const reloadLatest = async () => {
    if (!testCase) return;
    const latest = await queryClient.fetchQuery({
      ...testCaseQuery(orgSlug, appKey, testCase.key),
      staleTime: 0,
    });
    const next = valuesOf(latest);
    setInitial(next);
    setValues(next);
    setBaseVersion(latest.version);
    setEditorKey((key) => key + 1);
    setConflict(null);
  };

  if (!canEdit) return <Alert variant="warning">{t('errors.FORBIDDEN')}</Alert>;
  const id = (field: string) => `${ids}-${field}`;
  return (
    <>
      <PageHeader
        eyebrow={
          testCase ? (
            <div className="flex items-center gap-2">
              <Badge variant="key">{testCase.key}</Badge>
              <Badge variant="muted">{t('testCases.version', { number: baseVersion })}</Badge>
            </div>
          ) : undefined
        }
        title={testCase ? t('testCases.editTitle', { key: testCase.key }) : t('testCases.newTitle')}
      />
      <form
        onSubmit={submit}
        noValidate
        className="grid gap-6"
        aria-label={t('testCases.formLabel')}
      >
        <Field label={t('testCases.fields.title')} error={errors.title}>
          {(control) => (
            <Input
              {...control}
              value={values.title}
              maxLength={200}
              autoFocus={!testCase}
              onChange={(event) => set('title', event.target.value)}
            />
          )}
        </Field>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-medium">{t('testCases.fields.mode')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(['automated', 'manual'] as const).map((mode) => {
              const Icon = mode === 'automated' ? Bot : Hand;
              return (
                <label
                  key={mode}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/40 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name={id('mode')}
                    value={mode}
                    className="mt-1 size-4 accent-primary"
                    checked={values.executionMode === mode}
                    onChange={() => set('executionMode', mode)}
                  />
                  <span className="grid gap-0.5">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Icon className="size-4" aria-hidden />
                      {t(`testCases.mode.${mode}`)}
                      {mode === 'automated' ? (
                        <Badge variant="muted">{t('testCases.default')}</Badge>
                      ) : null}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {t(`testCases.modeHint.${mode}`)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field
            label={t('testCases.fields.scenarios')}
            hint={t('testCases.scenariosHint')}
            error={errors.scenarioIds}
            className="lg:col-span-2"
          >
            {(control) => (
              <Combobox
                {...control}
                label={t('testCases.fields.scenarios')}
                multiple
                options={scenarioOptions}
                value={values.scenarioIds}
                onChange={(selected) => set('scenarioIds', selected)}
                placeholder={t('testCases.scenariosPlaceholder')}
                searchPlaceholder={t('testCases.scenariosSearch')}
                emptyText={t('testCases.scenariosEmpty')}
              />
            )}
          </Field>
          <Field label={t('scenario.fields.status')}>
            {(control) => (
              <NativeSelect
                {...control}
                value={values.status}
                onChange={(event) => set('status', event.target.value as TestCaseStatus)}
              >
                {TEST_CASE_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {t(`scenario.status.${status}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('scenario.fields.priority')}>
            {(control) => (
              <NativeSelect
                {...control}
                value={values.priority}
                onChange={(event) => set('priority', event.target.value as TestCasePriority)}
              >
                {TEST_CASE_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`scenario.priority.${priority}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field
            label={t('scenario.fields.tags')}
            hint={t('form.tagsHint')}
            error={errors.tags}
            className="lg:col-span-2"
          >
            {(control) => (
              <Combobox
                {...control}
                label={t('scenario.fields.tags')}
                multiple
                options={tagOptions}
                value={values.tags}
                onChange={(tags) => set('tags', tags)}
                search={tagSearch}
                onSearchChange={setTagSearch}
                onCreate={addTag}
                createLabel={(text) => t('form.tagCreate', { tag: formatTag(normalizeTag(text)) })}
                placeholder={t('form.tagsPlaceholder')}
                searchPlaceholder={t('form.tagsSearch')}
                emptyText={t('form.tagsEmpty')}
              />
            )}
          </Field>
          <Field
            label={t('testCases.fields.dataset')}
            hint={
              dataset
                ? t('testCases.datasetHint', { count: dataset.rowCount })
                : t('testCases.noDatasetHint')
            }
            error={errors.datasetId}
            className="lg:col-span-2"
          >
            {(control) => (
              <NativeSelect
                {...control}
                value={values.datasetId ?? ''}
                onChange={(event) => set('datasetId', event.target.value || null)}
              >
                <option value="">{t('testCases.noDataset')}</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({t('datasets.rows', { count: d.rowCount })})
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>

        {(['description', 'preconditions'] as const).map((field) => (
          <div key={field} className="grid gap-1.5">
            <span id={id(`${field}-label`)} className="text-sm font-medium">
              {t(`testCases.fields.${field}`)}
            </span>
            <RichTextEditor
              key={`${field}-${editorKey}`}
              labelledBy={id(`${field}-label`)}
              label={t(`testCases.fields.${field}`)}
              invalid={Boolean(errors[field])}
              value={values[field]}
              onChange={(markdown) => set(field, markdown)}
              placeholder={t(`testCases.${field}Placeholder`)}
              resolveImageSrc={resolveImageSrc}
            />
          </div>
        ))}

        <section aria-labelledby={id('steps')} className="grid gap-3">
          <div>
            <h2 id={id('steps')} className="text-sm font-medium">
              {t('testCases.fields.steps')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {values.executionMode === 'automated'
                ? t('testCases.stepsHintAutomated')
                : t('testCases.stepsHintManual')}
            </p>
          </div>
          {errors.steps ? (
            <p role="alert" className="text-sm text-destructive">
              {errors.steps}
            </p>
          ) : null}
          <StepsEditor
            label={t('testCases.fields.steps')}
            steps={values.steps}
            onChange={(steps) => set('steps', steps)}
            allowManual={values.executionMode === 'manual'}
            errors={errors}
            variables={dataset?.columns}
            toolbar={
              <Button type="button" variant="outline" size="sm" onClick={() => setRecording(true)}>
                <Video /> {t('recorder.open')}
              </Button>
            }
          />
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={save.isPending}>
            <Save />
            {save.isPending
              ? t('common.saving')
              : testCase
                ? t('form.save')
                : t('testCases.create')}
          </Button>
          <Button type="button" variant="ghost" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('form.saveHint')}</span>
        </div>
      </form>

      <RecorderDialog
        orgSlug={orgSlug}
        appKey={appKey}
        open={recording}
        onOpenChange={setRecording}
        hasSteps={values.steps.length > 0}
        onApply={(steps, mode) => {
          set('steps', mode === 'replace' ? steps : [...values.steps, ...steps]);
          setSource('recording');
          setRecording(false);
          toast.success(t('recorder.applied', { count: steps.length }));
        }}
      />

      <AlertDialog open={blocker.status === 'blocked'}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('form.unsavedTitle')}</AlertDialogTitle>
          <AlertDialogDescription>{t('form.unsavedBody')}</AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel onClick={() => blocker.reset?.()}>
              {t('form.keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction destructive onClick={() => blocker.proceed?.()}>
              {t('form.discard')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflict !== null}>
        <AlertDialogContent>
          <AlertDialogTitle>{t('testCases.conflictTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {conflict
              ? t('testCases.conflictBody', {
                  name: conflict.changedBy,
                  version: conflict.latestVersion,
                  when: formatRelative(conflict.changedAt),
                })
              : null}
          </AlertDialogDescription>
          <div className="flex flex-wrap justify-end gap-2">
            <AlertDialogCancel onClick={() => setConflict(null)}>
              {t('form.conflictKeep')}
            </AlertDialogCancel>
            <AlertDialogAction destructive onClick={() => void reloadLatest()}>
              {t('form.conflictReload')}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
