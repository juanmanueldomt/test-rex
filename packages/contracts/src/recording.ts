// Recordings: the in-app recorder's commands and state, and the import of code recorded with
// `npx playwright codegen`.
import { z } from 'zod';
import { httpUrlSchema, type UserRef } from './scenarios';
import {
  ARIA_ROLES,
  newStepId,
  type LocatorStrategy,
  type StepAction,
  type StepLocator,
  type TestStep,
} from './steps';

export const RECORDING_STATUSES = ['starting', 'active', 'stopped', 'expired', 'failed'] as const;
export type RecordingStatus = (typeof RECORDING_STATUSES)[number];

/** A recording ends after this long without input… */
export const RECORDING_IDLE_MS = 5 * 60 * 1000;
/** …or after this long in total. */
export const RECORDING_MAX_MS = 30 * 60 * 1000;

export const RECORDABLE_ASSERTIONS = [
  'expectVisible',
  'expectText',
  'expectValue',
  'expectChecked',
  'expectUrl',
  'expectTitle',
] as const;

export const startRecordingSchema = z.object({
  startUrl: httpUrlSchema,
});

const coordinate = z.number().min(0).max(4_000);

/** Input from the live view, applied by the worker in order. */
export const recordingCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('click'),
    x: coordinate,
    y: coordinate,
    double: z.boolean().optional(),
  }),
  z.object({ type: z.literal('type'), text: z.string().min(1).max(1_000) }),
  z.object({ type: z.literal('press'), key: z.string().min(1).max(40) }),
  z.object({ type: z.literal('scroll'), deltaY: z.number().min(-5_000).max(5_000) }),
  z.object({ type: z.literal('navigate'), url: httpUrlSchema }),
  /** Identify the element under the point without touching it (assertion mode). */
  z.object({ type: z.literal('inspect'), x: coordinate, y: coordinate }),
  /** Choose an option of the select element identified last. */
  z.object({ type: z.literal('select'), value: z.string().max(1_000) }),
  /** Record an assertion on the element identified last, or on the URL/title. */
  z.object({
    type: z.literal('assert'),
    assertion: z.enum(RECORDABLE_ASSERTIONS),
    value: z.string().max(5_000).optional(),
  }),
  z.object({ type: z.literal('stop') }),
]);
export type RecordingCommand = z.infer<typeof recordingCommandSchema>;

/** What the recorder knows about the element identified by the last click or inspection. */
export interface RecordedElement {
  locator: StepLocator;
  tag: string;
  text: string;
  value: string | null;
  checked: boolean | null;
  /** Options of a `<select>`. */
  options: { value: string; label: string }[] | null;
  box: { x: number; y: number; width: number; height: number };
}

export interface RecordingSession {
  id: string;
  status: RecordingStatus;
  startUrl: string;
  url: string | null;
  title: string | null;
  steps: TestStep[];
  /** Increments whenever a new screenshot of the page is available. */
  frameVersion: number;
  viewport: { width: number; height: number };
  element: RecordedElement | null;
  error: string | null;
  createdBy: UserRef;
  /** Only the person who started the session may send input. */
  canDrive: boolean;
  pendingCommands: number;
  createdAt: string;
  lastActivityAt: string;
  endedAt: string | null;
}

// ---------------------------------------------------------------------------------------------
// Import of Playwright codegen output
// ---------------------------------------------------------------------------------------------

export interface ImportWarning {
  /** 1-based line number in the pasted code. */
  line: number;
  text: string;
  reason: 'unsupported' | 'locator' | 'syntax';
}

export interface ImportResult {
  steps: TestStep[];
  warnings: ImportWarning[];
}

type Value =
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'regex'; source: string; flags: string }
  | { kind: 'object'; entries: Record<string, Value> }
  | { kind: 'array'; items: Value[] }
  | { kind: 'identifier'; name: string };

interface Call {
  name: string;
  args: Value[];
}

/** `page.getByRole(...).click()` → root `page`, calls [getByRole, click]. */
interface Chain {
  root: string;
  /** Arguments when the root itself is called, as in `expect(x)`. */
  rootArgs: Value[] | null;
  calls: Call[];
  /** A property step without call, e.g. `.not` or `.keyboard`. */
  props: string[];
}

class Parser {
  private pos = 0;
  constructor(private readonly text: string) {}

  private peek(): string {
    return this.text[this.pos] ?? '';
  }

  private skipSpace(): void {
    while (/\s/.test(this.peek())) this.pos++;
  }

  private expect(char: string): void {
    this.skipSpace();
    if (this.peek() !== char) throw new Error(`expected ${char}`);
    this.pos++;
  }

  private identifier(): string {
    this.skipSpace();
    const match = /^[A-Za-z_$][\w$]*/.exec(this.text.slice(this.pos));
    if (!match) throw new Error('expected identifier');
    this.pos += match[0].length;
    return match[0];
  }

  private string(quote: string): string {
    this.pos++;
    let out = '';
    while (this.pos < this.text.length) {
      const char = this.text[this.pos++]!;
      if (char === quote) return out;
      if (quote === '`' && char === '$' && this.peek() === '{') {
        throw new Error('template expressions are not supported');
      }
      if (char === '\\') {
        const next = this.text[this.pos++] ?? '';
        const escapes: Record<string, string> = { n: '\n', r: '\r', t: '\t', '0': '\0' };
        if (next === 'u') {
          const hex = this.text.slice(this.pos, this.pos + 4);
          out += String.fromCharCode(parseInt(hex, 16));
          this.pos += 4;
        } else {
          out += escapes[next] ?? next;
        }
      } else {
        out += char;
      }
    }
    throw new Error('unterminated string');
  }

  private regex(): Value {
    this.pos++;
    let source = '';
    let inClass = false;
    while (this.pos < this.text.length) {
      const char = this.text[this.pos++]!;
      if (char === '\\') {
        source += char + (this.text[this.pos++] ?? '');
        continue;
      }
      if (char === '[') inClass = true;
      if (char === ']') inClass = false;
      if (char === '/' && !inClass) {
        const flags = /^[a-z]*/.exec(this.text.slice(this.pos))![0];
        this.pos += flags.length;
        return { kind: 'regex', source, flags };
      }
      source += char;
    }
    throw new Error('unterminated regex');
  }

  value(): Value {
    this.skipSpace();
    const char = this.peek();
    if (char === "'" || char === '"' || char === '`') {
      return { kind: 'string', value: this.string(char) };
    }
    if (char === '/') return this.regex();
    if (char === '{') {
      this.pos++;
      const entries: Record<string, Value> = {};
      for (;;) {
        this.skipSpace();
        if (this.peek() === '}') {
          this.pos++;
          return { kind: 'object', entries };
        }
        const key =
          this.peek() === "'" || this.peek() === '"' ? this.string(this.peek()) : this.identifier();
        this.expect(':');
        entries[key] = this.value();
        this.skipSpace();
        if (this.peek() === ',') this.pos++;
      }
    }
    if (char === '[') {
      this.pos++;
      const items: Value[] = [];
      for (;;) {
        this.skipSpace();
        if (this.peek() === ']') {
          this.pos++;
          return { kind: 'array', items };
        }
        items.push(this.value());
        this.skipSpace();
        if (this.peek() === ',') this.pos++;
      }
    }
    const number = /^-?\d+(\.\d+)?/.exec(this.text.slice(this.pos));
    if (number) {
      this.pos += number[0].length;
      return { kind: 'number', value: Number(number[0]) };
    }
    const name = this.identifier();
    if (name === 'true' || name === 'false') return { kind: 'boolean', value: name === 'true' };
    return { kind: 'identifier', name };
  }

  private args(): Value[] {
    this.expect('(');
    const args: Value[] = [];
    for (;;) {
      this.skipSpace();
      if (this.peek() === ')') {
        this.pos++;
        return args;
      }
      args.push(this.value());
      this.skipSpace();
      if (this.peek() === ',') this.pos++;
    }
  }

  chain(): Chain {
    const root = this.identifier();
    this.skipSpace();
    const rootArgs = this.peek() === '(' ? this.args() : null;
    const calls: Call[] = [];
    const props: string[] = [];
    for (;;) {
      this.skipSpace();
      if (this.peek() !== '.') break;
      this.pos++;
      const name = this.identifier();
      this.skipSpace();
      if (this.peek() === '(') calls.push({ name, args: this.args() });
      else props.push(name);
    }
    this.skipSpace();
    if (this.pos < this.text.length) throw new Error('unexpected text');
    return { root, rootArgs, calls, props };
  }

  /** Parses `expect(<chain>)` arguments recursively: the argument is itself a chain. */
  static chainFrom(text: string): Chain {
    return new Parser(text).chain();
  }
}

const str = (value: Value | undefined): string | null =>
  value?.kind === 'string' ? value.value : null;

/** The literal text of a simple regex (`/^Welcome$/` → `Welcome`), or null. */
function regexText(value: Value | undefined): { text: string; exact: boolean } | null {
  if (value?.kind !== 'regex') return null;
  let source = value.source;
  const exact = source.startsWith('^') && source.endsWith('$');
  source = source.replace(/^\^/, '').replace(/\$$/, '');
  if (/(?<!\\)[.*+?()[\]{}|]/.test(source)) return null;
  return { text: source.replace(/\\(.)/g, '$1'), exact };
}

const LOCATOR_METHODS: Record<string, LocatorStrategy> = {
  getByRole: 'role',
  getByText: 'text',
  getByLabel: 'label',
  getByPlaceholder: 'placeholder',
  getByAltText: 'altText',
  getByTitle: 'title',
  getByTestId: 'testId',
  locator: 'css',
};

/** Maps the locator part of a chain; returns the index of the first non-locator call. */
function locatorOf(calls: Call[]): { locator: StepLocator; next: number } | null {
  const first = calls[0];
  if (!first || !(first.name in LOCATOR_METHODS)) return null;
  const strategy = LOCATOR_METHODS[first.name]!;
  const options = first.args[1]?.kind === 'object' ? first.args[1].entries : {};
  let locator: StepLocator;
  if (strategy === 'role') {
    const role = str(first.args[0]);
    if (!role || !(ARIA_ROLES as readonly string[]).includes(role)) return null;
    locator = { strategy, value: role };
    const name = options.name;
    if (name?.kind === 'string') locator.name = name.value;
    else if (name) {
      const fromRegex = regexText(name);
      if (!fromRegex) return null;
      locator.name = fromRegex.text;
      if (fromRegex.exact) locator.exact = true;
    }
  } else {
    let text = str(first.args[0]);
    if (text === null) {
      const fromRegex = regexText(first.args[0]);
      if (!fromRegex) return null;
      text = fromRegex.text;
      if (fromRegex.exact) options.exact = { kind: 'boolean', value: true };
    }
    if (!text) return null;
    locator = { strategy, value: text };
  }
  if (options.exact?.kind === 'boolean' && options.exact.value) locator.exact = true;
  let next = 1;
  for (; next < calls.length; next++) {
    const call = calls[next]!;
    if (call.name === 'first') locator.nth = 0;
    else if (call.name === 'nth' && call.args[0]?.kind === 'number' && call.args[0].value >= 0) {
      locator.nth = call.args[0].value;
    } else break;
  }
  return { locator, next };
}

const ACTIONS: Record<string, StepAction> = {
  click: 'click',
  dblclick: 'dblclick',
  fill: 'fill',
  press: 'press',
  selectOption: 'select',
  check: 'check',
  uncheck: 'uncheck',
  hover: 'hover',
};

const MATCHERS: Record<string, StepAction> = {
  toBeVisible: 'expectVisible',
  toBeHidden: 'expectHidden',
  toContainText: 'expectText',
  toHaveText: 'expectExactText',
  toHaveValue: 'expectValue',
  toBeChecked: 'expectChecked',
  toBeEnabled: 'expectEnabled',
  toBeDisabled: 'expectDisabled',
  toHaveCount: 'expectCount',
};

function textArg(value: Value | undefined): string | null {
  if (value?.kind === 'string') return value.value;
  if (value?.kind === 'number') return String(value.value);
  return regexText(value)?.text ?? null;
}

/** Converts one statement (without `await` and `;`) to a step, or explains why not. */
function statementStep(statement: string): TestStep | ImportWarning['reason'] {
  let chain: Chain;
  try {
    chain = Parser.chainFrom(statement);
  } catch {
    return /^(page\.|expect\()/.test(statement) ? 'syntax' : 'unsupported';
  }
  const id = newStepId();

  if (chain.root === 'expect' && chain.rootArgs?.length === 1) {
    const subject = chain.rootArgs[0]!;
    const matcher = chain.calls[chain.calls.length - 1];
    if (!matcher || chain.calls.length !== 1) return 'unsupported';
    const negated = chain.props.includes('not');
    if (subject.kind === 'identifier' && subject.name === 'page') {
      const text = textArg(matcher.args[0]);
      if (text === null || negated) return 'unsupported';
      if (matcher.name === 'toHaveURL') return { id, action: 'expectUrl', value: text };
      if (matcher.name === 'toHaveTitle') return { id, action: 'expectTitle', value: text };
      return 'unsupported';
    }
    return 'unsupported';
  }

  if (chain.root !== 'page') return 'unsupported';
  if (
    chain.props[0] === 'keyboard' &&
    chain.calls.length === 1 &&
    chain.calls[0]!.name === 'press'
  ) {
    const key = str(chain.calls[0]!.args[0]);
    return key ? { id, action: 'press', value: key } : 'unsupported';
  }
  if (chain.props.length > 0) return 'unsupported';
  const [first] = chain.calls;
  if (!first) return 'unsupported';
  if (first.name === 'goto' && chain.calls.length === 1) {
    const url = str(first.args[0]);
    return url ? { id, action: 'goto', value: url } : 'unsupported';
  }
  if (first.name === 'waitForTimeout' && first.args[0]?.kind === 'number') {
    return { id, action: 'wait', value: String(Math.round(first.args[0].value)) };
  }
  const located = locatorOf(chain.calls);
  if (!located) return first.name in LOCATOR_METHODS ? 'locator' : 'unsupported';
  const rest = chain.calls.slice(located.next);
  if (rest.length !== 1) return rest.length === 0 ? 'unsupported' : 'locator';
  const action = rest[0]!;
  if (action.name === 'setChecked' && action.args[0]?.kind === 'boolean') {
    return { id, action: action.args[0].value ? 'check' : 'uncheck', target: located.locator };
  }
  const mapped = ACTIONS[action.name];
  if (!mapped) return 'unsupported';
  const step: TestStep = { id, action: mapped, target: located.locator };
  if (mapped === 'fill' || mapped === 'press') {
    const value = str(action.args[0]);
    if (value === null) return 'unsupported';
    step.value = value;
  }
  if (mapped === 'select') {
    const arg = action.args[0];
    const value =
      str(arg) ??
      (arg?.kind === 'object'
        ? (str(arg.entries.label) ?? str(arg.entries.value))
        : arg?.kind === 'array'
          ? str(arg.items[0])
          : null);
    if (value === null) return 'unsupported';
    step.value = value;
  }
  return step;
}

/** `expect(page.getByText('x')).toBeVisible()` → the locator chain is parsed separately. */
function expectStep(statement: string): TestStep | ImportWarning['reason'] | null {
  const match = /^expect\((.*)\)((?:\.not)?)\.(\w+)\((.*)\)$/s.exec(statement);
  if (!match) return null;
  const [, subject = '', not = '', matcher = '', args = ''] = match;
  if (subject.trim() === 'page') return null; // handled by statementStep
  if (not) {
    return matcher === 'toBeVisible'
      ? withLocator(subject, (locator) => ({
          id: newStepId(),
          action: 'expectHidden',
          target: locator,
        }))
      : 'unsupported';
  }
  const action = MATCHERS[matcher];
  if (!action) return 'unsupported';
  return withLocator(subject, (locator) => {
    const step: TestStep = { id: newStepId(), action, target: locator };
    if (['expectText', 'expectExactText', 'expectValue', 'expectCount'].includes(action)) {
      let value: string | null;
      try {
        value = args.trim() ? textArg(new Parser(args).value()) : null;
      } catch {
        value = null;
      }
      if (value === null) return 'unsupported';
      step.value = value;
    }
    return step;
  });
}

function withLocator(
  subject: string,
  build: (locator: StepLocator) => TestStep | ImportWarning['reason'],
): TestStep | ImportWarning['reason'] {
  let chain: Chain;
  try {
    chain = Parser.chainFrom(subject.trim());
  } catch {
    return 'syntax';
  }
  if (chain.root !== 'page' || chain.props.length) return 'unsupported';
  const located = locatorOf(chain.calls);
  if (!located || located.next !== chain.calls.length) return 'locator';
  return build(located.locator);
}

/** Lines that are structure, not actions: imports, the test wrapper, browser setup. */
const IGNORED =
  /^(import\s|const\s+\{|\(async|test\(|test\.(use|describe)|\}\)|\};?$|\}\)\(\);?|await\s+(context|browser)\.close\(\)|\/\/|\/\*|\*)/;
/** Browser setup in library-style output; may span lines (`chromium.launch({ ... })`). */
const SETUP = /^const\s+(browser|context|page)\s*=/;

/** Opening minus closing parentheses outside string literals. */
function parenBalance(line: string): number {
  let balance = 0;
  for (const char of line.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '')) {
    if (char === '(') balance++;
    if (char === ')') balance--;
  }
  return balance;
}

/**
 * Converts `npx playwright codegen` output (JavaScript or TypeScript) into steps. Statements it
 * cannot express become warnings with their line numbers.
 */
export function parsePlaywrightCode(code: string): ImportResult {
  const steps: TestStep[] = [];
  const warnings: ImportWarning[] = [];
  const lines = code.split(/\r?\n/);
  let buffer = '';
  let startLine = 0;
  let depth = 0;
  let skipDepth = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim();
    if (skipDepth > 0) {
      skipDepth = Math.max(0, skipDepth + parenBalance(line));
      continue;
    }
    if (!buffer) {
      if (!line || IGNORED.test(line)) continue;
      if (SETUP.test(line)) {
        skipDepth = Math.max(0, parenBalance(line));
        continue;
      }
      startLine = index + 1;
      depth = 0;
    }
    buffer += (buffer ? ' ' : '') + line;
    depth += parenBalance(line);
    if (depth > 0) continue;
    const statement = buffer
      .replace(/;\s*$/, '')
      .replace(/^await\s+/, '')
      .trim();
    const text = buffer;
    buffer = '';
    const result = expectStep(statement) ?? statementStep(statement);
    if (typeof result === 'string') warnings.push({ line: startLine, text, reason: result });
    else steps.push(result);
  }
  if (buffer) warnings.push({ line: startLine, text: buffer, reason: 'syntax' });
  return { steps, warnings };
}
