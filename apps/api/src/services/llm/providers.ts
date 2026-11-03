// LLM providers behind one small interface: Anthropic through the official SDK, and any
// OpenAI-compatible chat completions endpoint (OpenAI, Azure OpenAI v1, Ollama, vLLM, …).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { LlmProvider as ProviderName } from '@testrex/contracts';
import { z } from 'zod';

export const LLM_TIMEOUT_MS = 120_000;
const MAX_TOKENS = 16_000;

export type LlmErrorCode =
  | 'AI_AUTH'
  | 'AI_RATE_LIMITED'
  | 'AI_UNAVAILABLE'
  | 'AI_TIMEOUT'
  | 'AI_REFUSED'
  | 'AI_INVALID_OUTPUT'
  | 'AI_BAD_REQUEST';

/** A provider failure translated into something people can act on (never contains the key). */
export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface LlmRequest<T> {
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}

export interface LlmProvider {
  readonly model: string;
  /** Returns output that matches `schema`, or throws {@link LlmError}. */
  generate<T>(request: LlmRequest<T>): Promise<T>;
  /** Checks credentials and model; returns a short description of what answered. */
  test(): Promise<string>;
}

export interface ProviderConfig {
  provider: ProviderName;
  model: string;
  baseUrl: string | null;
  apiKey: string | null;
}

export type ProviderFactory = (config: ProviderConfig) => LlmProvider;

// ---------------------------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------------------------

/** Models that accept server-side refusal fallbacks (`fallbacks: 'default'`). */
const FALLBACK_MODELS = new Set([
  'claude-fable-5-1',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-5-5',
]);
/** Models that accept `output_config.effort`. */
const EFFORT_MODELS = new Set([
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-opus-4-7',
  'claude-opus-4-6',
  'claude-sonnet-5-5',
  'claude-sonnet-5',
  'claude-sonnet-4-6',
  'claude-haiku-5-5',
]);

function anthropicError(error: unknown): LlmError {
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new LlmError('AI_AUTH', 'The provider rejected the credentials.');
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LlmError(
      'AI_RATE_LIMITED',
      'The provider is rate limiting requests. Try again later.',
    );
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError('AI_TIMEOUT', 'The provider did not answer in time.');
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new LlmError('AI_BAD_REQUEST', 'The provider does not know this model.');
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new LlmError('AI_BAD_REQUEST', `The provider rejected the request: ${error.message}`);
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmError('AI_UNAVAILABLE', 'The provider is not available right now.');
  }
  return new LlmError('AI_UNAVAILABLE', 'The provider could not be reached.');
}

export function anthropicProvider(config: ProviderConfig): LlmProvider {
  const client = new Anthropic({
    apiKey: config.apiKey ?? undefined,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 2,
  });
  return {
    model: config.model,
    async generate<T>({ system, prompt, schema }: LlmRequest<T>): Promise<T> {
      let response;
      try {
        response = await client.beta.messages.parse({
          model: config.model,
          max_tokens: MAX_TOKENS,
          system,
          messages: [{ role: 'user', content: prompt }],
          output_config: {
            format: betaZodOutputFormat(schema),
            ...(EFFORT_MODELS.has(config.model) ? { effort: 'high' as const } : {}),
          },
          ...(FALLBACK_MODELS.has(config.model)
            ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
            : {}),
        });
      } catch (error) {
        throw error instanceof LlmError ? error : anthropicError(error);
      }
      if (response.stop_reason === 'refusal') {
        throw new LlmError('AI_REFUSED', 'The model declined this request.');
      }
      if (response.stop_reason === 'max_tokens') {
        throw new LlmError(
          'AI_INVALID_OUTPUT',
          'The answer was too long. Ask for fewer test cases.',
        );
      }
      const parsed = response.parsed_output;
      if (parsed === null || parsed === undefined) {
        throw new LlmError('AI_INVALID_OUTPUT', 'The model did not return the expected format.');
      }
      return parsed as T;
    },
    async test() {
      try {
        const info = await client.models.retrieve(config.model);
        return info.display_name;
      } catch (error) {
        throw anthropicError(error);
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// OpenAI-compatible chat completions
// ---------------------------------------------------------------------------------------------

const chatResponse = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

function httpError(status: number): LlmError {
  if (status === 401 || status === 403) {
    return new LlmError('AI_AUTH', 'The provider rejected the credentials.');
  }
  if (status === 429) {
    return new LlmError(
      'AI_RATE_LIMITED',
      'The provider is rate limiting requests. Try again later.',
    );
  }
  if (status === 404) return new LlmError('AI_BAD_REQUEST', 'The endpoint or model was not found.');
  if (status >= 500)
    return new LlmError('AI_UNAVAILABLE', 'The provider is not available right now.');
  return new LlmError('AI_BAD_REQUEST', `The provider rejected the request (HTTP ${status}).`);
}

export function openAiCompatibleProvider(
  config: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): LlmProvider {
  const base = (config.baseUrl ?? '').replace(/\/+$/, '');
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;

  async function call(path: string, init: RequestInit): Promise<Response> {
    try {
      return await fetchImpl(`${base}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
    } catch (error) {
      if ((error as Error).name === 'TimeoutError') {
        throw new LlmError('AI_TIMEOUT', 'The provider did not answer in time.');
      }
      throw new LlmError('AI_UNAVAILABLE', 'The provider could not be reached.');
    }
  }

  return {
    model: config.model,
    async generate<T>({ system, prompt, schema }: LlmRequest<T>): Promise<T> {
      const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
      const response = await call('/chat/completions', {
        method: 'POST',
        body: JSON.stringify({
          model: config.model,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${system}\n\nAnswer with one JSON object that matches this JSON Schema, and nothing else:\n${jsonSchema}`,
            },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!response.ok) throw httpError(response.status);
      const body = chatResponse.safeParse(await response.json().catch(() => null));
      const content = body.success ? body.data.choices[0]!.message.content : null;
      if (!content) {
        throw new LlmError('AI_INVALID_OUTPUT', 'The model did not return the expected format.');
      }
      let json: unknown;
      try {
        json = JSON.parse(content.replace(/^```(?:json)?\s*|\s*```$/g, ''));
      } catch {
        throw new LlmError('AI_INVALID_OUTPUT', 'The model did not return valid JSON.');
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new LlmError('AI_INVALID_OUTPUT', 'The model did not return the expected format.');
      }
      return parsed.data;
    },
    async test() {
      const response = await call('/models', { method: 'GET' });
      if (!response.ok) throw httpError(response.status);
      const body = (await response.json().catch(() => null)) as { data?: { id?: string }[] } | null;
      const models = body?.data?.map((model) => model.id).filter(Boolean) ?? [];
      if (models.length && !models.includes(config.model)) {
        throw new LlmError('AI_BAD_REQUEST', `The endpoint does not list model ${config.model}.`);
      }
      return config.model;
    },
  };
}

export const defaultProviderFactory: ProviderFactory = (config) =>
  config.provider === 'anthropic' ? anthropicProvider(config) : openAiCompatibleProvider(config);
