import type { ApiErrorBody } from '@testrex/contracts';
import i18n from './i18n';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }

  get code(): string {
    return this.body.code;
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: {
      accept: 'application/json',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!response.ok) {
    const errorBody = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(response.status, {
      ...errorBody,
      code: errorBody.code ?? `HTTP_${response.status}`,
      message: errorBody.message ?? response.statusText,
    });
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body: unknown = {}, headers?: Record<string, string>) =>
    request<T>('POST', path, body, headers),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T = void>(path: string) => request<T>('DELETE', path),
};

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

/** Human, translated message for any error, using the API error code when known. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return i18n.t('errors.generic');
  const code = error.code.startsWith('USER_ALREADY_EXISTS') ? 'USER_ALREADY_EXISTS' : error.code;
  const key = `errors.${code}`;
  return i18n.exists(key)
    ? i18n.t(key, { ...error.body })
    : error.message || i18n.t('errors.generic');
}

/**
 * Uploads one file as multipart/form-data, reporting progress (0–1). Uses XMLHttpRequest
 * because fetch has no upload progress events.
 */
export function uploadFile<T>(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path);
    request.withCredentials = true;
    request.setRequestHeader('accept', 'application/json');
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onerror = () => reject(new ApiError(0, { code: 'NETWORK', message: 'Network error' }));
    request.onload = () => {
      let data: unknown;
      try {
        data = request.responseText ? JSON.parse(request.responseText) : undefined;
      } catch {
        data = undefined;
      }
      if (request.status >= 200 && request.status < 300) return resolve(data as T);
      const body = (data ?? {}) as Partial<ApiErrorBody>;
      reject(
        new ApiError(request.status, {
          ...body,
          code: body.code ?? `HTTP_${request.status}`,
          message: body.message ?? request.statusText,
        }),
      );
    };
    const form = new FormData();
    form.append('file', file, file.name);
    request.send(form);
  });
}
