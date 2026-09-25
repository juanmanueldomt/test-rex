import {
  formatTag,
  RICH_TEXT_FIELDS,
  type Scenario,
  type ScenarioField,
  type ScenarioRevision,
  type ScenarioRevisionSummary,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  NativeSelect,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { GitCompare, History, RotateCcw } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton, PageHeader } from '../../components/common';
import { TextDiff } from '../../components/diff';
import { MarkdownView } from '../../components/editor/RichText';
import {
  formatRelative,
  PriorityLabel,
  RelativeTime,
  StatusBadge,
  TagChip,
  userName,
} from '../../components/scenario-ui';
import { api, errorMessage, isApiError } from '../../lib/api';
import {
  invalidateScenarios,
  keys,
  revisionQuery,
  revisionsQuery,
  scenarioApi,
  scenarioQuery,
} from '../../lib/queries';
import { useAttachmentResolver, useScenarioAccess } from './common';

type Scope = { orgSlug: string; appKey: string; scenarioKey: string };

/** Display text of a scalar field value in the history and comparison. */
function useFieldValue() {
  const { t } = useTranslation();
  return (field: ScenarioField, value: unknown): string => {
    if (value === null || value === undefined || value === '') return t('history.none');
    if (field === 'status') return t(`scenario.status.${value as string}`);
    if (field === 'priority') return t(`scenario.priority.${value as string}`);
    if (field === 'tags') {
      const tags = value as string[];
      return tags.length ? tags.map(formatTag).join(', ') : t('history.none');
    }
    if (typeof value === 'object' && value && 'name' in value) return String(value.name);
    return String(value);
  };
}

/** "status: Draft → Ready; description changed" */
function ChangeSummary({ revision }: { revision: ScenarioRevisionSummary }) {
  const { t } = useTranslation();
  const display = useFieldValue();
  if (revision.number === 1) return <>{t('history.created')}</>;
  const parts = revision.changedFields.map((field) => {
    const label = t(`scenario.fields.${field}`);
    const change = revision.changes[field];
    if (RICH_TEXT_FIELDS.includes(field) || !change) return t('history.changed', { field: label });
    return t('history.change', {
      field: label,
      from: display(field, change.from),
      to: display(field, change.to),
    });
  });
  return (
    <>
      {revision.restoredFrom ? (
        <span className="font-medium">
          {t('history.restoredFrom', { number: revision.restoredFrom })}
          {parts.length ? ': ' : ''}
        </span>
      ) : null}
      {parts.join('; ')}
    </>
  );
}

export function HistoryTab({ orgSlug, appKey, scenarioKey, current }: Scope & { current: number }) {
  const { t } = useTranslation();
  const revisions = useQuery(revisionsQuery(orgSlug, appKey, scenarioKey));
  if (revisions.isPending) return <Skeleton className="h-40" />;
  if (revisions.isError)
    return <Alert variant="destructive">{errorMessage(revisions.error)}</Alert>;
  return (
    <ol className="grid gap-2" aria-label={t('history.title')}>
      {revisions.data.map((revision) => (
        <li
          key={revision.id}
          className="flex flex-wrap items-start gap-x-3 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm"
        >
          <Badge variant={revision.number === current ? 'default' : 'muted'} className="font-mono">
            {t('scenario.revision', { number: revision.number })}
          </Badge>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <p>
              <ChangeSummary revision={revision} />
            </p>
            <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {userName(revision.author)} · <RelativeTime value={revision.createdAt} />
              {revision.number === current ? ` · ${t('history.current')}` : ''}
            </p>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link
                to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey/revisions/$number"
                params={{ orgSlug, appKey, scenarioKey, number: String(revision.number) }}
              >
                {t('history.view', { number: revision.number })}
              </Link>
            </Button>
            {revision.number > 1 ? (
              <Button variant="ghost" size="sm" asChild>
                <Link
                  to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey/compare"
                  params={{ orgSlug, appKey, scenarioKey }}
                  search={{ from: revision.number - 1, to: revision.number }}
                  aria-label={t('history.compareWith', {
                    from: revision.number - 1,
                    to: revision.number,
                  })}
                >
                  <GitCompare /> {t('history.compare')}
                </Link>
              </Button>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Breadcrumb({ orgSlug, appKey, scenarioKey }: Scope) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('scenario.breadcrumb')} className="mb-2 text-sm text-muted-foreground">
      <Link
        to="/o/$orgSlug/a/$appKey/scenarios"
        params={{ orgSlug, appKey }}
        className="hover:underline"
      >
        {t('workspace.tabs.scenarios')}
      </Link>
      <span aria-hidden> / </span>
      <Link
        to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
        params={{ orgSlug, appKey, scenarioKey }}
        className="font-mono hover:underline"
      >
        {scenarioKey}
      </Link>
    </nav>
  );
}

export { Breadcrumb as ScenarioBreadcrumb };

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** Revisioned fields of a scenario or revision (the side column of both pages). */
export function ScenarioProperties({
  value,
  extra,
}: {
  value: Pick<
    Scenario | ScenarioRevision,
    'status' | 'priority' | 'module' | 'tags' | 'versionFrom' | 'versionTo'
  >;
  extra?: ReactNode;
}) {
  const { t } = useTranslation();
  const range =
    value.versionFrom && value.versionTo
      ? t('scenario.fromTo', { from: value.versionFrom, to: value.versionTo })
      : value.versionFrom
        ? t('scenario.from', { version: value.versionFrom })
        : value.versionTo
          ? t('scenario.upTo', { version: value.versionTo })
          : t('scenario.anyVersion');
  return (
    <dl className="grid gap-4">
      <Property label={t('scenario.fields.status')}>
        <StatusBadge status={value.status} />
      </Property>
      <Property label={t('scenario.fields.priority')}>
        <PriorityLabel priority={value.priority} />
      </Property>
      <Property label={t('scenario.fields.module')}>
        {value.module?.name ?? (
          <span className="text-muted-foreground">{t('scenario.noModule')}</span>
        )}
      </Property>
      <Property label={t('scenario.fields.tags')}>
        {value.tags.length ? (
          <span className="flex flex-wrap gap-1">
            {value.tags.map((tag) => (
              <TagChip key={tag} tag={tag} />
            ))}
          </span>
        ) : (
          <span className="text-muted-foreground">{t('scenario.noTags')}</span>
        )}
      </Property>
      <Property label={t('scenario.fields.versionRange')}>
        <span className="font-mono text-xs">{range}</span>
      </Property>
      {extra}
    </dl>
  );
}

export function RichTextSections({
  description,
  stepsToReach,
  resolveImageSrc,
}: {
  description: string;
  stepsToReach: string;
  resolveImageSrc: (src: string) => string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <section aria-labelledby="description-heading" className="grid gap-2">
        <h2 id="description-heading" className="text-base font-semibold">
          {t('scenario.fields.description')}
        </h2>
        <MarkdownView
          markdown={description}
          resolveImageSrc={resolveImageSrc}
          emptyText={t('scenario.noDescription')}
        />
      </section>
      <section aria-labelledby="steps-heading" className="grid gap-2">
        <h2 id="steps-heading" className="text-base font-semibold">
          {t('scenario.fields.stepsToReach')}
        </h2>
        <MarkdownView
          markdown={stepsToReach}
          resolveImageSrc={resolveImageSrc}
          emptyText={t('scenario.noSteps')}
        />
      </section>
    </>
  );
}

export function RevisionPage({ orgSlug, appKey, scenarioKey, number }: Scope & { number: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canWrite } = useScenarioAccess(orgSlug, appKey);
  const resolveImageSrc = useAttachmentResolver(orgSlug, appKey);
  const scenario = useSuspenseQuery(scenarioQuery(orgSlug, appKey, scenarioKey)).data;
  const revision = useQuery(revisionQuery(orgSlug, appKey, scenarioKey, number));

  const restore = useMutation({
    mutationFn: () =>
      api.post<Scenario>(
        `${scenarioApi(orgSlug, appKey, scenarioKey)}/revisions/${number}/restore`,
        {
          baseRevision: scenario.revision,
        },
      ),
    onSuccess: async (saved) => {
      queryClient.setQueryData(keys.scenario(orgSlug, appKey, scenarioKey), saved);
      await invalidateScenarios(orgSlug, appKey);
      toast.success(t('revision.restored', { number, revision: saved.revision }));
      await navigate({
        to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey',
        params: { orgSlug, appKey, scenarioKey },
        search: { tab: 'history' },
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (revision.isPending) return <Skeleton className="h-64" />;
  if (revision.isError) {
    return (
      <>
        <Breadcrumb orgSlug={orgSlug} appKey={appKey} scenarioKey={scenarioKey} />
        <EmptyState
          icon={<History />}
          title={
            isApiError(revision.error, 404) ? t('revision.notFound') : errorMessage(revision.error)
          }
          action={
            <Button variant="outline" asChild>
              <Link
                to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
                params={{ orgSlug, appKey, scenarioKey }}
                search={{ tab: 'history' }}
              >
                {t('revision.backToHistory')}
              </Link>
            </Button>
          }
        />
      </>
    );
  }
  const data = revision.data;
  const isCurrent = data.number === scenario.revision;
  return (
    <>
      <Breadcrumb orgSlug={orgSlug} appKey={appKey} scenarioKey={scenarioKey} />
      <Alert variant={isCurrent ? 'info' : 'warning'} className="mb-6 flex-wrap items-center">
        <History aria-hidden />
        <span className="flex-1">
          {t('revision.banner', {
            number: data.number,
            latest: scenario.revision,
            when: formatRelative(data.createdAt),
            name: userName(data.author),
          })}
          {isCurrent ? ` ${t('revision.isCurrent')}` : ''}
        </span>
        {!isCurrent ? (
          <Button size="sm" variant="outline" asChild>
            <Link
              to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
              params={{ orgSlug, appKey, scenarioKey }}
            >
              {t('revision.openCurrent')}
            </Link>
          </Button>
        ) : null}
        {!isCurrent && canWrite && !scenario.deletedAt ? (
          <ConfirmButton
            size="sm"
            destructive={false}
            title={t('revision.restoreTitle', { number: data.number })}
            description={t('revision.restoreBody', { number: data.number })}
            confirmLabel={t('revision.restore')}
            onConfirm={() => restore.mutate()}
            disabled={restore.isPending}
          >
            <RotateCcw /> {t('revision.restore')}
          </ConfirmButton>
        ) : null}
      </Alert>
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <Badge variant="key">{data.scenarioKey}</Badge>
            <Badge variant="muted">{t('scenario.revision', { number: data.number })}</Badge>
          </div>
        }
        title={data.title}
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="grid content-start gap-8">
          <RichTextSections
            description={data.description}
            stepsToReach={data.stepsToReach}
            resolveImageSrc={resolveImageSrc}
          />
        </div>
        <aside aria-label={t('scenario.properties')}>
          <ScenarioProperties value={data} />
        </aside>
      </div>
    </>
  );
}

const COMPARED_FIELDS: ScenarioField[] = [
  'title',
  'status',
  'priority',
  'module',
  'tags',
  'versionFrom',
  'versionTo',
];

function fieldValue(revision: ScenarioRevision, field: ScenarioField): unknown {
  return field === 'module' ? revision.module : revision[field as keyof ScenarioRevision];
}

export function ComparePage({
  orgSlug,
  appKey,
  scenarioKey,
  from,
  to,
}: Scope & { from?: number; to?: number }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const display = useFieldValue();
  const scenario = useSuspenseQuery(scenarioQuery(orgSlug, appKey, scenarioKey)).data;
  const latest = scenario.revision;
  const toNumber = Math.min(to ?? latest, latest);
  const fromNumber = Math.max(1, Math.min(from ?? toNumber - 1, latest));
  const left = useQuery(revisionQuery(orgSlug, appKey, scenarioKey, fromNumber));
  const right = useQuery(revisionQuery(orgSlug, appKey, scenarioKey, toNumber));
  const numbers = Array.from({ length: latest }, (_, i) => latest - i);
  const setRange = (next: { from: number; to: number }) =>
    void navigate({
      to: '/o/$orgSlug/a/$appKey/scenarios/$scenarioKey/compare',
      params: { orgSlug, appKey, scenarioKey },
      search: next,
      replace: true,
    });

  let content: ReactNode;
  if (left.isPending || right.isPending) {
    content = <Skeleton className="h-64" />;
  } else if (left.isError || right.isError) {
    content = <Alert variant="destructive">{t('revision.notFound')}</Alert>;
  } else {
    const a = left.data;
    const b = right.data;
    const fields = COMPARED_FIELDS.filter(
      (field) => JSON.stringify(fieldValue(a, field)) !== JSON.stringify(fieldValue(b, field)),
    );
    const texts = RICH_TEXT_FIELDS.filter(
      (field) => a[field as 'description'] !== b[field as 'description'],
    );
    content =
      fields.length === 0 && texts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('compare.identical')}</p>
      ) : (
        <div className="grid gap-8">
          {fields.length ? (
            <section aria-labelledby="compare-fields" className="grid gap-2">
              <h2 id="compare-fields" className="text-base font-semibold">
                {t('compare.fields')}
              </h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('compare.field')}</TableHead>
                    <TableHead>{t('scenario.revision', { number: a.number })}</TableHead>
                    <TableHead>{t('scenario.revision', { number: b.number })}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field) => (
                    <TableRow key={field}>
                      <TableCell className="font-medium">{t(`scenario.fields.${field}`)}</TableCell>
                      <TableCell>
                        <del className="decoration-destructive">
                          <span className="sr-only">{t('compare.removed')}: </span>
                          {display(field, fieldValue(a, field))}
                        </del>
                      </TableCell>
                      <TableCell>
                        <ins className="no-underline">
                          <span className="sr-only">{t('compare.added')}: </span>
                          {display(field, fieldValue(b, field))}
                        </ins>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </section>
          ) : null}
          {texts.map((field) => (
            <section key={field} className="grid gap-2" aria-labelledby={`compare-${field}`}>
              <h2 id={`compare-${field}`} className="text-base font-semibold">
                {t(`scenario.fields.${field}`)}
              </h2>
              <TextDiff
                label={t(`scenario.fields.${field}`)}
                before={a[field as 'description']}
                after={b[field as 'description']}
              />
            </section>
          ))}
        </div>
      );
  }

  return (
    <>
      <Breadcrumb orgSlug={orgSlug} appKey={appKey} scenarioKey={scenarioKey} />
      <PageHeader title={t('compare.title', { key: scenario.key })} />
      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="grid gap-1 text-sm font-medium">
          {t('compare.from')}
          <NativeSelect
            className="w-28"
            value={fromNumber}
            onChange={(event) => setRange({ from: Number(event.target.value), to: toNumber })}
          >
            {numbers.map((n) => (
              <option key={n} value={n}>
                {t('scenario.revision', { number: n })}
              </option>
            ))}
          </NativeSelect>
        </label>
        <label className="grid gap-1 text-sm font-medium">
          {t('compare.to')}
          <NativeSelect
            className="w-28"
            value={toNumber}
            onChange={(event) => setRange({ from: fromNumber, to: Number(event.target.value) })}
          >
            {numbers.map((n) => (
              <option key={n} value={n}>
                {t('scenario.revision', { number: n })}
              </option>
            ))}
          </NativeSelect>
        </label>
      </div>
      {content}
    </>
  );
}
