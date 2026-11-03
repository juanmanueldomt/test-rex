// The in-app recorder: keeps a browser page open for one recording session, applies the input
// people send from the live view, and turns it into steps with locators that Playwright
// confirms match exactly the element that was used.
import { createHash } from 'node:crypto';
import type { Logger } from '@testrex/config';
import {
  ARIA_ROLES,
  newStepId,
  RECORDING_IDLE_MS,
  RECORDING_MAX_MS,
  recordingCommandSchema,
  type RecordedElement,
  type RecordingCommand,
  type RecordingStatus,
  type StepLocator,
  type TestStep,
} from '@testrex/contracts';
import { schema } from '@testrex/db';
import { eq, inArray } from 'drizzle-orm';
import type { Browser, ElementHandle, Page } from 'playwright-core';
import { cleanError, locatorFor } from '../execution/engine';
import type { InOrg } from '../execution/run-executor';
import { RECORDER_PAGE_SCRIPT } from './page-script';

export interface RecorderDeps {
  logger: Logger;
  launch: () => Promise<Browser>;
  /** Poll interval for new input (ms). */
  pollMs?: number;
  /** Overrides for tests. */
  idleMs?: number;
  maxMs?: number;
}

/** What the page script reports about an element. */
interface ElementInfo {
  tag: string;
  role: string | null;
  name: string;
  testId: string;
  label: string;
  placeholder: string;
  alt: string;
  title: string;
  text: string;
  editable: boolean;
  checkable: boolean;
  checked: boolean | null;
  value: string | null;
  options: { value: string; label: string }[] | null;
  cssPath: string;
  box: { x: number; y: number; width: number; height: number };
}

interface Identified {
  element: RecordedElement;
  info: ElementInfo;
  handle: ElementHandle;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FRAME_REFRESH_MS = 1_500;

async function describeHandle(handle: ElementHandle): Promise<ElementInfo> {
  return handle.evaluate((el) =>
    (
      globalThis as unknown as { __testrex: { describe: (el: unknown) => unknown } }
    ).__testrex.describe(el),
  ) as Promise<ElementInfo>;
}

/** Whether `candidate` matches exactly one element, and it is `handle`. */
async function matchCount(page: Page, candidate: StepLocator, handle: ElementHandle) {
  const locator = locatorFor(page, candidate);
  const count = await locator.count();
  if (count !== 1) return { count, same: false };
  const same = await locator.evaluate((el, target) => el === target, handle).catch(() => false);
  return { count, same };
}

/** The first candidate locator Playwright resolves to exactly this element. */
export async function bestLocator(
  page: Page,
  handle: ElementHandle,
  info: ElementInfo,
): Promise<StepLocator> {
  const candidates: StepLocator[] = [];
  const add = (candidate: StepLocator) => candidates.push(candidate);
  const role =
    info.role && (ARIA_ROLES as readonly string[]).includes(info.role) ? info.role : null;
  if (info.testId) add({ strategy: 'testId', value: info.testId });
  if (role && info.name) add({ strategy: 'role', value: role, name: info.name });
  if (info.label) add({ strategy: 'label', value: info.label });
  if (info.placeholder) add({ strategy: 'placeholder', value: info.placeholder });
  if (info.alt) add({ strategy: 'altText', value: info.alt });
  if (info.title) add({ strategy: 'title', value: info.title });
  if (info.text && info.text.length <= 80 && !info.editable && info.tag !== 'select') {
    add({ strategy: 'text', value: info.text });
  }
  if (role && !info.name) add({ strategy: 'role', value: role });

  for (const candidate of candidates) {
    const loose = await matchCount(page, candidate, handle);
    if (loose.same) return candidate;
    if (loose.count > 1 && candidate.strategy !== 'testId') {
      const exact = { ...candidate, exact: true };
      if ((await matchCount(page, exact, handle)).same) return exact;
    }
  }
  // Several elements share the best description: pick this one by index.
  for (const candidate of candidates) {
    const locator = locatorFor(page, candidate);
    const count = await locator.count();
    if (count < 2 || count > 20) continue;
    for (let index = 0; index < count; index++) {
      const same = await locator
        .nth(index)
        .evaluate((el, target) => el === target, handle)
        .catch(() => false);
      if (same) return { ...candidate, nth: index };
    }
  }
  return { strategy: 'css', value: info.cssPath };
}

async function identify(page: Page, handle: ElementHandle | null): Promise<Identified | null> {
  if (!handle) return null;
  const info = await describeHandle(handle);
  const locator = await bestLocator(page, handle, info);
  return {
    handle,
    info,
    element: {
      locator,
      tag: info.tag,
      text: info.text,
      value: info.value,
      checked: info.checked,
      options: info.options,
      box: info.box,
    },
  };
}

async function elementAt(page: Page, x: number, y: number): Promise<ElementHandle | null> {
  const handle = await page.evaluateHandle(
    ([px, py]) =>
      (
        globalThis as unknown as { __testrex?: { at: (x: number, y: number) => unknown } }
      ).__testrex?.at(px!, py!) ?? null,
    [x, y],
  );
  return handle.asElement();
}

async function activeElement(page: Page): Promise<ElementHandle | null> {
  const handle = await page.evaluateHandle(
    () =>
      (globalThis as unknown as { __testrex?: { active: () => unknown } }).__testrex?.active() ??
      null,
  );
  return handle.asElement();
}

const sameLocator = (a: StepLocator | undefined, b: StepLocator | undefined) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Applies input to the page and keeps the recorded steps. */
export class RecordingSession {
  steps: TestStep[] = [];
  element: RecordedElement | null = null;
  /** The element identified last (clicked or inspected), for select and assertions. */
  private current: Identified | null = null;
  error: string | null = null;

  constructor(private readonly page: Page) {}

  private push(step: Omit<TestStep, 'id'>) {
    this.steps.push({ id: newStepId(), ...step } as TestStep);
  }

  private async settle() {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => {});
    await sleep(250);
  }

  async start(url: string) {
    this.push({ action: 'goto', value: url });
    try {
      await this.page.goto(url);
    } catch (error) {
      this.error = cleanError(error).split('\n')[0]!;
    }
  }

  async apply(command: RecordingCommand): Promise<'stop' | void> {
    const page = this.page;
    switch (command.type) {
      case 'stop':
        return 'stop';
      case 'navigate':
        this.push({ action: 'goto', value: command.url });
        await page.goto(command.url);
        return;
      case 'scroll':
        await page.mouse.wheel(0, command.deltaY);
        await sleep(150);
        return;
      case 'inspect': {
        this.current = await identify(page, await elementAt(page, command.x, command.y));
        this.element = this.current?.element ?? null;
        return;
      }
      case 'click': {
        const target = await identify(page, await elementAt(page, command.x, command.y));
        this.current = target;
        this.element = target?.element ?? null;
        if (target?.info.tag === 'select') {
          // Native drop-downs are not drawn in screenshots: the live view offers the options.
          return;
        }
        await page.mouse.click(command.x, command.y, { clickCount: command.double ? 2 : 1 });
        if (target?.info.checkable) {
          const checked = await target.handle
            .evaluate((el) => (el as unknown as { checked: boolean }).checked)
            .catch(() => true);
          this.push({ action: checked ? 'check' : 'uncheck', target: target.element.locator });
        } else if (target && !target.info.editable) {
          this.push({
            action: command.double ? 'dblclick' : 'click',
            target: target.element.locator,
          });
        }
        await this.settle();
        return;
      }
      case 'type': {
        await page.keyboard.type(command.text);
        await this.recordFill();
        return;
      }
      case 'press': {
        await page.keyboard.press(command.key);
        const field = await identify(page, await activeElement(page));
        const last = this.steps[this.steps.length - 1];
        if (
          ['Backspace', 'Delete'].includes(command.key) &&
          field?.info.editable &&
          last?.action === 'fill' &&
          sameLocator(last.target, field.element.locator)
        ) {
          last.value = field.info.value ?? '';
          return;
        }
        this.push({
          action: 'press',
          value: command.key,
          ...(field ? { target: field.element.locator } : {}),
        });
        await this.settle();
        return;
      }
      case 'select': {
        if (!this.current || this.current.info.tag !== 'select') {
          throw new Error('Click a drop-down before choosing an option.');
        }
        await this.current.handle.selectOption(command.value);
        const label = this.current.info.options?.find((o) => o.value === command.value)?.label;
        this.push({
          action: 'select',
          target: this.current.element.locator,
          value: label || command.value,
        });
        return;
      }
      case 'assert':
        await this.assert(command.assertion, command.value);
        return;
    }
  }

  /** Typing goes into the focused field; consecutive typing updates one fill step. */
  private async recordFill() {
    const field = await identify(this.page, await activeElement(this.page));
    if (!field || !field.info.editable) return;
    const value = field.info.value ?? field.info.text;
    const last = this.steps[this.steps.length - 1];
    if (last?.action === 'fill' && sameLocator(last.target, field.element.locator)) {
      last.value = value;
    } else {
      this.push({ action: 'fill', target: field.element.locator, value });
    }
    this.current = field;
    this.element = field.element;
  }

  private async assert(
    assertion: Extract<RecordingCommand, { type: 'assert' }>['assertion'],
    value: string | undefined,
  ) {
    if (assertion === 'expectUrl') {
      this.push({ action: 'expectUrl', value: value ?? this.page.url() });
      return;
    }
    if (assertion === 'expectTitle') {
      this.push({ action: 'expectTitle', value: value ?? (await this.page.title()) });
      return;
    }
    if (!this.current) throw new Error('Choose an element first.');
    const { element, info } = this.current;
    switch (assertion) {
      case 'expectVisible':
        this.push({ action: 'expectVisible', target: element.locator });
        return;
      case 'expectText':
        this.push({ action: 'expectText', target: element.locator, value: value ?? info.text });
        return;
      case 'expectValue':
        this.push({
          action: 'expectValue',
          target: element.locator,
          value: value ?? info.value ?? '',
        });
        return;
      case 'expectChecked':
        this.push({ action: 'expectChecked', target: element.locator });
        return;
    }
  }
}

/**
 * Runs one recording session until it is stopped, idle for too long or too old. Each loop
 * consumes queued input in a short transaction and stores the steps and a new frame when the
 * page changed.
 */
export async function runRecordingSession(
  deps: RecorderDeps,
  inOrg: InOrg,
  payload: { organizationId: string; sessionId: string },
): Promise<{ status: RecordingStatus; steps: number }> {
  const idleMs = deps.idleMs ?? RECORDING_IDLE_MS;
  const maxMs = deps.maxMs ?? RECORDING_MAX_MS;
  const pollMs = deps.pollMs ?? 150;
  const logger = deps.logger.child({ sessionId: payload.sessionId });
  const [session] = await inOrg((tx) =>
    tx
      .select()
      .from(schema.recordingSessions)
      .where(eq(schema.recordingSessions.id, payload.sessionId)),
  );
  if (!session || session.status !== 'starting') {
    return { status: session?.status ?? 'failed', steps: 0 };
  }

  let browser: Browser | null = null;
  let status: RecordingStatus = 'active';
  let lastHash = '';
  let frameVersion = session.frameVersion;
  let recorder: RecordingSession | null = null;
  const persist = async (page: Page | null, final = false) => {
    let frame: Buffer | null = null;
    if (page && !final) {
      frame = await page
        .screenshot({ type: 'jpeg', quality: 60, timeout: 5_000 })
        .catch(() => null);
      const hash = frame ? createHash('sha1').update(frame).digest('hex') : lastHash;
      if (hash === lastHash) frame = null;
      else lastHash = hash;
    }
    if (frame) frameVersion++;
    const url = page && !page.isClosed() ? page.url() : null;
    const title = page && !page.isClosed() ? await page.title().catch(() => null) : null;
    await inOrg((tx) =>
      tx
        .update(schema.recordingSessions)
        .set({
          status,
          steps: recorder?.steps ?? [],
          element: recorder?.element ?? null,
          error: recorder?.error ?? null,
          ...(url ? { currentUrl: url } : {}),
          ...(title !== null ? { pageTitle: title } : {}),
          ...(frame ? { frame, frameVersion } : {}),
          ...(final ? { endedAt: new Date() } : {}),
        })
        .where(eq(schema.recordingSessions.id, session.id)),
    );
  };

  try {
    browser = await deps.launch();
    const context = await browser.newContext({
      viewport: { width: session.viewportWidth, height: session.viewportHeight },
    });
    context.setDefaultTimeout(10_000);
    context.setDefaultNavigationTimeout(30_000);
    await context.addInitScript({ content: RECORDER_PAGE_SCRIPT });
    const page = await context.newPage();
    recorder = new RecordingSession(page);
    await recorder.start(session.startUrl);
    await persist(page);

    const startedAt = Date.now();
    let lastInput = Date.now();
    let lastFrame = Date.now();
    for (;;) {
      if (Date.now() - startedAt > maxMs || Date.now() - lastInput > idleMs) {
        status = 'expired';
        break;
      }
      const commands = await inOrg((tx) =>
        tx
          .delete(schema.recordingCommands)
          .where(eq(schema.recordingCommands.sessionId, session.id))
          .returning({
            id: schema.recordingCommands.id,
            payload: schema.recordingCommands.payload,
          }),
      );
      if (commands.length === 0) {
        if (Date.now() - lastFrame > FRAME_REFRESH_MS) {
          await persist(page);
          lastFrame = Date.now();
        }
        await sleep(pollMs);
        continue;
      }
      lastInput = Date.now();
      let stop = false;
      for (const { payload: raw } of commands.sort((a, b) => a.id - b.id)) {
        const command = recordingCommandSchema.safeParse(raw);
        if (!command.success) continue;
        try {
          recorder.error = null;
          if ((await recorder.apply(command.data)) === 'stop') {
            stop = true;
            break;
          }
        } catch (error) {
          recorder.error = cleanError(error).split('\n')[0]!;
        }
      }
      if (stop) {
        status = 'stopped';
        break;
      }
      await persist(page);
      lastFrame = Date.now();
    }
  } catch (error) {
    status = 'failed';
    if (recorder) recorder.error = cleanError(error).split('\n')[0]!;
    logger.error({ err: error }, 'recording session failed');
    if (!recorder) {
      await inOrg((tx) =>
        tx
          .update(schema.recordingSessions)
          .set({ status, error: cleanError(error).split('\n')[0]!, endedAt: new Date() })
          .where(eq(schema.recordingSessions.id, session.id)),
      );
    }
  } finally {
    if (recorder) await persist(null, true).catch(() => {});
    await inOrg((tx) =>
      tx
        .delete(schema.recordingCommands)
        .where(inArray(schema.recordingCommands.sessionId, [session.id])),
    ).catch(() => {});
    await browser?.close().catch(() => {});
  }
  return { status, steps: recorder?.steps.length ?? 0 };
}
