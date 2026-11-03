// The global report: every run of an application in a period, aggregated in SQL.
import {
  countStatuses,
  formatRunKey,
  formatTestCaseKey,
  passRate,
  RUN_STATUSES,
  type GlobalReport,
  type RunItemStatus,
  type RunStatus,
  type ScenarioHealth,
  type TestCaseHealth,
  type TrendPoint,
} from '@testrex/contracts';
import { schema, type Transaction } from '@testrex/db';
import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { scenarioLinksById } from './test-cases';

const TREND_RUNS = 30;
const LIST_SIZE = 10;

export async function globalReport(
  tx: Transaction,
  app: { id: string; key: string },
  days: number,
  now: Date,
): Promise<GlobalReport> {
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const runs = await tx
    .select()
    .from(schema.testRuns)
    .where(and(eq(schema.testRuns.applicationId, app.id), gte(schema.testRuns.createdAt, from)))
    .orderBy(asc(schema.testRuns.createdAt), asc(schema.testRuns.number));
  const runsByStatus = Object.fromEntries(RUN_STATUSES.map((status) => [status, 0])) as Record<
    RunStatus,
    number
  >;
  for (const run of runs) runsByStatus[run.status]++;
  const counted = runs.filter((run) => run.status !== 'cancelled');
  const countedIds = counted.map((run) => run.id);

  const statusRows = countedIds.length
    ? await tx
        .select({
          runId: schema.testRunItems.runId,
          status: schema.testRunItems.status,
          n: sql<number>`count(*)::int`,
        })
        .from(schema.testRunItems)
        .where(inArray(schema.testRunItems.runId, countedIds))
        .groupBy(schema.testRunItems.runId, schema.testRunItems.status)
    : [];
  const perRun = new Map<string, RunItemStatus[]>();
  for (const row of statusRows) {
    const list = perRun.get(row.runId) ?? [];
    for (let i = 0; i < row.n; i++) list.push(row.status);
    perRun.set(row.runId, list);
  }
  const counts = countStatuses(statusRows.flatMap((row) => Array(row.n).fill(row.status)));
  const durations = counted
    .filter((run) => run.startedAt && run.finishedAt)
    .map((run) => run.finishedAt!.getTime() - run.startedAt!.getTime());

  const trend: TrendPoint[] = counted.slice(-TREND_RUNS).map((run) => {
    const runCounts = countStatuses(perRun.get(run.id) ?? []);
    return {
      runKey: formatRunKey(app.key, run.number),
      title: run.title,
      createdAt: run.createdAt.toISOString(),
      status: run.status,
      counts: runCounts,
      passRate: passRate(runCounts),
      durationMs:
        run.startedAt && run.finishedAt ? run.finishedAt.getTime() - run.startedAt.getTime() : null,
    };
  });

  const caseStats = countedIds.length
    ? (
        await tx.execute<{
          test_case_id: string;
          executions: number;
          failures: number;
          passes: number;
          avg_duration: number | null;
        }>(sql`
          SELECT i.test_case_id,
                 count(*) FILTER (WHERE i.status IN ('passed', 'failed', 'blocked'))::int AS executions,
                 count(*) FILTER (WHERE i.status IN ('failed', 'blocked'))::int AS failures,
                 count(*) FILTER (WHERE i.status = 'passed')::int AS passes,
                 avg(i.duration_ms) FILTER (
                   WHERE i.execution_mode = 'automated' AND i.duration_ms IS NOT NULL
                     AND i.status IN ('passed', 'failed')
                 )::float AS avg_duration
            FROM ${schema.testRunItems} i
           WHERE i.run_id IN (${sql.join(
             countedIds.map((id) => sql`${id}`),
             sql`, `,
           )})
           GROUP BY i.test_case_id`)
      ).rows
    : [];
  const caseIds = caseStats.map((row) => row.test_case_id);
  const caseRows = caseIds.length
    ? await tx
        .select({
          id: schema.testCases.id,
          number: schema.testCases.number,
          title: schema.testCases.title,
        })
        .from(schema.testCases)
        .where(inArray(schema.testCases.id, caseIds))
    : [];
  const caseInfo = new Map(caseRows.map((row) => [row.id, row]));
  const lastFailures = caseIds.length
    ? (
        await tx.execute<{ test_case_id: string; number: number; finished_at: Date | string }>(sql`
          SELECT DISTINCT ON (i.test_case_id) i.test_case_id, r.number, i.finished_at
            FROM ${schema.testRunItems} i
            JOIN ${schema.testRuns} r ON r.id = i.run_id
           WHERE i.run_id IN (${sql.join(
             countedIds.map((id) => sql`${id}`),
             sql`, `,
           )})
             AND i.status IN ('failed', 'blocked')
           ORDER BY i.test_case_id, i.finished_at DESC NULLS LAST`)
      ).rows
    : [];
  const lastFailure = new Map(
    lastFailures.map((row) => [
      row.test_case_id,
      {
        runKey: formatRunKey(app.key, row.number),
        at: row.finished_at ? new Date(row.finished_at).toISOString() : '',
      },
    ]),
  );
  const health: TestCaseHealth[] = caseStats.flatMap((row) => {
    const info = caseInfo.get(row.test_case_id);
    if (!info) return [];
    return [
      {
        testCase: {
          id: info.id,
          key: formatTestCaseKey(app.key, info.number),
          title: info.title,
        },
        executions: row.executions,
        failures: row.failures,
        passes: row.passes,
        failureRate: row.executions ? row.failures / row.executions : 0,
        lastFailure: lastFailure.get(row.test_case_id) ?? null,
        averageDurationMs: row.avg_duration === null ? null : Math.round(row.avg_duration),
      },
    ];
  });
  const byKey = (a: TestCaseHealth, b: TestCaseHealth) =>
    a.testCase.key.localeCompare(b.testCase.key, undefined, { numeric: true });
  const mostFailing = health
    .filter((entry) => entry.failures > 0)
    .sort((a, b) => b.failures - a.failures || b.failureRate - a.failureRate || byKey(a, b))
    .slice(0, LIST_SIZE);
  const flaky = health
    .filter((entry) => entry.failures > 0 && entry.passes > 0)
    .sort(
      (a, b) =>
        Math.min(b.passes, b.failures) - Math.min(a.passes, a.failures) ||
        b.executions - a.executions ||
        byKey(a, b),
    )
    .slice(0, LIST_SIZE);
  const slowest = health
    .filter((entry) => entry.averageDurationMs !== null)
    .sort((a, b) => b.averageDurationMs! - a.averageDurationMs! || byKey(a, b))
    .slice(0, LIST_SIZE);

  const scenarioRows = countedIds.length
    ? (
        await tx.execute<{ scenario_id: string; executed: number; passed: number }>(sql`
          SELECT s.scenario_id,
                 count(*) FILTER (WHERE i.status IN ('passed', 'failed', 'blocked'))::int AS executed,
                 count(*) FILTER (WHERE i.status = 'passed')::int AS passed
            FROM ${schema.testRunItems} i, unnest(i.scenario_ids) AS s(scenario_id)
           WHERE i.run_id IN (${sql.join(
             countedIds.map((id) => sql`${id}`),
             sql`, `,
           )})
           GROUP BY s.scenario_id`)
      ).rows
    : [];
  const links = await scenarioLinksById(
    tx,
    app,
    scenarioRows.map((row) => row.scenario_id),
  );
  const scenarios: ScenarioHealth[] = scenarioRows
    .filter((row) => row.executed > 0 && links.has(row.scenario_id))
    .map((row) => ({
      scenario: links.get(row.scenario_id)!,
      executed: row.executed,
      passed: row.passed,
      passRate: row.executed ? row.passed / row.executed : null,
    }))
    .sort(
      (a, b) =>
        (a.passRate ?? 1) - (b.passRate ?? 1) ||
        b.executed - a.executed ||
        a.scenario.key.localeCompare(b.scenario.key, undefined, { numeric: true }),
    )
    .slice(0, 20);

  return {
    days,
    from: from.toISOString(),
    to: now.toISOString(),
    runs: runs.length,
    runsByStatus,
    counts,
    passRate: passRate(counts),
    averageDurationMs: durations.length
      ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
      : null,
    trend,
    mostFailing,
    flaky,
    slowest,
    scenarios,
  };
}
