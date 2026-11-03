// The Test cases tab of a scenario: its linked test cases and what can be done with them.
import type { Run, Scenario } from '@testrex/contracts';
import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@testrex/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Code2, ListChecks, Play, Plus, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StatusBadge } from '../../components/scenario-ui';
import { api, errorMessage } from '../../lib/api';
import { appApi, invalidateRuns, scenarioCodeQuery, testCaseListQuery } from '../../lib/queries';
import { GenerateTestCasesDialog } from './ai';
import { LastResultBadge, ModeBadge, useTestingAccess } from './common';
import { CodeBlock } from './TestCasePage';

export function ScenarioTestCases({
  orgSlug,
  appKey,
  scenario,
}: {
  orgSlug: string;
  appKey: string;
  scenario: Scenario;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canEdit, canExecute, canUseAi } = useTestingAccess(orgSlug, appKey);
  const list = useQuery(
    testCaseListQuery(orgSlug, appKey, { scenario: [scenario.id], size: 100, sort: 'key' }),
  );
  const [generating, setGenerating] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const code = useQuery({ ...scenarioCodeQuery(orgSlug, appKey, scenario.key), enabled: showCode });
  const deleted = Boolean(scenario.deletedAt);
  const run = useMutation({
    mutationFn: () =>
      api.post<Run>(`${appApi(orgSlug, appKey)}/runs`, { scenarioIds: [scenario.id] }),
    onSuccess: async (created) => {
      await invalidateRuns(orgSlug, appKey);
      await navigate({
        to: '/o/$orgSlug/a/$appKey/runs/$runKey',
        params: { orgSlug, appKey, runKey: created.key },
      });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const items = list.data?.items ?? [];
  const actions = (
    <div className="flex flex-wrap gap-2">
      {canEdit && !deleted ? (
        <Button asChild>
          <Link
            to="/o/$orgSlug/a/$appKey/test-cases/new"
            params={{ orgSlug, appKey }}
            search={{ scenario: scenario.key }}
          >
            <Plus /> {t('testCases.new')}
          </Link>
        </Button>
      ) : null}
      {canUseAi && !deleted ? (
        <Button variant="outline" onClick={() => setGenerating(true)}>
          <Sparkles /> {t('ai.generate')}
        </Button>
      ) : null}
      {canExecute && !deleted && items.length ? (
        <Button variant="outline" onClick={() => run.mutate()} disabled={run.isPending}>
          <Play /> {t('scenario.runScenario')}
        </Button>
      ) : null}
      {items.length ? (
        <Button variant="ghost" onClick={() => setShowCode(true)}>
          <Code2 /> {t('scenario.viewCode')}
        </Button>
      ) : null}
    </div>
  );
  return (
    <div className="grid gap-4">
      {list.isPending ? (
        <Skeleton className="h-32" />
      ) : list.isError ? (
        <Alert variant="destructive">{errorMessage(list.error)}</Alert>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ListChecks />}
          title={t('scenario.casesTitle')}
          description={t('scenario.casesBody')}
          action={actions}
        />
      ) : (
        <>
          {actions}
          <Table aria-label={t('scenario.casesLabel', { key: scenario.key })}>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t('testCases.columns.key')}</TableHead>
                <TableHead>{t('testCases.columns.title')}</TableHead>
                <TableHead>{t('testCases.columns.mode')}</TableHead>
                <TableHead>{t('testCases.columns.status')}</TableHead>
                <TableHead className="text-right">{t('testCases.columns.steps')}</TableHead>
                <TableHead>{t('testCases.columns.lastResult')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.key}</TableCell>
                  <TableCell>
                    <Link
                      to="/o/$orgSlug/a/$appKey/test-cases/$testCaseKey"
                      params={{ orgSlug, appKey, testCaseKey: item.key }}
                      className="font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ModeBadge mode={item.executionMode} />
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={item.status} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.stepCount}</TableCell>
                  <TableCell>
                    <LastResultBadge result={item.lastResult} orgSlug={orgSlug} appKey={appKey} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </>
      )}
      {canUseAi ? (
        <GenerateTestCasesDialog
          orgSlug={orgSlug}
          appKey={appKey}
          scenario={{ id: scenario.id, key: scenario.key, title: scenario.title }}
          open={generating}
          onOpenChange={setGenerating}
        />
      ) : null}
      <Dialog open={showCode} onOpenChange={setShowCode}>
        <DialogContent
          className="max-h-[92vh] max-w-4xl overflow-y-auto"
          closeLabel={t('common.close')}
        >
          <DialogHeader>
            <DialogTitle>{t('scenario.codeTitle', { key: scenario.key })}</DialogTitle>
          </DialogHeader>
          {code.data ? (
            <CodeBlock code={code.data} label={t('testCases.codeLabel', { key: scenario.key })} />
          ) : code.isError ? (
            <Alert variant="destructive">{errorMessage(code.error)}</Alert>
          ) : (
            <Skeleton className="h-64" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
