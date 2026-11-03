// The global report: every run of the period, trends and the test cases that need attention.
import {
  REPORT_PERIODS,
  type GlobalReport,
  type RunCounts,
  type TestCaseHealth,
  type TrendPoint,
} from '@testrex/contracts';
import {
  Alert,
  Button,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@testrex/ui';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { BarChart3 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/api';
import { formatDate } from '../../lib/i18n';
import { reportQuery } from '../../lib/queries';
import { formatDuration, formatPercent } from '../test-cases/common';

/** Stacking order (bottom → top) chosen with the color validator: red and green never touch. */
const SERIES: { status: keyof RunCounts; color: string }[] = [
  { status: 'failed', color: 'var(--chart-failed)' },
  { status: 'skipped', color: 'var(--chart-skipped)' },
  { status: 'blocked', color: 'var(--chart-blocked)' },
  { status: 'passed', color: 'var(--chart-passed)' },
];

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid gap-1 rounded-lg border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-3xl font-semibold">{value}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** Clean tick values: 0 and up to four steps of 1, 2, 5 × 10ⁿ. */
function ticksFor(max: number): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((m) => m * power).find((candidate) => candidate >= raw) ?? power * 10;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

function Tooltip({ point }: { point: TrendPoint }) {
  const { t } = useTranslation();
  return (
    <div
      role="presentation"
      className="pointer-events-none grid min-w-44 gap-1 rounded-md border bg-popover p-2 text-xs shadow-md"
    >
      <p className="font-medium">
        {point.runKey} · {formatDate(point.createdAt)}
      </p>
      <p className="line-clamp-2 text-muted-foreground">{point.title}</p>
      {[...SERIES].reverse().map((series) => (
        <p key={series.status} className="flex items-center gap-2">
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full"
            style={{ background: series.color }}
          />
          <span className="font-semibold tabular-nums">{point.counts[series.status]}</span>
          <span className="text-muted-foreground">{t(`runs.itemStatus.${series.status}`)}</span>
        </p>
      ))}
      <p>
        <span className="font-semibold">{formatPercent(point.passRate)}</span>{' '}
        <span className="text-muted-foreground">{t('reports.passRate').toLowerCase()}</span>
      </p>
    </div>
  );
}

/**
 * Stacked columns of item results per run (oldest left), on one count axis. The pass rate is
 * its own small panel above, with its own 0–100 % scale, instead of a second axis.
 */
function TrendChart({
  orgSlug,
  appKey,
  trend,
}: {
  orgSlug: string;
  appKey: string;
  trend: TrendPoint[];
}) {
  const { t } = useTranslation();
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(
    1,
    ...trend.map(
      (point) =>
        point.counts.passed + point.counts.failed + point.counts.blocked + point.counts.skipped,
    ),
  );
  const ticks = ticksFor(max);
  const top = ticks[ticks.length - 1]!;
  const slot = 100 / trend.length;
  const ratePoints = trend
    .map((point, index) =>
      point.passRate === null
        ? null
        : { x: slot * (index + 0.5), y: 100 - point.passRate * 100, index },
    )
    .filter((point): point is { x: number; y: number; index: number } => point !== null);
  return (
    <figure className="grid gap-3" aria-labelledby="trend-caption">
      <figcaption id="trend-caption" className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-semibold">
          {t('reports.trendTitle', { count: trend.length })}
        </span>
        <span
          className="flex flex-wrap gap-3 text-xs text-muted-foreground"
          aria-label={t('reports.legend')}
        >
          {[...SERIES].reverse().map((series) => (
            <span key={series.status} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 rounded-sm"
                style={{ background: series.color }}
              />
              {t(`runs.itemStatus.${series.status}`)}
            </span>
          ))}
        </span>
      </figcaption>

      {/* Pass rate panel: 0–100 %, line with end-dots, same x positions as the columns. */}
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
        <div
          className="relative h-20 text-right text-xs tabular-nums text-muted-foreground"
          aria-hidden
        >
          <span className="absolute right-0 top-0 -translate-y-1/2">100%</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">50%</span>
          <span className="absolute right-0 bottom-0 translate-y-1/2">0%</span>
        </div>
        <div className="relative h-20 border-b">
          <span aria-hidden className="absolute inset-x-0 top-0 border-t" />
          <span aria-hidden className="absolute inset-x-0 top-1/2 border-t" />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full overflow-visible"
            aria-hidden
          >
            {ratePoints.length > 1 ? (
              <polyline
                points={ratePoints.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke="var(--chart-passed)"
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {ratePoints.map((p) => (
            <span
              key={p.index}
              aria-hidden
              className={cn(
                'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card',
                active === p.index && 'size-3',
              )}
              style={{ left: `${p.x}%`, top: `${p.y}%`, background: 'var(--chart-passed)' }}
            />
          ))}
          <span className="sr-only">{t('reports.passRatePanel')}</span>
        </div>
      </div>

      {/* Count panel: stacked columns on one axis. */}
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2">
        <div
          className="relative h-56 text-right text-xs tabular-nums text-muted-foreground"
          aria-hidden
        >
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-0 translate-y-1/2"
              style={{ bottom: `${(tick / top) * 100}%` }}
            >
              {new Intl.NumberFormat().format(tick)}
            </span>
          ))}
        </div>
        <div className="relative h-56 border-b">
          {ticks.slice(1).map((tick) => (
            <span
              key={tick}
              aria-hidden
              className="absolute inset-x-0 border-t"
              style={{ bottom: `${(tick / top) * 100}%` }}
            />
          ))}
          <ol className="absolute inset-0 flex" aria-label={t('reports.trendLabel')}>
            {trend.map((point, index) => {
              const total =
                point.counts.passed +
                point.counts.failed +
                point.counts.blocked +
                point.counts.skipped;
              const label = t('reports.columnLabel', {
                run: point.runKey,
                passed: point.counts.passed,
                failed: point.counts.failed,
                blocked: point.counts.blocked,
                skipped: point.counts.skipped,
                rate: formatPercent(point.passRate),
              });
              const visible = SERIES.filter((series) => point.counts[series.status] > 0);
              return (
                <li
                  key={point.runKey}
                  className="relative flex h-full flex-1 items-end justify-center"
                >
                  <Link
                    to="/o/$orgSlug/a/$appKey/runs/$runKey"
                    params={{ orgSlug, appKey, runKey: point.runKey }}
                    aria-label={label}
                    onPointerEnter={() => setActive(index)}
                    onPointerLeave={() =>
                      setActive((current) => (current === index ? null : current))
                    }
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive((current) => (current === index ? null : current))}
                    className="group flex h-full w-full items-end justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      className={cn(
                        'flex w-full max-w-6 flex-col-reverse gap-0.5 transition-opacity',
                        active !== null && active !== index && 'opacity-60',
                      )}
                      style={{ height: `${(total / top) * 100}%` }}
                    >
                      {visible.map((series, segment) => (
                        <span
                          key={series.status}
                          className={cn(segment === visible.length - 1 && 'rounded-t')}
                          style={{
                            flexGrow: point.counts[series.status],
                            flexBasis: 0,
                            minHeight: 2,
                            background: series.color,
                          }}
                        />
                      ))}
                    </span>
                  </Link>
                  {active === index ? (
                    <div
                      className={cn(
                        'absolute bottom-full z-10 mb-2',
                        index < trend.length / 2 ? 'left-1/2' : 'right-1/2',
                      )}
                    >
                      <Tooltip point={point} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      <div className="grid grid-cols-[3rem_minmax(0,1fr)] gap-2" aria-hidden>
        <span />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{trend[0] ? formatDate(trend[0].createdAt) : ''}</span>
          <span>{trend.length > 1 ? formatDate(trend[trend.length - 1]!.createdAt) : ''}</span>
        </div>
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer font-medium">{t('reports.showTable')}</summary>
        <Table className="mt-2" aria-label={t('reports.trendTable')}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('runs.columns.key')}</TableHead>
              <TableHead>{t('reports.date')}</TableHead>
              {[...SERIES].reverse().map((series) => (
                <TableHead key={series.status} className="text-right">
                  {t(`runs.itemStatus.${series.status}`)}
                </TableHead>
              ))}
              <TableHead className="text-right">{t('reports.passRate')}</TableHead>
              <TableHead className="text-right">{t('runs.columns.duration')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {trend.map((point) => (
              <TableRow key={point.runKey}>
                <TableCell className="font-mono text-xs">{point.runKey}</TableCell>
                <TableCell>{formatDate(point.createdAt)}</TableCell>
                {[...SERIES].reverse().map((series) => (
                  <TableCell key={series.status} className="text-right tabular-nums">
                    {point.counts[series.status]}
                  </TableCell>
                ))}
                <TableCell className="text-right tabular-nums">
                  {formatPercent(point.passRate)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(point.durationMs)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </figure>
  );
}

function HealthTable({
  title,
  description,
  rows,
  orgSlug,
  appKey,
  value,
  valueLabel,
  empty,
}: {
  title: string;
  description: string;
  rows: TestCaseHealth[];
  orgSlug: string;
  appKey: string;
  value: (row: TestCaseHealth) => ReactNode;
  valueLabel: string;
  empty: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="grid content-start gap-2" aria-label={title}>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{description}</p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t('reports.testCase')}</TableHead>
              <TableHead className="text-right">{valueLabel}</TableHead>
              <TableHead className="text-right">{t('reports.executions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.testCase.id}>
                <TableCell>
                  <Link
                    to="/o/$orgSlug/a/$appKey/test-cases/$testCaseKey"
                    params={{ orgSlug, appKey, testCaseKey: row.testCase.key }}
                    className="hover:underline"
                  >
                    <span className="font-mono text-xs">{row.testCase.key}</span>{' '}
                    {row.testCase.title}
                  </Link>
                  {row.lastFailure ? (
                    <p className="text-xs text-muted-foreground">
                      {t('reports.lastFailure', { run: row.lastFailure.runKey })}
                    </p>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums">{value(row)}</TableCell>
                <TableCell className="text-right tabular-nums">{row.executions}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function ReportsPage({ orgSlug, appKey }: { orgSlug: string; appKey: string }) {
  const { t } = useTranslation();
  const [days, setDays] = useState<number>(30);
  const report = useQuery({
    ...reportQuery(orgSlug, appKey, days),
    placeholderData: (previous) => previous,
  });
  const data: GlobalReport | undefined = report.data;
  return (
    <section aria-labelledby="reports-heading" className="grid gap-6">
      <h2 id="reports-heading" className="sr-only">
        {t('workspace.tabs.reports')}
      </h2>
      <div
        role="group"
        aria-label={t('reports.period')}
        className="flex flex-wrap items-center gap-1"
      >
        {REPORT_PERIODS.map((period) => (
          <Button
            key={period}
            size="sm"
            variant={days === period ? 'default' : 'outline'}
            aria-pressed={days === period}
            onClick={() => setDays(period)}
          >
            {t('reports.lastDays', { count: period })}
          </Button>
        ))}
      </div>
      {report.isPending ? (
        <Skeleton className="h-96" />
      ) : report.isError ? (
        <Alert variant="destructive">{errorMessage(report.error)}</Alert>
      ) : data!.runs === 0 ? (
        <EmptyState
          icon={<BarChart3 />}
          title={t('reports.emptyTitle')}
          description={t('reports.emptyBody')}
          action={
            <Button variant="outline" asChild>
              <Link to="/o/$orgSlug/a/$appKey/runs" params={{ orgSlug, appKey }}>
                {t('reports.goToRuns')}
              </Link>
            </Button>
          }
        />
      ) : (
        <div className={cn('grid gap-8', report.isPlaceholderData && 'opacity-60')}>
          <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label={t('reports.passRate')}
              value={formatPercent(data!.passRate)}
              hint={t('reports.passRateHint', {
                passed: data!.counts.passed,
                executed: data!.counts.passed + data!.counts.failed + data!.counts.blocked,
              })}
            />
            <Tile
              label={t('reports.runs')}
              value={data!.runs}
              hint={t('reports.runsHint', {
                completed: data!.runsByStatus.completed,
                cancelled: data!.runsByStatus.cancelled,
                open: data!.runsByStatus.queued + data!.runsByStatus.running,
              })}
            />
            <Tile
              label={t('reports.failedItems')}
              value={data!.counts.failed + data!.counts.blocked}
              hint={t('runs.failuresHint', {
                failed: data!.counts.failed,
                blocked: data!.counts.blocked,
              })}
            />
            <Tile
              label={t('reports.averageDuration')}
              value={formatDuration(data!.averageDurationMs)}
              hint={t('reports.averageDurationHint')}
            />
          </dl>
          {data!.trend.length ? (
            <TrendChart orgSlug={orgSlug} appKey={appKey} trend={data!.trend} />
          ) : null}
          <div className="grid gap-8 lg:grid-cols-3">
            <HealthTable
              title={t('reports.mostFailing')}
              description={t('reports.mostFailingBody')}
              rows={data!.mostFailing}
              orgSlug={orgSlug}
              appKey={appKey}
              valueLabel={t('reports.failures')}
              value={(row) => `${row.failures} (${formatPercent(row.failureRate)})`}
              empty={t('reports.noFailures')}
            />
            <HealthTable
              title={t('reports.flaky')}
              description={t('reports.flakyBody')}
              rows={data!.flaky}
              orgSlug={orgSlug}
              appKey={appKey}
              valueLabel={t('reports.passesFailures')}
              value={(row) => `${row.passes} / ${row.failures}`}
              empty={t('reports.noFlaky')}
            />
            <HealthTable
              title={t('reports.slowest')}
              description={t('reports.slowestBody')}
              rows={data!.slowest}
              orgSlug={orgSlug}
              appKey={appKey}
              valueLabel={t('reports.averageDuration')}
              value={(row) => formatDuration(row.averageDurationMs)}
              empty={t('reports.noDurations')}
            />
          </div>
          <section className="grid gap-2" aria-labelledby="scenario-health">
            <h3 id="scenario-health" className="font-semibold">
              {t('reports.scenarioHealth')}
            </h3>
            <p className="text-sm text-muted-foreground">{t('reports.scenarioHealthBody')}</p>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t('runs.scenario')}</TableHead>
                  <TableHead className="text-right">{t('reports.executed')}</TableHead>
                  <TableHead className="w-64">{t('reports.passRate')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data!.scenarios.map((entry) => (
                  <TableRow key={entry.scenario.id}>
                    <TableCell>
                      <Link
                        to="/o/$orgSlug/a/$appKey/scenarios/$scenarioKey"
                        params={{ orgSlug, appKey, scenarioKey: entry.scenario.key }}
                        className="hover:underline"
                      >
                        <span className="font-mono text-xs">{entry.scenario.key}</span>{' '}
                        {entry.scenario.title}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{entry.executed}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 flex-1 overflow-hidden rounded-full"
                          style={{ background: 'var(--chart-pending)' }}
                          aria-hidden
                        >
                          <span
                            className="block h-full rounded-full"
                            style={{
                              width: `${(entry.passRate ?? 0) * 100}%`,
                              background: 'var(--chart-passed)',
                            }}
                          />
                        </span>
                        <span className="w-12 text-right tabular-nums">
                          {formatPercent(entry.passRate)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        </div>
      )}
    </section>
  );
}
