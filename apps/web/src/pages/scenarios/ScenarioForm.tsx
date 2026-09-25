import {
  createScenarioSchema,
  formatTag,
  normalizeTag,
  productVersionSchema,
  SCENARIO_PRIORITIES,
  SCENARIO_STATUSES,
  tagSchema,
  updateScenarioSchema,
  type Scenario,
  type ScenarioConflictDetails,
  type ScenarioModule,
  type ScenarioPriority,
  type ScenarioStatus,
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
import { Link, useBlocker, useNavigate } from '@tanstack/react-router';
import { ExternalLink, Save } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PageHeader } from '../../components/common';
import { RichTextEditor } from '../../components/editor/RichText';
import { formatRelative } from '../../components/scenario-ui';
import { api, errorMessage, isApiError } from '../../lib/api';
import {
  appApi,
  invalidateScenarios,
  keys,
  modulesQuery,
  scenarioApi,
  scenarioQuery,
  tagsQuery,
} from '../../lib/queries';
import { useShortcut } from '../../lib/shortcuts';
import type { FieldErrors } from '../../lib/validation';
import i18n from '../../lib/i18n';
import { useImageUpload } from './attachments';
import { useAttachmentResolver, useScenarioAccess } from './common';

interface FormValues {
  title: string;
  status: ScenarioStatus;
  priority: ScenarioPriority;
  moduleId: string | null;
  tags: string[];
  versionFrom: string;
  versionTo: string;
  description: string;
  stepsToReach: string;
}

const EMPTY: FormValues = {
  title: '',
  status: 'draft',
  priority: 'medium',
  moduleId: null,
  tags: [],
  versionFrom: '',
  versionTo: '',
  description: '',
  stepsToReach: '',
};

function valuesOf(scenario: Scenario): FormValues {
  return {
    title: scenario.title,
    status: scenario.status,
    priority: scenario.priority,
    moduleId: scenario.module?.id ?? null,
    tags: scenario.tags,
    versionFrom: scenario.versionFrom ?? '',
    versionTo: scenario.versionTo ?? '',
    description: scenario.description,
    stepsToReach: scenario.stepsToReach,
  };
}

/** Field errors from a validation issue list (`tags.3` → `tags`). */
function fieldErrorsOf(issues: { path: string; message: string }[]): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const field = issue.path.split('.')[0] ?? '';
    if (errors[field]) continue;
    const key = `validation.${issue.message}`;
    errors[field] = i18n.exists(key) ? i18n.t(key) : i18n.t('errors.generic');
  }
  return errors;
}

export function NewScenarioPage({ orgSlug, appKey }: { orgSlug: string; appKey: string }) {
  return <ScenarioForm orgSlug={orgSlug} appKey={appKey} />;
}

export function EditScenarioPage({
  orgSlug,
  appKey,
  scenarioKey,
}: {
  orgSlug: string;
  appKey: string;
  scenarioKey: string;
}) {
  const { t } = useTranslation();
  const scenario = useSuspenseQuery(scenarioQuery(orgSlug, appKey, scenarioKey)).data;
  if (scenario.deletedAt) {
    return <Alert variant="warning">{t('errors.SCENARIO_DELETED')}</Alert>;
  }
  return <ScenarioForm orgSlug={orgSlug} appKey={appKey} scenario={scenario} />;
}

function ScenarioForm({
  orgSlug,
  appKey,
  scenario,
}: {
  orgSlug: string;
  appKey: string;
  scenario?: Scenario;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canWrite } = useScenarioAccess(orgSlug, appKey);
  const ids = useId();
  const resolveImageSrc = useAttachmentResolver(orgSlug, appKey);
  const uploadImage = useImageUpload(orgSlug, appKey, scenario?.key);

  const [initial, setInitial] = useState<FormValues>(() => (scenario ? valuesOf(scenario) : EMPTY));
  const [values, setValues] = useState<FormValues>(initial);
  const [baseRevision, setBaseRevision] = useState(scenario?.revision ?? 0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [conflict, setConflict] = useState<ScenarioConflictDetails | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const leaving = useRef(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(initial);
  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _removed, ...rest }) => rest);
  };

  const modules = useQuery(modulesQuery(orgSlug, appKey)).data ?? [];
  const moduleOptions = [
    ...modules.map((m) => ({ value: m.id, label: m.name })),
    // A module deleted since the scenario was saved is still shown as its current value.
    ...(scenario?.module && !modules.some((m) => m.id === scenario.module!.id)
      ? [{ value: scenario.module.id, label: scenario.module.name }]
      : []),
  ];
  const [tagSearch, setTagSearch] = useState('');
  const suggestions = useQuery(tagsQuery(orgSlug, appKey, normalizeTag(tagSearch))).data ?? [];
  const tagOptions = [
    ...values.tags.map((tag) => ({ value: tag, label: formatTag(tag) })),
    ...suggestions
      .filter((tag) => !values.tags.includes(tag.name))
      .map((tag) => ({ value: tag.name, label: formatTag(tag.name) })),
  ];

  const createModule = async (name: string) => {
    try {
      const created = await api.post<ScenarioModule>(`${appApi(orgSlug, appKey)}/modules`, {
        name,
      });
      queryClient.setQueryData(keys.modules(orgSlug, appKey), (current: ScenarioModule[] = []) => [
        ...current,
        created,
      ]);
      set('moduleId', created.id);
      toast.success(t('form.moduleCreated', { name: created.name }));
    } catch (error) {
      if (isApiError(error, 409) && error.code === 'MODULE_EXISTS') {
        const existing = error.body.existing as { id: string; name: string } | null;
        if (existing) set('moduleId', existing.id);
        toast.info(t('form.moduleExists', { name: existing?.name ?? name }));
        return;
      }
      toast.error(errorMessage(error));
    }
  };

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

  const checkVersion = (field: 'versionFrom' | 'versionTo') => {
    const text = values[field].trim();
    if (text && !productVersionSchema.safeParse(text).success) {
      setErrors((current) => ({ ...current, [field]: t('validation.version.invalid') }));
    }
  };

  const save = useMutation({
    mutationFn: (payload: object) =>
      scenario
        ? api.patch<Scenario>(scenarioApi(orgSlug, appKey, scenario.key), payload)
        : api.post<Scenario>(`${appApi(orgSlug, appKey)}/scenarios`, payload),
    onSuccess: async (saved) => {
      queryClient.setQueryData(keys.scenario(orgSlug, appKey, saved.key), saved);
      await invalidateScenarios(orgSlug, appKey);
      if (scenario && saved.revision === baseRevision) {
        toast.info(t('form.noChanges'));
      } else {
        toast.success(scenario ? t('form.saved') : t('form.created', { key: saved.key }));
      }
      leaving.current = true;
      setInitial(values);
      await navigate({
        to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey',
        params: { orgSlug, appKey, scenarioKey: saved.key },
      });
    },
    onError: (error) => {
      if (isApiError(error, 409) && error.code === 'SCENARIO_CHANGED') {
        setConflict(error.body as unknown as ScenarioConflictDetails);
        return;
      }
      if (isApiError(error, 400) && Array.isArray(error.body.issues)) {
        setErrors(fieldErrorsOf(error.body.issues as { path: string; message: string }[]));
        toast.error(t('errors.VALIDATION_FAILED'));
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (save.isPending) return;
    const payload = {
      ...values,
      versionFrom: values.versionFrom.trim() || null,
      versionTo: values.versionTo.trim() || null,
    };
    // The same rules as the API (shared schemas), checked before sending.
    const result = scenario
      ? updateScenarioSchema.safeParse({ ...payload, baseRevision })
      : createScenarioSchema.safeParse(payload);
    if (!result.success) {
      const issues = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      setErrors(fieldErrorsOf(issues));
      // Move focus to the first invalid field once it is marked.
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>('form [aria-invalid="true"]')?.focus(),
      );
      return;
    }
    save.mutate(scenario ? { ...payload, baseRevision } : payload);
  };

  const cancel = () =>
    void navigate(
      scenario
        ? {
            to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey',
            params: { orgSlug, appKey, scenarioKey: scenario.key },
          }
        : { to: '/o/$orgSlug/a/$appKey/scenarios', params: { orgSlug, appKey } },
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
    handler: cancel,
  });

  const blocker = useBlocker({
    shouldBlockFn: () => dirty && !leaving.current,
    enableBeforeUnload: () => dirty && !leaving.current,
    withResolver: true,
  });

  const reloadLatest = async () => {
    if (!scenario) return;
    const latest = await queryClient.fetchQuery({
      ...scenarioQuery(orgSlug, appKey, scenario.key),
      staleTime: 0,
    });
    const next = valuesOf(latest);
    setInitial(next);
    setValues(next);
    setBaseRevision(latest.revision);
    setEditorKey((key) => key + 1);
    setConflict(null);
  };

  if (!canWrite) return <Alert variant="warning">{t('errors.FORBIDDEN')}</Alert>;

  const id = (field: string) => `${ids}-${field}`;
  return (
    <>
      <PageHeader
        eyebrow={
          scenario ? (
            <div className="flex items-center gap-2">
              <Badge variant="key">{scenario.key}</Badge>
              <Badge variant="muted">{t('scenario.revision', { number: baseRevision })}</Badge>
            </div>
          ) : undefined
        }
        title={scenario ? t('form.editTitle', { key: scenario.key }) : t('form.newTitle')}
      />
      <form onSubmit={submit} noValidate className="grid gap-6" aria-label={t('form.label')}>
        <Field label={t('scenario.fields.title')} error={errors.title}>
          {(control) => (
            <Input
              {...control}
              value={values.title}
              maxLength={200}
              autoFocus={!scenario}
              onChange={(event) => set('title', event.target.value)}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('scenario.fields.status')}>
            {(control) => (
              <NativeSelect
                {...control}
                value={values.status}
                onChange={(event) => set('status', event.target.value as ScenarioStatus)}
              >
                {SCENARIO_STATUSES.map((status) => (
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
                onChange={(event) => set('priority', event.target.value as ScenarioPriority)}
              >
                {SCENARIO_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`scenario.priority.${priority}`)}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field label={t('scenario.fields.module')} error={errors.moduleId}>
            {(control) => (
              <Combobox
                {...control}
                label={t('scenario.fields.module')}
                options={moduleOptions}
                value={values.moduleId ? [values.moduleId] : []}
                onChange={(selected) => set('moduleId', selected[0] ?? null)}
                onCreate={createModule}
                createLabel={(name) => t('form.moduleCreate', { name })}
                placeholder={t('form.moduleNone')}
                searchPlaceholder={t('form.moduleSearch')}
                emptyText={t('form.moduleEmpty')}
              />
            )}
          </Field>
          <Field label={t('scenario.fields.tags')} hint={t('form.tagsHint')} error={errors.tags}>
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
        </div>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-medium">{t('scenario.fields.versionRange')}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {(['versionFrom', 'versionTo'] as const).map((field) => (
              <Field
                key={field}
                label={t(`scenario.fields.${field}`)}
                hint={t('form.versionHint')}
                error={errors[field]}
              >
                {(control) => (
                  <Input
                    {...control}
                    value={values[field]}
                    inputMode="decimal"
                    placeholder={field === 'versionFrom' ? '2.4' : '3.10'}
                    onChange={(event) => set(field, event.target.value)}
                    onBlur={() => checkVersion(field)}
                    className="font-mono"
                  />
                )}
              </Field>
            ))}
          </div>
        </fieldset>

        {(['description', 'stepsToReach'] as const).map((field) => (
          <div key={field} className="grid gap-1.5">
            <span id={id(`${field}-label`)} className="text-sm font-medium">
              {t(`scenario.fields.${field}`)}
            </span>
            <RichTextEditor
              key={`${field}-${editorKey}`}
              labelledBy={id(`${field}-label`)}
              label={t(`scenario.fields.${field}`)}
              describedBy={errors[field] ? id(`${field}-error`) : undefined}
              invalid={Boolean(errors[field])}
              value={values[field]}
              onChange={(markdown) => set(field, markdown)}
              placeholder={t(`scenario.${field}Placeholder`)}
              resolveImageSrc={resolveImageSrc}
              onUploadImage={uploadImage}
            />
            {errors[field] ? (
              <p id={id(`${field}-error`)} role="alert" className="text-sm text-destructive">
                {errors[field]}
              </p>
            ) : null}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 border-t pt-4">
          <Button type="submit" disabled={save.isPending}>
            <Save />
            {save.isPending ? t('common.saving') : scenario ? t('form.save') : t('form.create')}
          </Button>
          <Button type="button" variant="ghost" onClick={cancel}>
            {t('common.cancel')}
          </Button>
          <span className="text-xs text-muted-foreground">{t('form.saveHint')}</span>
        </div>
      </form>

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
          <AlertDialogTitle>{t('form.conflictTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {conflict
              ? t('form.conflictBody', {
                  name: conflict.changedBy,
                  revision: conflict.latestRevision,
                  when: formatRelative(conflict.changedAt),
                })
              : null}
          </AlertDialogDescription>
          {conflict && scenario ? (
            <Link
              to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey/compare"
              params={{ orgSlug, appKey, scenarioKey: scenario.key }}
              search={{ from: baseRevision, to: conflict.latestRevision }}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-sm text-primary underline underline-offset-2"
            >
              {t('form.conflictCompare', { base: baseRevision, latest: conflict.latestRevision })}
              <ExternalLink className="size-3.5" aria-hidden />
            </Link>
          ) : null}
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
