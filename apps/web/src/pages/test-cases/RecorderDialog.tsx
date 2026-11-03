// Records steps: a live view of a browser running in the worker (click, type and assert on the
// screenshot), or code recorded locally with `npx playwright codegen`, converted into steps.
import {
  parsePlaywrightCode,
  relativizeSteps,
  type ImportResult,
  type RecordingCommand,
  type RecordingSession,
  type TestStep,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  cn,
} from '@testrex/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  CircleStop,
  FileCode,
  Globe,
  Heading,
  Loader2,
  MousePointer2,
  Play,
  ShieldCheck,
} from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { CopyField } from '../../components/common';
import { StepsView, useStepText } from '../../components/steps';
import { api, errorMessage } from '../../lib/api';
import { appApi, automationQuery, recordingQuery } from '../../lib/queries';

type ApplyMode = 'append' | 'replace';

export interface RecorderDialogProps {
  orgSlug: string;
  appKey: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hasSteps: boolean;
  onApply: (steps: TestStep[], mode: ApplyMode) => void;
}

const LIVE = new Set(['starting', 'active']);
const SPECIAL_KEYS = new Set([
  'Enter',
  'Backspace',
  'Delete',
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

function ApplyButtons({
  steps,
  hasSteps,
  onApply,
}: {
  steps: TestStep[];
  hasSteps: boolean;
  onApply: (steps: TestStep[], mode: ApplyMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {hasSteps ? (
        <Button
          variant="outline"
          disabled={steps.length === 0}
          onClick={() => onApply(steps, 'replace')}
        >
          {t('recorder.replace')}
        </Button>
      ) : null}
      <Button disabled={steps.length === 0} onClick={() => onApply(steps, 'append')}>
        {hasSteps
          ? t('recorder.append', { count: steps.length })
          : t('recorder.use', { count: steps.length })}
      </Button>
    </div>
  );
}

function LiveRecorder({
  orgSlug,
  appKey,
  hasSteps,
  onApply,
  sessionId,
  setSessionId,
}: Omit<RecorderDialogProps, 'open' | 'onOpenChange'> & {
  sessionId: string | null;
  setSessionId: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const describe = useStepText();
  const settings = useQuery(automationQuery(orgSlug, appKey)).data;
  // Until the tester types, the start URL follows the application's base URL.
  const [typedStartUrl, setStartUrl] = useState<string | null>(null);
  const startUrl = typedStartUrl ?? settings?.baseUrl ?? '';
  const [mode, setMode] = useState<'interact' | 'assert'>('interact');
  const [address, setAddress] = useState('');
  const queue = useRef(Promise.resolve());
  const typed = useRef('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrolled = useRef(0);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const base = `${appApi(orgSlug, appKey)}/recordings`;
  const session = useQuery({
    ...recordingQuery(orgSlug, appKey, sessionId ?? ''),
    enabled: Boolean(sessionId),
  }).data as RecordingSession | undefined;
  const live = session ? LIVE.has(session.status) : false;

  const [lastUrl, setLastUrl] = useState<string | null>(null);
  if (session?.url && session.url !== lastUrl) {
    setLastUrl(session.url);
    setAddress(session.url);
  }

  const start = useMutation({
    mutationFn: () => api.post<RecordingSession>(base, { startUrl }),
    onSuccess: (created) => setSessionId(created.id),
    onError: (error) => toast.error(errorMessage(error)),
  });

  /** Commands go out one after another, in the order people made them. */
  const send = (command: RecordingCommand) => {
    if (!sessionId) return;
    queue.current = queue.current
      .then(() => api.post(`${base}/${sessionId}/commands`, command))
      .then(() => undefined)
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
      });
  };
  const flushTyping = () => {
    clearTimeout(typingTimer.current);
    if (typed.current) send({ type: 'type', text: typed.current });
    typed.current = '';
  };
  const stop = useMutation({
    mutationFn: async () => {
      flushTyping();
      await queue.current;
      return api.post<RecordingSession>(`${base}/${sessionId}/stop`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const point = (event: MouseEvent<HTMLImageElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const width = session?.viewport.width ?? rect.width;
    const height = session?.viewport.height ?? rect.height;
    return {
      x: Math.max(0, Math.round(((event.clientX - rect.left) * width) / rect.width)),
      y: Math.max(0, Math.round(((event.clientY - rect.top) * height) / rect.height)),
    };
  };
  const onClick = (event: MouseEvent<HTMLImageElement>) => {
    if (!live || !session?.canDrive || event.detail > 1) return;
    flushTyping();
    send({ type: mode === 'assert' ? 'inspect' : 'click', ...point(event) });
    event.currentTarget.parentElement?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!live || !session?.canDrive || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key.length === 1) {
      event.preventDefault();
      typed.current += event.key;
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(flushTyping, 350);
      return;
    }
    if (SPECIAL_KEYS.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      flushTyping();
      send({ type: 'press', key: event.key });
    }
  };
  const onWheel = (event: React.WheelEvent) => {
    if (!live || !session?.canDrive) return;
    scrolled.current += event.deltaY;
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const deltaY = Math.max(-5000, Math.min(5000, Math.round(scrolled.current)));
      scrolled.current = 0;
      if (deltaY) send({ type: 'scroll', deltaY });
    }, 150);
  };

  if (!sessionId) {
    return (
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          start.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">{t('recorder.liveIntro')}</p>
        <label htmlFor="recorder-start" className="text-sm font-medium">
          {t('recorder.startUrl')}
        </label>
        <div className="flex gap-2">
          <Input
            id="recorder-start"
            type="url"
            required
            value={startUrl}
            placeholder="https://shop.example.com"
            onChange={(event) => setStartUrl(event.target.value)}
          />
          <Button type="submit" disabled={start.isPending || !startUrl}>
            <Play /> {t('recorder.start')}
          </Button>
        </div>
      </form>
    );
  }

  const element = session?.element;
  const frameUrl =
    session && session.frameVersion > 0
      ? `${base}/${sessionId}/frame?v=${session.frameVersion}`
      : null;
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="grid content-start gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex min-w-60 flex-1 gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (address) send({ type: 'navigate', url: address });
            }}
          >
            <Globe className="mt-2.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <Input
              aria-label={t('recorder.address')}
              value={address}
              disabled={!live || !session?.canDrive}
              onChange={(event) => setAddress(event.target.value)}
            />
          </form>
          <div role="group" aria-label={t('recorder.modeLabel')} className="flex gap-1">
            <Button
              size="sm"
              variant={mode === 'interact' ? 'default' : 'outline'}
              aria-pressed={mode === 'interact'}
              onClick={() => setMode('interact')}
            >
              <MousePointer2 /> {t('recorder.interact')}
            </Button>
            <Button
              size="sm"
              variant={mode === 'assert' ? 'default' : 'outline'}
              aria-pressed={mode === 'assert'}
              onClick={() => setMode('assert')}
            >
              <ShieldCheck /> {t('recorder.assertMode')}
            </Button>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!live}
            onClick={() => send({ type: 'assert', assertion: 'expectUrl' })}
          >
            <Globe /> {t('recorder.assertUrl')}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!live}
            onClick={() => send({ type: 'assert', assertion: 'expectTitle' })}
          >
            <Heading /> {t('recorder.assertTitle')}
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={!live || stop.isPending}
            onClick={() => stop.mutate()}
          >
            <CircleStop /> {t('recorder.stop')}
          </Button>
        </div>
        <div
          tabIndex={0}
          role="application"
          aria-label={t('recorder.viewLabel')}
          aria-describedby="recorder-help"
          onKeyDown={onKeyDown}
          onWheel={onWheel}
          className={cn(
            'relative overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            mode === 'assert' && 'ring-2 ring-primary/60',
          )}
          style={{
            aspectRatio: session
              ? `${session.viewport.width} / ${session.viewport.height}`
              : '16 / 9',
          }}
        >
          {frameUrl ? (
            <img
              src={frameUrl}
              alt={t('recorder.frameAlt', { title: session?.title ?? '' })}
              draggable={false}
              onClick={onClick}
              className={cn(
                'size-full select-none object-contain',
                live && session?.canDrive && 'cursor-crosshair',
              )}
            />
          ) : (
            <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('recorder.starting')}
            </div>
          )}
          {element ? (
            <span
              aria-hidden
              className="pointer-events-none absolute border-2 border-primary bg-primary/10"
              style={{
                left: `${(element.box.x / (session?.viewport.width ?? 1)) * 100}%`,
                top: `${(element.box.y / (session?.viewport.height ?? 1)) * 100}%`,
                width: `${(element.box.width / (session?.viewport.width ?? 1)) * 100}%`,
                height: `${(element.box.height / (session?.viewport.height ?? 1)) * 100}%`,
              }}
            />
          ) : null}
        </div>
        <p id="recorder-help" className="text-xs text-muted-foreground">
          {t('recorder.help')}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
          <Badge variant={live ? 'default' : 'muted'}>
            {t(`recorder.status.${session?.status ?? 'starting'}`)}
          </Badge>
          {session?.pendingCommands ? (
            <span className="text-muted-foreground">
              {t('recorder.pending', { count: session.pendingCommands })}
            </span>
          ) : null}
          {session?.error ? <span className="text-destructive">{session.error}</span> : null}
        </p>
      </div>
      <aside className="grid content-start gap-3" aria-label={t('recorder.sidebar')}>
        {element ? (
          <div className="grid gap-2 rounded-lg border bg-card p-3">
            <p className="text-xs font-medium text-muted-foreground">{t('recorder.element')}</p>
            <p className="text-sm font-medium break-words">{describe.locator(element.locator)}</p>
            {element.options ? (
              <div className="grid gap-1">
                <p className="text-xs text-muted-foreground">{t('recorder.chooseOption')}</p>
                {element.options.map((option) => (
                  <Button
                    key={option.value}
                    size="sm"
                    variant="outline"
                    className="justify-start"
                    onClick={() => send({ type: 'select', value: option.value })}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">{t('recorder.addAssertion')}</p>
            <div className="flex flex-wrap gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => send({ type: 'assert', assertion: 'expectVisible' })}
              >
                {t('steps.actions.expectVisible')}
              </Button>
              {element.text ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: 'assert', assertion: 'expectText' })}
                >
                  {t('steps.actions.expectText')}
                </Button>
              ) : null}
              {element.value !== null ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: 'assert', assertion: 'expectValue' })}
                >
                  {t('steps.actions.expectValue')}
                </Button>
              ) : null}
              {element.checked ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => send({ type: 'assert', assertion: 'expectChecked' })}
                >
                  {t('steps.actions.expectChecked')}
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
        <div className="grid gap-2">
          <p className="text-sm font-medium">
            {t('recorder.recordedSteps', { count: session?.steps.length ?? 0 })}
          </p>
          <div className="max-h-96 overflow-y-auto pr-1">
            <StepsView steps={session?.steps ?? []} emptyText={t('recorder.noSteps')} />
          </div>
        </div>
        <ApplyButtons steps={session?.steps ?? []} hasSteps={hasSteps} onApply={onApply} />
      </aside>
    </div>
  );
}

function CodeImport({
  hasSteps,
  onApply,
  baseUrl,
}: {
  hasSteps: boolean;
  onApply: (steps: TestStep[], mode: ApplyMode) => void;
  baseUrl: string | null;
}) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">{t('recorder.importIntro')}</p>
      <CopyField
        label={t('recorder.codegenCommand')}
        value={`npx playwright codegen ${baseUrl ?? 'https://your-app.example.com'}`}
      />
      <label htmlFor="recorder-code" className="text-sm font-medium">
        {t('recorder.code')}
      </label>
      <Textarea
        id="recorder-code"
        className="min-h-48 font-mono text-xs"
        value={code}
        spellCheck={false}
        placeholder={
          "await page.goto('https://…');\nawait page.getByRole('button', { name: 'Sign in' }).click();"
        }
        onChange={(event) => {
          setCode(event.target.value);
          setResult(null);
        }}
      />
      <div>
        <Button
          variant="outline"
          disabled={!code.trim()}
          onClick={() => {
            const parsed = parsePlaywrightCode(code);
            setResult({ ...parsed, steps: relativizeSteps(parsed.steps, baseUrl) });
          }}
        >
          <FileCode /> {t('recorder.convert')}
        </Button>
      </div>
      {result ? (
        <div className="grid gap-3">
          {result.warnings.length ? (
            <Alert variant="warning" className="grid gap-1">
              <p className="font-medium">
                {t('recorder.warnings', { count: result.warnings.length })}
              </p>
              <ul className="grid gap-1">
                {result.warnings.map((warning) => (
                  <li key={`${warning.line}-${warning.text}`} className="text-xs">
                    {t('recorder.warningLine', {
                      line: warning.line,
                      reason: t(`recorder.reasons.${warning.reason}`),
                    })}{' '}
                    <code className="font-mono break-all">{warning.text}</code>
                  </li>
                ))}
              </ul>
            </Alert>
          ) : null}
          <StepsView steps={result.steps} emptyText={t('recorder.noSteps')} />
          <ApplyButtons steps={result.steps} hasSteps={hasSteps} onApply={onApply} />
        </div>
      ) : null}
    </div>
  );
}

export function RecorderDialog({
  orgSlug,
  appKey,
  open,
  onOpenChange,
  hasSteps,
  onApply,
}: RecorderDialogProps) {
  const { t } = useTranslation();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const settings = useQuery(automationQuery(orgSlug, appKey)).data;
  const close = (next: boolean) => {
    if (!next && sessionId) {
      // Leaving the dialog ends the recording; the steps stay in the session until then.
      void api.post(`${appApi(orgSlug, appKey)}/recordings/${sessionId}/stop`).catch(() => {});
      setSessionId(null);
    }
    onOpenChange(next);
  };
  const apply = (steps: TestStep[], mode: ApplyMode) => {
    onApply(steps, mode);
    close(false);
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[92vh] max-w-6xl overflow-y-auto"
        closeLabel={t('common.close')}
      >
        <DialogHeader>
          <DialogTitle>{t('recorder.title')}</DialogTitle>
          <DialogDescription>{t('recorder.description')}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="live">
          <TabsList>
            <TabsTrigger value="live">{t('recorder.live')}</TabsTrigger>
            <TabsTrigger value="import">{t('recorder.import')}</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="mt-4">
            <LiveRecorder
              orgSlug={orgSlug}
              appKey={appKey}
              hasSteps={hasSteps}
              onApply={apply}
              sessionId={sessionId}
              setSessionId={setSessionId}
            />
          </TabsContent>
          <TabsContent value="import" className="mt-4">
            <CodeImport hasSteps={hasSteps} onApply={apply} baseUrl={settings?.baseUrl ?? null} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
