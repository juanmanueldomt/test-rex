// Steps of test cases and global steps: a read-only list where assertions and expected results
// stand out, and the editor used by test cases, global steps and recordings.
import {
  ARIA_ROLES,
  isAssertion,
  LOCATOR_STRATEGIES,
  newStepId,
  STEP_ACTIONS,
  STEP_ASSERTIONS,
  STEP_RULES,
  type LocatorStrategy,
  type StepAction,
  type StepLocator,
  type StepResult,
  type StepResultStatus,
  type TestStep,
} from '@testrex/contracts';
import { Badge, Button, Input, NativeSelect, Textarea, cn } from '@testrex/ui';
import {
  ArrowDown,
  ArrowUp,
  Ban,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  CircleX,
  Copy,
  Hand,
  ListChecks,
  MousePointerClick,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Localized readable text of a step's action, locator and value. */
export function useStepText() {
  const { t } = useTranslation();
  const locator = (target: StepLocator | undefined): string => {
    if (!target) return t('steps.thePage');
    const base =
      target.strategy === 'role'
        ? target.name
          ? `${target.value} “${target.name}”`
          : target.value
        : `${t(`steps.strategies.${target.strategy}`).toLowerCase()} “${target.value}”`;
    return target.nth === undefined ? base : `${base} (#${target.nth + 1})`;
  };
  const action = (step: Pick<TestStep, 'action' | 'target' | 'value'>): string => {
    const values = { target: locator(step.target), value: step.value ?? '' };
    if (step.action === 'press' && step.target) return t('steps.describe.pressOn', values);
    return t(`steps.describe.${step.action}`, values);
  };
  return {
    locator,
    action,
    /** The written description, else the generated one. */
    text: (step: TestStep) => step.description || action(step),
  };
}

const RESULT_ICONS: Record<StepResultStatus, typeof CircleCheck> = {
  passed: CircleCheck,
  failed: CircleX,
  blocked: Ban,
  skipped: CircleSlash,
  untested: CircleDashed,
};
const RESULT_STYLES: Record<StepResultStatus, string> = {
  passed: 'border-primary/40 text-accent-foreground bg-accent',
  failed: 'border-destructive/50 text-destructive',
  blocked: 'border-warning/50 text-warning',
  skipped: 'border-border text-muted-foreground',
  untested: 'border-border text-muted-foreground',
};

/** A result with an icon and its name, so it never depends on color alone. */
export function ResultBadge({
  status,
  className,
}: {
  status: StepResultStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = RESULT_ICONS[status];
  return (
    <Badge variant="outline" className={cn(RESULT_STYLES[status], className)}>
      <Icon className="size-3.5" aria-hidden />
      {t(`runs.itemStatus.${status}`)}
    </Badge>
  );
}

/** The emphasized "Expected" callout used for expected results. */
export function ExpectedResult({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="mt-2 flex items-start gap-2 rounded-md border border-primary/40 bg-accent/60 px-3 py-2 text-sm text-accent-foreground">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <span className="mr-1 font-semibold">{t('steps.expected')}:</span>
        <span className="font-medium">{children}</span>
      </p>
    </div>
  );
}

export type StepMark = 'added' | 'removed' | 'changed';

export interface StepsViewProps {
  steps: TestStep[];
  results?: StepResult[];
  /** Highlights for proposal comparisons. */
  marks?: Record<string, StepMark>;
  emptyText?: string;
  /** Controls after each step (manual runner). */
  renderExtra?: (step: TestStep, index: number) => ReactNode;
  label?: string;
  className?: string;
}

/**
 * Steps in order. Assertions are shown as expected results: a bordered, tinted block with a
 * shield icon and the visible label "Expected", plus any written expected result.
 */
export function StepsView({
  steps,
  results,
  marks,
  emptyText,
  renderExtra,
  label,
  className,
}: StepsViewProps) {
  const { t } = useTranslation();
  const text = useStepText();
  if (steps.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyText ?? t('steps.none')}</p>;
  }
  const resultOf = new Map(results?.map((result) => [result.stepId, result]));
  return (
    <ol aria-label={label ?? t('steps.label')} className={cn('grid gap-2', className)}>
      {steps.map((step, index) => {
        const assertion = isAssertion(step.action);
        const result = resultOf.get(step.id);
        const mark = marks?.[step.id];
        const generated = text.action(step);
        return (
          <li
            key={step.id}
            className={cn(
              'flex gap-3 rounded-lg border bg-card p-3',
              assertion && 'border-l-4 border-l-primary bg-accent/30',
              result?.status === 'failed' && 'border-destructive/60',
              mark === 'added' && 'ring-2 ring-primary/50',
              mark === 'removed' && 'opacity-60 line-through decoration-destructive/60',
              mark === 'changed' && 'ring-2 ring-warning/60',
            )}
          >
            <span
              aria-hidden
              className={cn(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                assertion ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
              )}
            >
              {index + 1}
            </span>
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex flex-wrap items-center gap-2">
                {assertion ? (
                  <Badge className="gap-1 border-primary/40 bg-primary/10 text-accent-foreground uppercase tracking-wide">
                    <ShieldCheck className="size-3.5" aria-hidden />
                    {t('steps.assertion')}
                  </Badge>
                ) : step.action === 'manual' ? (
                  <Badge variant="muted" className="gap-1">
                    <Hand className="size-3.5" aria-hidden />
                    {t('steps.actions.manual')}
                  </Badge>
                ) : null}
                {mark ? (
                  <Badge variant={mark === 'removed' ? 'warning' : 'default'}>
                    {t(`ai.marks.${mark}`)}
                  </Badge>
                ) : null}
                {result ? <ResultBadge status={result.status} /> : null}
                {result?.durationMs !== undefined ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {t('runs.ms', { value: result.durationMs })}
                  </span>
                ) : null}
              </div>
              <p className={cn('text-sm break-words', assertion && 'font-semibold')}>
                <span className="sr-only">{t('steps.number', { number: index + 1 })} </span>
                {step.description || generated}
              </p>
              {step.description && step.action !== 'manual' ? (
                <p className="font-mono text-xs break-words text-muted-foreground">{generated}</p>
              ) : null}
              {step.action === 'manual' && step.value ? (
                <p className="text-xs text-muted-foreground">
                  {t('steps.testData')}: <span className="font-mono">{step.value}</span>
                </p>
              ) : null}
              {step.expected ? <ExpectedResult>{step.expected}</ExpectedResult> : null}
              {result?.error ? (
                <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-destructive/40 bg-destructive/5 p-2 text-xs whitespace-pre-wrap text-destructive">
                  {result.error}
                </pre>
              ) : null}
              {result?.actual ? (
                <p className="text-sm">
                  <span className="font-medium">{t('runs.actual')}:</span> {result.actual}
                </p>
              ) : null}
              {renderExtra?.(step, index)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------------------------

export interface StepsEditorProps {
  steps: TestStep[];
  onChange: (steps: TestStep[]) => void;
  /** Automated test cases and global steps cannot contain manual steps. */
  allowManual: boolean;
  /** Field errors keyed by `steps.<index>.<field>`. */
  errors?: Record<string, string>;
  /** Dataset columns that can be used as {{name}}. */
  variables?: string[];
  /** Extra buttons next to "Add step" (record, import, AI). */
  toolbar?: ReactNode;
  label: string;
}

function emptyStep(action: StepAction): TestStep {
  const rule = STEP_RULES[action];
  return {
    id: newStepId(),
    action,
    ...(rule.target !== 'none' ? { target: { strategy: 'role', value: 'button', name: '' } } : {}),
    ...(rule.value !== 'none' ? { value: '' } : {}),
  } as TestStep;
}

const VALUE_LABELS: Record<NonNullable<(typeof STEP_RULES)[StepAction]['valueKind']>, string> = {
  url: 'steps.fields.url',
  text: 'steps.fields.text',
  key: 'steps.fields.key',
  ms: 'steps.fields.ms',
  count: 'steps.fields.count',
};

function StepRow({
  step,
  index,
  count,
  allowManual,
  errors,
  onChange,
  onMove,
  onDuplicate,
  onRemove,
}: {
  step: TestStep;
  index: number;
  count: number;
  allowManual: boolean;
  errors: Record<string, string>;
  onChange: (step: TestStep) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const ids = useId();
  const rule = STEP_RULES[step.action];
  const assertion = isAssertion(step.action);
  const error = (field: string) => errors[`steps.${index}.${field}`];
  const target = step.target ?? { strategy: 'role' as LocatorStrategy, value: 'button' };
  const setTarget = (patch: Partial<StepLocator>) => {
    const next = { ...target, ...patch } as StepLocator;
    if (next.strategy !== 'role') delete next.name;
    onChange({ ...step, target: next });
  };
  const changeAction = (action: StepAction) => {
    const nextRule = STEP_RULES[action];
    onChange({
      ...step,
      action,
      target: nextRule.target === 'none' ? undefined : (step.target ?? target),
      value: nextRule.value === 'none' ? undefined : (step.value ?? ''),
    });
  };
  const fieldId = (name: string) => `${ids}-${name}`;
  const valueLabel = rule.valueKind
    ? step.action === 'manual'
      ? t('steps.fields.testData')
      : assertion && rule.valueKind === 'text'
        ? t('steps.fields.expectedText')
        : t(VALUE_LABELS[rule.valueKind])
    : null;
  const allErrors = Object.entries(errors).filter(([key]) => key.startsWith(`steps.${index}.`));

  return (
    <li
      className={cn(
        'grid gap-3 rounded-lg border bg-card p-3',
        assertion && 'border-l-4 border-l-primary bg-accent/20',
        allErrors.length > 0 && 'border-destructive/60',
      )}
      aria-label={t('steps.stepLabel', { number: index + 1 })}
    >
      <div className="flex flex-wrap items-end gap-2">
        <span
          aria-hidden
          className={cn(
            'mb-2 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            assertion ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
          )}
        >
          {index + 1}
        </span>
        <div className="grid min-w-44 gap-1">
          <label htmlFor={fieldId('action')} className="text-xs font-medium text-muted-foreground">
            {t('steps.fields.action')}
          </label>
          <NativeSelect
            id={fieldId('action')}
            value={step.action}
            aria-invalid={Boolean(error('action'))}
            onChange={(event) => changeAction(event.target.value as StepAction)}
          >
            <optgroup label={t('steps.groups.actions')}>
              {STEP_ACTIONS.filter((action) => action !== 'manual').map((action) => (
                <option key={action} value={action}>
                  {t(`steps.actions.${action}`)}
                </option>
              ))}
            </optgroup>
            <optgroup label={t('steps.groups.assertions')}>
              {STEP_ASSERTIONS.map((action) => (
                <option key={action} value={action}>
                  {t(`steps.actions.${action}`)}
                </option>
              ))}
            </optgroup>
            {allowManual || step.action === 'manual' ? (
              <optgroup label={t('steps.groups.manual')}>
                <option value="manual">{t('steps.actions.manual')}</option>
              </optgroup>
            ) : null}
          </NativeSelect>
        </div>
        {rule.target !== 'none' ? (
          <>
            <div className="grid min-w-32 gap-1">
              <label
                htmlFor={fieldId('strategy')}
                className="text-xs font-medium text-muted-foreground"
              >
                {t('steps.fields.locator')}
              </label>
              <NativeSelect
                id={fieldId('strategy')}
                value={target.strategy}
                onChange={(event) => {
                  const strategy = event.target.value as LocatorStrategy;
                  setTarget({
                    strategy,
                    value:
                      strategy === 'role'
                        ? 'button'
                        : target.strategy === 'role'
                          ? ''
                          : target.value,
                  });
                }}
              >
                {LOCATOR_STRATEGIES.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {t(`steps.strategies.${strategy}`)}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {target.strategy === 'role' ? (
              <>
                <div className="grid min-w-32 gap-1">
                  <label
                    htmlFor={fieldId('role')}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t('steps.fields.role')}
                  </label>
                  <NativeSelect
                    id={fieldId('role')}
                    value={target.value}
                    onChange={(event) => setTarget({ value: event.target.value })}
                  >
                    {ARIA_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <div className="grid min-w-40 flex-1 gap-1">
                  <label
                    htmlFor={fieldId('name')}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {t('steps.fields.name')}
                  </label>
                  <Input
                    id={fieldId('name')}
                    value={target.name ?? ''}
                    placeholder={t('steps.fields.namePlaceholder')}
                    onChange={(event) => setTarget({ name: event.target.value })}
                  />
                </div>
              </>
            ) : (
              <div className="grid min-w-48 flex-1 gap-1">
                <label
                  htmlFor={fieldId('target')}
                  className="text-xs font-medium text-muted-foreground"
                >
                  {t(`steps.strategies.${target.strategy}`)}
                </label>
                <Input
                  id={fieldId('target')}
                  value={target.value}
                  className={cn(target.strategy === 'css' && 'font-mono')}
                  aria-invalid={Boolean(error('target.value') ?? error('target'))}
                  onChange={(event) => setTarget({ value: event.target.value })}
                />
              </div>
            )}
            <div className="grid w-20 gap-1">
              <label htmlFor={fieldId('nth')} className="text-xs font-medium text-muted-foreground">
                {t('steps.fields.nth')}
              </label>
              <Input
                id={fieldId('nth')}
                type="number"
                min={1}
                value={target.nth === undefined ? '' : target.nth + 1}
                onChange={(event) =>
                  setTarget({
                    nth:
                      event.target.value === ''
                        ? undefined
                        : Math.max(0, Number(event.target.value) - 1),
                  })
                }
              />
            </div>
            {target.strategy !== 'testId' && target.strategy !== 'css' ? (
              <label className="mb-2 flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={Boolean(target.exact)}
                  onChange={(event) => setTarget({ exact: event.target.checked || undefined })}
                />
                {t('steps.fields.exact')}
              </label>
            ) : null}
          </>
        ) : null}
        {valueLabel ? (
          <div className="grid min-w-40 flex-1 gap-1">
            <label htmlFor={fieldId('value')} className="text-xs font-medium text-muted-foreground">
              {valueLabel}
            </label>
            <Input
              id={fieldId('value')}
              value={step.value ?? ''}
              inputMode={
                rule.valueKind === 'ms' || rule.valueKind === 'count' ? 'numeric' : undefined
              }
              placeholder={
                rule.valueKind === 'url' ? '/cart' : rule.valueKind === 'key' ? 'Enter' : undefined
              }
              aria-invalid={Boolean(error('value'))}
              onChange={(event) => onChange({ ...step, value: event.target.value })}
            />
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('steps.moveUp', { number: index + 1 })}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            <ArrowUp />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('steps.moveDown', { number: index + 1 })}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            <ArrowDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('steps.duplicate', { number: index + 1 })}
            onClick={onDuplicate}
          >
            <Copy />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('steps.remove', { number: index + 1 })}
            onClick={onRemove}
          >
            <Trash2 />
          </Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1">
          <label
            htmlFor={fieldId('description')}
            className="text-xs font-medium text-muted-foreground"
          >
            {step.action === 'manual'
              ? t('steps.fields.instruction')
              : t('steps.fields.description')}
          </label>
          <Textarea
            id={fieldId('description')}
            className="min-h-9"
            rows={1}
            value={step.description ?? ''}
            aria-invalid={Boolean(error('description'))}
            onChange={(event) => onChange({ ...step, description: event.target.value })}
          />
        </div>
        <div className="grid gap-1">
          <label
            htmlFor={fieldId('expected')}
            className="flex items-center gap-1 text-xs font-medium text-accent-foreground"
          >
            <ShieldCheck className="size-3.5" aria-hidden />
            {t('steps.fields.expected')}
          </label>
          <Textarea
            id={fieldId('expected')}
            className="min-h-9 border-primary/40"
            rows={1}
            value={step.expected ?? ''}
            onChange={(event) => onChange({ ...step, expected: event.target.value })}
          />
        </div>
      </div>
      {allErrors.length ? (
        <ul role="alert" className="grid gap-0.5 text-sm text-destructive">
          {[...new Set(allErrors.map(([, message]) => message))].map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function StepsEditor({
  steps,
  onChange,
  allowManual,
  errors = {},
  variables = [],
  toolbar,
  label,
}: StepsEditorProps) {
  const { t } = useTranslation();
  const update = (index: number, step: TestStep) =>
    onChange(steps.map((current, i) => (i === index ? step : current)));
  const move = (index: number, delta: number) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    next.splice(index + delta, 0, step!);
    onChange(next);
  };
  return (
    <div className="grid gap-3">
      {steps.length ? (
        <ol aria-label={label} className="grid gap-3">
          {steps.map((step, index) => (
            <StepRow
              key={step.id}
              step={step}
              index={index}
              count={steps.length}
              allowManual={allowManual}
              errors={errors}
              onChange={(next) => update(index, next)}
              onMove={(delta) => move(index, delta)}
              onDuplicate={() =>
                onChange([
                  ...steps.slice(0, index + 1),
                  { ...step, id: newStepId() },
                  ...steps.slice(index + 1),
                ])
              }
              onRemove={() => onChange(steps.filter((_, i) => i !== index))}
            />
          ))}
        </ol>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
          {t('steps.emptyEditor')}
        </p>
      )}
      {variables.length ? (
        <p className="text-xs text-muted-foreground">
          {t('steps.variablesHint')}{' '}
          {variables.map((name) => (
            <code key={name} className="mr-1 rounded bg-muted px-1 font-mono">{`{{${name}}}`}</code>
          ))}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, emptyStep(allowManual ? 'manual' : 'click')])}
        >
          <MousePointerClick /> {t('steps.addStep')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...steps, emptyStep('expectVisible')])}
        >
          <ListChecks /> {t('steps.addAssertion')}
        </Button>
        {allowManual ? null : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onChange([...steps, emptyStep('goto')])}
          >
            <Plus /> {t('steps.addNavigation')}
          </Button>
        )}
        {toolbar}
      </div>
    </div>
  );
}

/** Marks for comparing proposed steps with current ones (by step id). */
export function stepMarks(current: TestStep[], proposed: TestStep[]) {
  const before = new Map(current.map((step) => [step.id, JSON.stringify(step)]));
  const proposedMarks: Record<string, StepMark> = {};
  for (const step of proposed) {
    const previous = before.get(step.id);
    if (previous === undefined) proposedMarks[step.id] = 'added';
    else if (previous !== JSON.stringify(step)) proposedMarks[step.id] = 'changed';
  }
  const proposedIds = new Set(proposed.map((step) => step.id));
  const removed = current.filter((step) => !proposedIds.has(step.id));
  return { proposedMarks, removed };
}
