import {
  commentInputSchema,
  COMMENT_MAX,
  requirementLinkInputSchema,
  requirementLinkText,
  type RequirementLink,
  type ScenarioComment,
} from '@testrex/contracts';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
} from '@testrex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Link2, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '../../components/common';
import { MarkdownView } from '../../components/editor/RichText';
import { RelativeTime, userName } from '../../components/scenario-ui';
import { api, errorMessage, isApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/i18n';
import {
  commentsQuery,
  invalidateScenarios,
  keys,
  linksQuery,
  scenarioApi,
} from '../../lib/queries';
import { validate, type FieldErrors } from '../../lib/validation';

interface ScenarioRef {
  orgSlug: string;
  appKey: string;
  scenarioKey: string;
}

function CommentEditor({
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
  pending,
  resolveImageSrc,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (body: string) => Promise<unknown>;
  onCancel?: () => void;
  pending: boolean;
  resolveImageSrc: (src: string) => string;
}) {
  const { t } = useTranslation();
  const [body, setBody] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('write');
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const result = validate(commentInputSchema, { body });
    if (result.errors) return setError(result.errors.body ?? null);
    setError(null);
    await onSubmit(result.data.body);
    setBody('');
    setTab('write');
  };
  return (
    <form onSubmit={submit} className="grid gap-2">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="write">{t('comments.write')}</TabsTrigger>
          <TabsTrigger value="preview">{t('comments.preview')}</TabsTrigger>
        </TabsList>
        <TabsContent value="write" className="mt-2">
          <Field
            label={t('comments.label')}
            error={error ?? undefined}
            className="[&>label]:sr-only"
          >
            {(control) => (
              <Textarea
                {...control}
                value={body}
                maxLength={COMMENT_MAX}
                placeholder={t('comments.placeholder')}
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void submit();
                }}
              />
            )}
          </Field>
        </TabsContent>
        <TabsContent value="preview" className="mt-2 min-h-20 rounded-md border px-3 py-2">
          <MarkdownView
            markdown={body}
            resolveImageSrc={resolveImageSrc}
            emptyText={t('comments.nothingToPreview')}
          />
        </TabsContent>
      </Tabs>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export function CommentsThread({
  orgSlug,
  appKey,
  scenarioKey,
  canComment,
  canModerate,
  currentUserId,
  resolveImageSrc,
}: ScenarioRef & {
  canComment: boolean;
  canModerate: boolean;
  currentUserId: string;
  resolveImageSrc: (src: string) => string;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const comments = useQuery(commentsQuery(orgSlug, appKey, scenarioKey));
  const [editing, setEditing] = useState<string | null>(null);
  const base = `${scenarioApi(orgSlug, appKey, scenarioKey)}/comments`;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: keys.scenario(orgSlug, appKey, scenarioKey) });

  const add = useMutation({
    mutationFn: (body: string) => api.post<ScenarioComment>(base, { body }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.patch<ScenarioComment>(`${base}/${id}`, { body }),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onSuccess: async () => {
      toast.success(t('comments.deleted'));
      await refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = comments.data ?? [];
  return (
    <section aria-labelledby="comments-heading" className="grid gap-4">
      <h2 id="comments-heading" className="flex items-center gap-2 text-base font-semibold">
        <MessageSquare className="size-4" aria-hidden /> {t('comments.title')}
        {items.length ? (
          <span className="text-sm font-normal text-muted-foreground">({items.length})</span>
        ) : null}
      </h2>
      {comments.isError ? (
        <Alert variant="destructive">{errorMessage(comments.error)}</Alert>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('comments.empty')}</p>
      ) : (
        <ol className="grid gap-3" aria-label={t('comments.title')}>
          {items.map((comment) => {
            const own = comment.author.id === currentUserId;
            return (
              <li key={comment.id} className="rounded-lg border bg-card p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{userName(comment.author)}</span>
                  <RelativeTime value={comment.createdAt} />
                  <Badge variant="muted">
                    {t('comments.onRevision', { number: comment.revision })}
                  </Badge>
                  {comment.editedAt ? (
                    <Tooltip content={formatDateTime(comment.editedAt)}>
                      <span tabIndex={0} className="text-xs text-muted-foreground">
                        ({t('comments.edited')})
                      </span>
                    </Tooltip>
                  ) : null}
                  <span className="flex-1" />
                  {own && canComment && editing !== comment.id ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('comments.edit')}
                      onClick={() => setEditing(comment.id)}
                    >
                      <Pencil />
                    </Button>
                  ) : null}
                  {(own && canComment) || canModerate ? (
                    <ConfirmButton
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('comments.delete')}
                      title={t('comments.deleteTitle')}
                      description={t('comments.deleteBody')}
                      confirmLabel={t('comments.delete')}
                      onConfirm={() => remove.mutate(comment.id)}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  ) : null}
                </div>
                {editing === comment.id ? (
                  <CommentEditor
                    initial={comment.body}
                    submitLabel={t('common.save')}
                    pending={edit.isPending}
                    onSubmit={(body) => edit.mutateAsync({ id: comment.id, body })}
                    onCancel={() => setEditing(null)}
                    resolveImageSrc={resolveImageSrc}
                  />
                ) : (
                  <MarkdownView markdown={comment.body} resolveImageSrc={resolveImageSrc} />
                )}
              </li>
            );
          })}
        </ol>
      )}
      {canComment ? (
        <CommentEditor
          submitLabel={t('comments.add')}
          pending={add.isPending}
          onSubmit={(body) => add.mutateAsync(body)}
          resolveImageSrc={resolveImageSrc}
        />
      ) : null}
    </section>
  );
}

function LinkForm({
  initial,
  onSubmit,
  onCancel,
  pending,
}: {
  initial?: { url: string; label: string | null };
  onSubmit: (value: { url: string; label: string | null }) => Promise<unknown>;
  onCancel: () => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState(initial?.url ?? '');
  const [label, setLabel] = useState(initial?.label ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validate(requirementLinkInputSchema, { url, label });
    if (result.errors) return setErrors(result.errors);
    try {
      await onSubmit(result.data);
    } catch (error) {
      if (isApiError(error, 409)) setErrors({ url: errorMessage(error) });
      else if (isApiError(error, 400)) setErrors({ url: t('validation.url.httpOnly') });
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-md border p-3" noValidate>
      <Field label={t('links.url')} error={errors.url}>
        {(control) => (
          <Input
            {...control}
            type="url"
            value={url}
            placeholder="https://"
            autoFocus
            onChange={(event) => setUrl(event.target.value)}
          />
        )}
      </Field>
      <Field label={t('links.label')} error={errors.label}>
        {(control) => (
          <Input {...control} value={label} onChange={(event) => setLabel(event.target.value)} />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {t('common.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}

export function LinksPanel({
  orgSlug,
  appKey,
  scenarioKey,
  canWrite,
}: ScenarioRef & { canWrite: boolean }) {
  const { t } = useTranslation();
  const links = useQuery(linksQuery(orgSlug, appKey, scenarioKey));
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const base = `${scenarioApi(orgSlug, appKey, scenarioKey)}/links`;
  const refresh = () => invalidateScenarios(orgSlug, appKey);

  const add = useMutation({
    mutationFn: (value: { url: string; label: string | null }) =>
      api.post<RequirementLink>(base, value),
    onSuccess: async () => {
      setAdding(false);
      await refresh();
    },
  });
  const edit = useMutation({
    mutationFn: ({ id, ...value }: { id: string; url: string; label: string | null }) =>
      api.patch<RequirementLink>(`${base}/${id}`, value),
    onSuccess: async () => {
      setEditing(null);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`${base}/${id}`),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const items = links.data ?? [];
  return (
    <section aria-labelledby="links-heading" className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="links-heading" className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="size-4" aria-hidden /> {t('links.title')}
        </h2>
        {canWrite && !adding ? (
          <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
            <Plus /> {t('links.add')}
          </Button>
        ) : null}
      </div>
      {adding ? (
        <LinkForm
          pending={add.isPending}
          onSubmit={(value) => add.mutateAsync(value)}
          onCancel={() => setAdding(false)}
        />
      ) : null}
      {items.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">{t('links.empty')}</p>
      ) : (
        <ul className="grid gap-2" aria-label={t('links.title')}>
          {items.map((link) => {
            const text = requirementLinkText(link);
            return editing === link.id ? (
              <li key={link.id}>
                <LinkForm
                  initial={link}
                  pending={edit.isPending}
                  onSubmit={(value) => edit.mutateAsync({ id: link.id, ...value })}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={link.id} className="flex items-start gap-2 text-sm">
                <div className="grid min-w-0 flex-1">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                  >
                    <span className="truncate">{text}</span>
                    <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                    <span className="sr-only">{t('links.opensNewTab')}</span>
                  </a>
                  {link.provider !== 'other' && link.label ? (
                    <span className="truncate text-xs text-muted-foreground">{link.label}</span>
                  ) : null}
                </div>
                {canWrite ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('links.edit', { name: text })}
                      onClick={() => setEditing(link.id)}
                    >
                      <Pencil />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      aria-label={t('links.remove', { name: text })}
                      title={t('links.removeTitle')}
                      confirmLabel={t('common.remove')}
                      onConfirm={() => remove.mutate(link.id)}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
