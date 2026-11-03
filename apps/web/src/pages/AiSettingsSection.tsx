// Organization LLM provider (bring your own key). The key is write-only: it is never shown.
import {
  DEFAULT_LLM_MODELS,
  LLM_PROVIDERS,
  type LlmProvider,
  type LlmSettings,
  type LlmTestResult,
} from '@testrex/contracts';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Input,
  NativeSelect,
  Skeleton,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, PlugZap, Save, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '../components/common';
import { RelativeTime, userName } from '../components/scenario-ui';
import { api, errorMessage, isApiError } from '../lib/api';
import i18n from '../lib/i18n';
import { llmSettingsQuery, testKeys } from '../lib/queries';

function SettingsForm({ orgSlug, current }: { orgSlug: string; current: LlmSettings | null }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<LlmProvider>(current?.provider ?? 'anthropic');
  const [model, setModel] = useState(current?.model ?? DEFAULT_LLM_MODELS.anthropic);
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [test, setTest] = useState<LlmTestResult | null>(null);
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: testKeys.llmSettings(orgSlug) }),
      queryClient.invalidateQueries({ queryKey: testKeys.aiStatus(orgSlug) }),
    ]);
  const save = useMutation({
    mutationFn: () =>
      api.put<LlmSettings>(`/api/orgs/${orgSlug}/llm`, {
        provider,
        model,
        baseUrl,
        ...(apiKey ? { apiKey } : {}),
        clearKey,
      }),
    onSuccess: async () => {
      setApiKey('');
      setClearKey(false);
      setErrors({});
      await refresh();
      toast.success(t('aiSettings.saved'));
    },
    onError: (error) => {
      if (isApiError(error, 400) && Array.isArray(error.body.issues)) {
        const next: Record<string, string> = {};
        for (const issue of error.body.issues as { path: string; message: string }[]) {
          const key = `validation.${issue.message}`;
          next[issue.path] = i18n.exists(key) ? t(key) : errorMessage(error);
        }
        setErrors(next);
        return;
      }
      toast.error(errorMessage(error));
    },
  });
  const check = useMutation({
    mutationFn: () => api.post<LlmTestResult>(`/api/orgs/${orgSlug}/llm/test`),
    onSuccess: setTest,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/orgs/${orgSlug}/llm`),
    onSuccess: async () => {
      await refresh();
      toast.success(t('aiSettings.removed'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('aiSettings.provider')}>
          {(control) => (
            <NativeSelect
              {...control}
              value={provider}
              onChange={(event) => {
                const next = event.target.value as LlmProvider;
                setProvider(next);
                if (!model || Object.values(DEFAULT_LLM_MODELS).includes(model))
                  setModel(DEFAULT_LLM_MODELS[next]);
              }}
            >
              {LLM_PROVIDERS.map((name) => (
                <option key={name} value={name}>
                  {t(`aiSettings.providers.${name}`)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field
          label={t('aiSettings.model')}
          hint={t(`aiSettings.modelHints.${provider}`)}
          error={errors.model}
        >
          {(control) => (
            <Input {...control} value={model} onChange={(event) => setModel(event.target.value)} />
          )}
        </Field>
      </div>
      {provider === 'openai_compatible' ? (
        <Field
          label={t('aiSettings.baseUrl')}
          hint={t('aiSettings.baseUrlHint')}
          error={errors.baseUrl}
        >
          {(control) => (
            <Input
              {...control}
              type="url"
              value={baseUrl}
              placeholder="http://ollama:11434/v1"
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          )}
        </Field>
      ) : null}
      <Field
        label={t('aiSettings.apiKey')}
        hint={current?.hasKey ? t('aiSettings.keySaved') : t('aiSettings.keyHint')}
        error={errors.apiKey}
      >
        {(control) => (
          <Input
            {...control}
            type="password"
            autoComplete="off"
            value={apiKey}
            placeholder={current?.hasKey ? '••••••••••••' : ''}
            onChange={(event) => setApiKey(event.target.value)}
          />
        )}
      </Field>
      {current?.hasKey && provider === 'openai_compatible' ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-primary"
            checked={clearKey}
            onChange={(event) => setClearKey(event.target.checked)}
          />
          {t('aiSettings.clearKey')}
        </label>
      ) : null}
      {test ? (
        <Alert variant={test.ok ? 'info' : 'destructive'}>
          {test.ok ? <CheckCircle2 aria-hidden /> : <XCircle aria-hidden />}
          <span>
            {test.ok
              ? t('aiSettings.testOk', { model: test.model, answer: test.message })
              : t('aiSettings.testFailed', { message: test.message })}
          </span>
        </Alert>
      ) : null}
      {current ? (
        <p className="text-xs text-muted-foreground">
          {t('automation.lastChange', { name: userName(current.updatedBy) })}{' '}
          <RelativeTime value={current.updatedAt} />
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>
          <Save /> {t('common.save')}
        </Button>
        {current ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              <PlugZap /> {t('aiSettings.test')}
            </Button>
            <ConfirmButton
              variant="ghost"
              title={t('aiSettings.removeTitle')}
              description={t('aiSettings.removeBody')}
              confirmLabel={t('aiSettings.remove')}
              onConfirm={() => remove.mutate()}
            >
              <Trash2 /> {t('aiSettings.remove')}
            </ConfirmButton>
          </>
        ) : null}
      </div>
    </form>
  );
}

export function AiSettingsSection({ orgSlug }: { orgSlug: string }) {
  const { t } = useTranslation();
  const settings = useQuery(llmSettingsQuery(orgSlug));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5" aria-hidden /> {t('aiSettings.title')}
        </CardTitle>
        <CardDescription>{t('aiSettings.body')}</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending ? (
          <Skeleton className="h-48" />
        ) : settings.isError ? (
          <Alert variant="destructive">{errorMessage(settings.error)}</Alert>
        ) : (
          <SettingsForm
            key={settings.data?.updatedAt ?? 'new'}
            orgSlug={orgSlug}
            current={settings.data ?? null}
          />
        )}
      </CardContent>
    </Card>
  );
}
