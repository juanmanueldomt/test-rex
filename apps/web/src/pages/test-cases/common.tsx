import {
  hasAppPermission,
  type ExecutionMode,
  type LastResult,
  type RunItemStatus,
  type RunStatus,
  type ScenarioLink,
} from '@testrex/contracts';
import { Badge, cn } from '@testrex/ui';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import {
  Ban,
  Bot,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Clock,
  Hand,
  Loader2,
  Square,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import i18n from '../../lib/i18n';
import { aiStatusQuery, appQuery } from '../../lib/queries';

/** What the current user may do with test cases and runs of this application. */
export function useTestingAccess(orgSlug: string, appKey: string) {
  const app = useSuspenseQuery(appQuery(orgSlug, appKey)).data;
  const writable = !app.archivedAt;
  const ai = useQuery(aiStatusQuery(orgSlug)).data;
  const canEdit = writable && hasAppPermission(app.role, 'testcase.write');
  return {
    app,
    /** Test cases, datasets, global steps, automation settings, recordings. */
    canEdit,
    /** Start, cancel and complete runs; record manual results. */
    canExecute: writable && hasAppPermission(app.role, 'execution.write'),
    /** AI actions are offered to editors when the organization configured a provider. */
    canUseAi: canEdit && Boolean(ai?.configured),
  };
}

export function ModeBadge({ mode }: { mode: ExecutionMode }) {
  const { t } = useTranslation();
  const Icon = mode === 'automated' ? Bot : Hand;
  return (
    <Badge variant="outline" className={cn(mode === 'automated' && 'border-primary/40')}>
      <Icon className="size-3.5" aria-hidden />
      {t(`testCases.mode.${mode}`)}
    </Badge>
  );
}

const ITEM_ICONS: Record<RunItemStatus, typeof CircleCheck> = {
  queued: Clock,
  untested: CircleDashed,
  running: Loader2,
  passed: CircleCheck,
  failed: CircleX,
  blocked: Ban,
  skipped: CircleSlash,
};
export const ITEM_STYLES: Record<RunItemStatus, string> = {
  queued: 'border-border text-muted-foreground',
  untested: 'border-border text-muted-foreground',
  running: 'border-primary/40 text-accent-foreground',
  passed: 'border-primary/40 bg-accent text-accent-foreground',
  failed: 'border-destructive/50 text-destructive',
  blocked: 'border-warning/50 text-warning',
  skipped: 'border-border text-muted-foreground',
};

export function ItemStatusBadge({ status }: { status: RunItemStatus }) {
  const { t } = useTranslation();
  const Icon = ITEM_ICONS[status];
  return (
    <Badge variant="outline" className={ITEM_STYLES[status]}>
      <Icon className={cn('size-3.5', status === 'running' && 'animate-spin')} aria-hidden />
      {t(`runs.itemStatus.${status}`)}
    </Badge>
  );
}

const RUN_ICONS: Record<RunStatus, typeof CircleCheck> = {
  queued: Clock,
  running: Loader2,
  completed: CircleCheck,
  cancelled: Square,
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const { t } = useTranslation();
  const Icon = RUN_ICONS[status];
  return (
    <Badge
      variant="outline"
      className={cn(
        status === 'completed' && 'border-primary/40 bg-accent text-accent-foreground',
        status === 'cancelled' && 'border-warning/40 text-warning',
      )}
    >
      <Icon className={cn('size-3.5', status === 'running' && 'animate-spin')} aria-hidden />
      {t(`runs.status.${status}`)}
    </Badge>
  );
}

export function LastResultBadge({
  result,
  orgSlug,
  appKey,
}: {
  result: LastResult | null;
  orgSlug: string;
  appKey: string;
}) {
  const { t } = useTranslation();
  if (!result)
    return <span className="text-sm text-muted-foreground">{t('testCases.neverRun')}</span>;
  return (
    <Link
      to="/o/$orgSlug/a/$appKey/runs/$runKey"
      params={{ orgSlug, appKey, runKey: result.runKey }}
      className="inline-flex items-center gap-1.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onClick={(event) => event.stopPropagation()}
      title={t('testCases.lastResultIn', { run: result.runKey })}
    >
      <ItemStatusBadge status={result.status} />
      <span className="font-mono text-xs text-muted-foreground">{result.runKey}</span>
    </Link>
  );
}

export function ScenarioChips({
  scenarios,
  orgSlug,
  appKey,
  max = 2,
}: {
  scenarios: ScenarioLink[];
  orgSlug: string;
  appKey: string;
  max?: number;
}) {
  const { t } = useTranslation();
  const visible = scenarios.slice(0, max);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {visible.map((scenario) => (
        <Link
          key={scenario.id}
          to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
          params={{ orgSlug, appKey, scenarioKey: scenario.key }}
          className={cn(
            'rounded-md border bg-card px-1.5 py-0.5 font-mono text-xs hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            scenario.deleted && 'line-through text-muted-foreground',
          )}
          title={`${scenario.key} · ${scenario.title}${scenario.deleted ? ` (${t('scenarios.deleted')})` : ''}`}
          onClick={(event) => event.stopPropagation()}
        >
          {scenario.key}
        </Link>
      ))}
      {scenarios.length > max ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          +{scenarios.length - max}
        </span>
      ) : null}
    </span>
  );
}

/** "1 min 5 s", "820 ms" in the interface language. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  const format = (value: number, unit: 'millisecond' | 'second' | 'minute' | 'hour') =>
    new Intl.NumberFormat(i18n.language, { style: 'unit', unit, unitDisplay: 'narrow' }).format(
      value,
    );
  if (ms < 1000) return format(Math.round(ms), 'millisecond');
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return format(Math.round(ms / 100) / 10, 'second');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${format(minutes, 'minute')} ${format(seconds % 60, 'second')}`;
  return `${format(Math.floor(minutes / 60), 'hour')} ${format(minutes % 60, 'minute')}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(i18n.language, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(value);
}
