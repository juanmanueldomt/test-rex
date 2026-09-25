import type { Attachment } from '@testrex/contracts';
import { Alert, Button, cn } from '@testrex/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, File as FileIcon, ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useCallback, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { ConfirmButton } from '../../components/common';
import { formatBytes, RelativeTime, userName } from '../../components/scenario-ui';
import { api, errorMessage, isApiError, uploadFile } from '../../lib/api';
import {
  appApi,
  attachmentLimitsQuery,
  attachmentsQuery,
  invalidateScenarios,
  keys,
  scenarioApi,
} from '../../lib/queries';

function uploadError(error: unknown, file: File, t: TFunction) {
  if (isApiError(error) && error.code === 'FILE_TOO_LARGE') {
    return t('attachments.tooLarge', {
      name: file.name,
      limit: formatBytes(Number(error.body.maxBytes)),
    });
  }
  return `${t('attachments.failed', { name: file.name })} ${errorMessage(error)}`;
}

/**
 * Uploads a file for a scenario, or as a pending upload (new-scenario form) when there is no
 * scenario yet. Returns the attachment; failures are reported to the user and rethrown.
 */
export function useAttachmentUpload(orgSlug: string, appKey: string, scenarioKey?: string) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const limits = useQuery(attachmentLimitsQuery(orgSlug, appKey)).data;
  return useCallback(
    async (file: File, onProgress?: (fraction: number) => void): Promise<Attachment> => {
      if (limits && file.size > limits.maxBytes) {
        const message = t('attachments.tooLarge', {
          name: file.name,
          limit: formatBytes(limits.maxBytes),
        });
        toast.error(message);
        throw new Error(message);
      }
      const url = scenarioKey
        ? `${scenarioApi(orgSlug, appKey, scenarioKey)}/attachments`
        : `${appApi(orgSlug, appKey)}/attachments`;
      try {
        const attachment = await uploadFile<Attachment>(url, file, onProgress);
        if (scenarioKey) {
          await queryClient.invalidateQueries({
            queryKey: keys.scenario(orgSlug, appKey, scenarioKey),
          });
        }
        return attachment;
      } catch (error) {
        toast.error(uploadError(error, file, t));
        throw error;
      }
    },
    [limits, orgSlug, appKey, scenarioKey, queryClient, t],
  );
}

/** For the rich-text editors: uploads an image and returns its attachment id. */
export function useImageUpload(orgSlug: string, appKey: string, scenarioKey?: string) {
  const upload = useAttachmentUpload(orgSlug, appKey, scenarioKey);
  return useCallback(async (file: File) => (await upload(file)).id, [upload]);
}

interface Progress {
  id: number;
  name: string;
  fraction: number;
}

export function AttachmentsPanel({
  orgSlug,
  appKey,
  scenarioKey,
  canWrite,
}: {
  orgSlug: string;
  appKey: string;
  scenarioKey: string;
  canWrite: boolean;
}) {
  const { t } = useTranslation();
  const attachments = useQuery(attachmentsQuery(orgSlug, appKey, scenarioKey));
  const upload = useAttachmentUpload(orgSlug, appKey, scenarioKey);
  const input = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Progress[]>([]);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(0);

  const remove = useMutation({
    mutationFn: (attachment: Attachment) =>
      api.delete(`${scenarioApi(orgSlug, appKey, scenarioKey)}/attachments/${attachment.id}`),
    onSuccess: async () => {
      toast.success(t('attachments.removed'));
      await invalidateScenarios(orgSlug, appKey);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const uploadAll = async (files: FileList | File[]) => {
    for (const file of [...files]) {
      const id = nextId.current++;
      setUploads((current) => [...current, { id, name: file.name, fraction: 0 }]);
      try {
        await upload(file, (fraction) =>
          setUploads((current) => current.map((u) => (u.id === id ? { ...u, fraction } : u))),
        );
      } catch {
        // Reported by the upload hook.
      } finally {
        setUploads((current) => current.filter((u) => u.id !== id));
      }
    }
    await invalidateScenarios(orgSlug, appKey);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void uploadAll(event.dataTransfer.files);
  };

  const items = attachments.data ?? [];
  return (
    <section aria-labelledby="attachments-heading" className="grid gap-3">
      <h2 id="attachments-heading" className="flex items-center gap-2 text-sm font-semibold">
        <Paperclip className="size-4" aria-hidden /> {t('attachments.title')}
        {items.length ? (
          <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
        ) : null}
      </h2>
      {canWrite ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="attachments-dropzone"
          className={cn(
            'flex flex-col items-center gap-1 rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground',
            dragging && 'border-primary bg-accent',
          )}
        >
          <Upload className="size-4" aria-hidden />
          <span>
            {t('attachments.drop')}{' '}
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => input.current?.click()}
            >
              {t('attachments.choose')}
            </Button>
          </span>
          <input
            ref={input}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-label={t('attachments.upload')}
            onChange={(event) => {
              if (event.target.files?.length) void uploadAll(event.target.files);
              event.target.value = '';
            }}
          />
        </div>
      ) : null}
      {uploads.map((u) => (
        <div key={u.id} className="grid gap-1 text-xs">
          <span>{t('attachments.uploading', { name: u.name })}</span>
          <div
            role="progressbar"
            aria-label={t('attachments.uploading', { name: u.name })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(u.fraction * 100)}
            className="h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${u.fraction * 100}%` }} />
          </div>
        </div>
      ))}
      {attachments.isError ? (
        <Alert variant="destructive">{errorMessage(attachments.error)}</Alert>
      ) : items.length === 0 && uploads.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('attachments.empty')}</p>
      ) : (
        <ul className="grid gap-2" aria-label={t('attachments.title')}>
          {items.map((attachment) => {
            const Icon = attachment.contentType.startsWith('image/') ? ImageIcon : FileIcon;
            return (
              <li key={attachment.id} className="flex items-start gap-2 text-sm">
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <div className="grid min-w-0 flex-1 gap-0.5">
                  <a
                    href={attachment.url}
                    download={attachment.fileName}
                    className="truncate font-medium hover:underline"
                    aria-label={t('attachments.download', { name: attachment.fileName })}
                  >
                    {attachment.fileName}
                  </a>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {formatBytes(attachment.sizeBytes)} · {userName(attachment.uploadedBy)} ·{' '}
                    <RelativeTime value={attachment.createdAt} />
                  </span>
                </div>
                <a
                  href={attachment.url}
                  download={attachment.fileName}
                  className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                  aria-hidden
                  tabIndex={-1}
                >
                  <Download className="size-4" />
                </a>
                {canWrite ? (
                  <ConfirmButton
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={t('attachments.remove', { name: attachment.fileName })}
                    title={t('attachments.removeTitle', { name: attachment.fileName })}
                    confirmLabel={t('common.remove')}
                    description={t('attachments.removeBody')}
                    onConfirm={() => remove.mutate(attachment)}
                  >
                    <Trash2 />
                  </ConfirmButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
