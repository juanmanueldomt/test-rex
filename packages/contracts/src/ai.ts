// AI assistance: organization LLM settings (BYOK) and the requests/responses of generating,
// revising and fixing test cases. Proposals are never saved by these endpoints.
import { z } from 'zod';
import { httpUrlSchema, type ScenarioPriority, type UserRef } from './scenarios';
import type { TestStep } from './steps';
import { EXECUTION_MODES, type ExecutionMode } from './test-cases';

export const LLM_PROVIDERS = ['anthropic', 'openai_compatible'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

/** Suggested model per provider; OpenAI-compatible endpoints name their own models. */
export const DEFAULT_LLM_MODELS: Record<LlmProvider, string> = {
  anthropic: 'claude-opus-5-5',
  openai_compatible: '',
};

export const LLM_MODEL_MAX = 100;
export const LLM_KEY_MAX = 500;
export const AI_INSTRUCTIONS_MAX = 2_000;
export const AI_PROPOSALS_MAX = 10;

export const llmSettingsInputSchema = z
  .object({
    provider: z.enum(LLM_PROVIDERS),
    model: z.string().trim().min(1, 'llm.modelRequired').max(LLM_MODEL_MAX, 'llm.modelTooLong'),
    baseUrl: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
      httpUrlSchema.nullable().default(null),
    ),
    /** Omit to keep the stored key. */
    apiKey: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z.string().trim().max(LLM_KEY_MAX, 'llm.keyTooLong').optional(),
    ),
    /** Remove the stored key (local models without authentication). */
    clearKey: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.provider === 'openai_compatible' && !value.baseUrl) {
      ctx.addIssue({ code: 'custom', path: ['baseUrl'], message: 'llm.baseUrlRequired' });
    }
  });
export type LlmSettingsInput = z.infer<typeof llmSettingsInputSchema>;

export interface LlmSettings {
  provider: LlmProvider;
  model: string;
  baseUrl: string | null;
  /** Whether a key is stored; the key itself is never returned. */
  hasKey: boolean;
  updatedBy: UserRef | null;
  updatedAt: string;
}

/** What every member may know: whether AI actions can be offered. */
export interface AiStatus {
  configured: boolean;
  provider: LlmProvider | null;
  model: string | null;
}

export interface LlmTestResult {
  ok: boolean;
  model: string;
  /** Provider's answer or error, without secrets. */
  message: string;
}

const instructions = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().max(AI_INSTRUCTIONS_MAX, 'ai.instructionsTooLong').optional(),
);

export const aiGenerateSchema = z.object({
  scenarioId: z.uuid(),
  count: z.number().int().min(1).max(AI_PROPOSALS_MAX).default(3),
  executionMode: z.enum(EXECUTION_MODES).default('automated'),
  instructions,
});
export type AiGenerateInput = z.infer<typeof aiGenerateSchema>;

export const aiReviseSchema = z.object({
  instructions: z
    .string()
    .trim()
    .min(1, 'ai.instructionsRequired')
    .max(AI_INSTRUCTIONS_MAX, 'ai.instructionsTooLong'),
});

export const aiFixSchema = z.object({ instructions });

/** A test case drafted by the LLM, already checked against the step rules. */
export interface TestCaseProposal {
  title: string;
  priority: ScenarioPriority;
  executionMode: ExecutionMode;
  description: string;
  preconditions: string;
  tags: string[];
  steps: TestStep[];
  /** Parts of the model's answer that were dropped (e.g. an invalid step). */
  issues: string[];
}

export interface AiGenerateResult {
  proposals: TestCaseProposal[];
  model: string;
}

export interface AiReviseResult {
  proposal: TestCaseProposal;
  /** The model's explanation of the change. */
  summary: string;
  model: string;
  /** Version the proposal was made from; send it as `baseVersion` when saving. */
  baseVersion: number;
}
