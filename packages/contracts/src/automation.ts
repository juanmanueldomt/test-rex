// Per-application automation settings and global steps (hooks around test cases and runs).
import { z } from 'zod';
import { httpUrlSchema, type UserRef } from './scenarios';
import { manualStepIssues, stepsSchema, type TestStep } from './steps';

export const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;
export type Browser = (typeof BROWSERS)[number];

export interface AutomationSettings {
  /** Relative `go to` steps resolve against it; null until configured. */
  baseUrl: string | null;
  browser: Browser;
  viewportWidth: number;
  viewportHeight: number;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
  assertionTimeoutMs: number;
  /** Keep a Playwright trace of failed test cases. */
  traceOnFailure: boolean;
  /** Keep a video of failed test cases. */
  videoOnFailure: boolean;
}

export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  baseUrl: null,
  browser: 'chromium',
  viewportWidth: 1280,
  viewportHeight: 720,
  actionTimeoutMs: 10_000,
  navigationTimeoutMs: 30_000,
  assertionTimeoutMs: 5_000,
  traceOnFailure: true,
  videoOnFailure: false,
};

const int = (min: number, max: number) =>
  z.coerce.number().int('number.invalid').min(min, 'number.range').max(max, 'number.range');

export const optionalBaseUrlSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  httpUrlSchema.nullable(),
);

export const automationSettingsSchema = z.object({
  baseUrl: optionalBaseUrlSchema,
  browser: z.enum(BROWSERS),
  viewportWidth: int(320, 3840),
  viewportHeight: int(240, 2160),
  actionTimeoutMs: int(1_000, 120_000),
  navigationTimeoutMs: int(1_000, 300_000),
  assertionTimeoutMs: int(500, 60_000),
  traceOnFailure: z.boolean(),
  videoOnFailure: z.boolean(),
});

export interface AutomationSettingsView extends AutomationSettings {
  updatedBy: UserRef | null;
  updatedAt: string | null;
}

// ---------------------------------------------------------------------------------------------
// Global steps
// ---------------------------------------------------------------------------------------------

/** When a global step runs: once around the run, or around every test case. */
export const HOOK_PHASES = ['beforeRun', 'beforeEach', 'afterEach', 'afterRun'] as const;
export type HookPhase = (typeof HOOK_PHASES)[number];

export const GLOBAL_STEP_NAME_MAX = 80;
export const GLOBAL_STEP_STEPS_MAX = 100;

const hookStepsSchema = stepsSchema
  .refine((steps) => steps.length >= 1, 'globalStep.stepsRequired')
  .refine((steps) => steps.length <= GLOBAL_STEP_STEPS_MAX, 'steps.tooMany')
  .superRefine((steps, ctx) => {
    for (const issue of manualStepIssues(steps, 'step.manualInGlobalStep')) {
      ctx.addIssue({ code: 'custom', path: issue.path.slice(1), message: issue.message });
    }
  });

export const globalStepInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'name.required')
    .max(GLOBAL_STEP_NAME_MAX, 'globalStep.nameTooLong'),
  phase: z.enum(HOOK_PHASES),
  enabled: z.boolean().default(true),
  steps: hookStepsSchema,
});
export type GlobalStepInput = z.infer<typeof globalStepInputSchema>;

export const updateGlobalStepSchema = z.object({
  name: globalStepInputSchema.shape.name.optional(),
  phase: z.enum(HOOK_PHASES).optional(),
  enabled: z.boolean().optional(),
  steps: hookStepsSchema.optional(),
  /** Zero-based position within the phase. */
  position: z.number().int().min(0).max(1000).optional(),
});

export interface GlobalStep {
  id: string;
  name: string;
  phase: HookPhase;
  enabled: boolean;
  position: number;
  steps: TestStep[];
  updatedBy: UserRef;
  updatedAt: string;
}

/** What a run keeps of the global steps that were enabled when it was created. */
export interface HookSnapshot {
  id: string;
  name: string;
  phase: HookPhase;
  steps: TestStep[];
}
