// AI assistance: proposals are always reviewed here before anything is saved.
import {
  AI_PROPOSALS_MAX,
  type AiGenerateResult,
  type AiReviseResult,
  type ExecutionMode,
  type TestCase,
  type TestCaseProposal,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  NativeSelect,
  Textarea,
} from '@testrex/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { StepsView, stepMarks } from '../../components/steps';
import { api, errorMessage, isApiError } from '../../lib/api';
import { appApi, invalidateTestCases, testCaseApi, testKeys } from '../../lib/queries';

function Issues({ issues }: { issues: string[] }) {
  const { t } = useTranslation();
  if (issues.length === 0) return null;
  return (
    <Alert variant="warning" className="grid gap-1">
      <p className="font-medium">{t('ai.issues', { count: issues.length })}</p>
      <ul className="list-disc pl-5 text-xs">
        {issues.map((issue) => (
          <li key={issue}>{issue}</li>
        ))}
      </ul>
    </Alert>
  );
}

function Thinking() {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
      <Loader2 className="size-4 animate-spin" aria-hidden /> {t('ai.thinking')}
    </p>
  );
}

/** Proposes new test cases for a scenario; each one can be created after review. */
export function GenerateTestCasesDialog({
  orgSlug,
  appKey,
  scenario,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  appKey: string;
  scenario: { id: string; key: string; title: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [count, setCount] = useState(3);
  const [mode, setMode] = useState<ExecutionMode>('automated');
  const [instructions, setInstructions] = useState('');
  const [proposals, setProposals] = useState<(TestCaseProposal & { created?: string })[]>([]);
  const generate = useMutation({
    mutationFn: () =>
      api.post<AiGenerateResult>(`${appApi(orgSlug, appKey)}/ai/test-cases/generate`, {
        scenarioId: scenario.id,
        count,
        executionMode: mode,
        instructions,
      }),
    onSuccess: (result) => setProposals(result.proposals),
    onError: (error) => toast.error(errorMessage(error)),
  });
  const create = useMutation({
    mutationFn: async (index: number) => {
      const proposal = proposals[index]!;
      const saved = await api.post<TestCase>(`${appApi(orgSlug, appKey)}/test-cases`, {
        title: proposal.title,
        priority: proposal.priority,
        executionMode: proposal.executionMode,
        description: proposal.description,
        preconditions: proposal.preconditions,
        tags: proposal.tags,
        steps: proposal.steps,
        scenarioIds: [scenario.id],
        source: 'ai',
      });
      return { index, saved };
    },
    onSuccess: async ({ index, saved }) => {
      setProposals((current) =>
        current.map((p, i) => (i === index ? { ...p, created: saved.key } : p)),
      );
      toast.success(t('testCases.created', { key: saved.key }));
      await invalidateTestCases(orgSlug, appKey);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const reset = (next: boolean) => {
    if (!next) setProposals([]);
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogContent
        className="max-h-[92vh] max-w-4xl overflow-y-auto"
        closeLabel={t('common.close')}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" aria-hidden /> {t('ai.generateTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('ai.generateBody', { scenario: `${scenario.key} · ${scenario.title}` })}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            generate.mutate();
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="ai-count">{t('ai.count')}</Label>
              <Input
                id="ai-count"
                type="number"
                min={1}
                max={AI_PROPOSALS_MAX}
                value={count}
                onChange={(event) =>
                  setCount(Math.min(AI_PROPOSALS_MAX, Math.max(1, Number(event.target.value) || 1)))
                }
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ai-mode">{t('testCases.fields.mode')}</Label>
              <NativeSelect
                id="ai-mode"
                value={mode}
                onChange={(event) => setMode(event.target.value as ExecutionMode)}
              >
                <option value="automated">{t('testCases.mode.automated')}</option>
                <option value="manual">{t('testCases.mode.manual')}</option>
              </NativeSelect>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ai-instructions">{t('ai.instructions')}</Label>
            <Textarea
              id="ai-instructions"
              value={instructions}
              placeholder={t('ai.generatePlaceholder')}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <div>
            <Button type="submit" disabled={generate.isPending}>
              <Sparkles /> {proposals.length ? t('ai.regenerate') : t('ai.generate')}
            </Button>
          </div>
        </form>
        {generate.isPending ? <Thinking /> : null}
        <div className="grid gap-4">
          {proposals.map((proposal, index) => (
            <section
              key={index}
              aria-label={proposal.title}
              className="grid gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label={t('testCases.fields.title')}
                  className="flex-1 font-medium"
                  value={proposal.title}
                  disabled={Boolean(proposal.created)}
                  onChange={(event) =>
                    setProposals((current) =>
                      current.map((p, i) =>
                        i === index ? { ...p, title: event.target.value } : p,
                      ),
                    )
                  }
                />
                <Badge variant="muted">{t(`scenario.priority.${proposal.priority}`)}</Badge>
                {proposal.created ? (
                  <Badge className="gap-1">
                    <Check className="size-3.5" aria-hidden /> {proposal.created}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={create.isPending || proposal.steps.length === 0}
                    onClick={() => create.mutate(index)}
                  >
                    {t('ai.create')}
                  </Button>
                )}
              </div>
              {proposal.description ? (
                <p className="text-sm text-muted-foreground">{proposal.description}</p>
              ) : null}
              <Issues issues={proposal.issues} />
              <StepsView steps={proposal.steps} />
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Revises a test case from an instruction, or fixes it from a failed run item. The proposal
 * is compared with the current steps and saved as a new version only when accepted.
 */
export function ReviseTestCaseDialog({
  orgSlug,
  appKey,
  testCase,
  failure,
  open,
  onOpenChange,
}: {
  orgSlug: string;
  appKey: string;
  testCase: Pick<TestCase, 'key' | 'title' | 'steps'>;
  /** Fix mode: the failed item to learn from. */
  failure?: { runKey: string; itemId: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState<AiReviseResult | null>(null);
  const ask = useMutation({
    mutationFn: () =>
      failure
        ? api.post<AiReviseResult>(
            `${appApi(orgSlug, appKey)}/ai/runs/${encodeURIComponent(failure.runKey)}/items/${failure.itemId}/fix`,
            { instructions },
          )
        : api.post<AiReviseResult>(
            `${appApi(orgSlug, appKey)}/ai/test-cases/${encodeURIComponent(testCase.key)}/revise`,
            { instructions },
          ),
    onSuccess: setResult,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const accept = useMutation({
    mutationFn: () => {
      const proposal = result!.proposal;
      return api.patch<TestCase>(testCaseApi(orgSlug, appKey, testCase.key), {
        baseVersion: result!.baseVersion,
        title: proposal.title,
        priority: proposal.priority,
        description: proposal.description,
        preconditions: proposal.preconditions,
        tags: proposal.tags,
        steps: proposal.steps,
        source: 'ai',
      });
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(testKeys.testCase(orgSlug, appKey, saved.key), saved);
      await invalidateTestCases(orgSlug, appKey);
      toast.success(t('ai.applied', { version: saved.version }));
      close(false);
    },
    onError: (error) => {
      if (isApiError(error, 409) && error.code === 'TEST_CASE_CHANGED') {
        toast.error(t('ai.changedMeanwhile'));
        return;
      }
      toast.error(errorMessage(error));
    },
  });
  const close = (next: boolean) => {
    if (!next) {
      setResult(null);
      setInstructions('');
    }
    onOpenChange(next);
  };
  const marks = result ? stepMarks(testCase.steps, result.proposal.steps) : null;
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[92vh] max-w-5xl overflow-y-auto"
        closeLabel={t('common.close')}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" aria-hidden />
            {failure
              ? t('ai.fixTitle', { key: testCase.key })
              : t('ai.reviseTitle', { key: testCase.key })}
          </DialogTitle>
          <DialogDescription>
            {failure ? t('ai.fixBody', { run: failure.runKey }) : t('ai.reviseBody')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            ask.mutate();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="ai-revise">
              {failure ? t('ai.optionalInstructions') : t('ai.instructions')}
            </Label>
            <Textarea
              id="ai-revise"
              value={instructions}
              required={!failure}
              placeholder={failure ? t('ai.fixPlaceholder') : t('ai.revisePlaceholder')}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </div>
          <div>
            <Button type="submit" disabled={ask.isPending || (!failure && !instructions.trim())}>
              <Sparkles />{' '}
              {result ? t('ai.askAgain') : failure ? t('ai.proposeFix') : t('ai.propose')}
            </Button>
          </div>
        </form>
        {ask.isPending ? <Thinking /> : null}
        {result && marks ? (
          <div className="grid gap-4">
            <Alert variant="info">
              <Sparkles aria-hidden />
              <div>
                <p className="font-medium">{t('ai.summary', { model: result.model })}</p>
                <p>{result.summary}</p>
              </div>
            </Alert>
            {result.proposal.title !== testCase.title ? (
              <p className="text-sm">
                {t('ai.titleChange')}: <del>{testCase.title}</del> →{' '}
                <ins className="font-medium">{result.proposal.title}</ins>
              </p>
            ) : null}
            <Issues issues={result.proposal.issues} />
            <div className="grid gap-4 lg:grid-cols-2">
              <section className="grid content-start gap-2" aria-label={t('ai.current')}>
                <h3 className="text-sm font-medium">{t('ai.current')}</h3>
                <StepsView
                  steps={testCase.steps}
                  marks={Object.fromEntries(
                    marks.removed.map((step) => [step.id, 'removed' as const]),
                  )}
                />
              </section>
              <section className="grid content-start gap-2" aria-label={t('ai.proposed')}>
                <h3 className="text-sm font-medium">{t('ai.proposed')}</h3>
                <StepsView steps={result.proposal.steps} marks={marks.proposedMarks} />
              </section>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                {t('ai.discard')}
              </Button>
              <Button disabled={accept.isPending} onClick={() => accept.mutate()}>
                <Check /> {t('ai.accept')}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
