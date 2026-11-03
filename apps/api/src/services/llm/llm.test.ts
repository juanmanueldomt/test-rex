import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { toProposal } from './assist';
import { LlmError, openAiCompatibleProvider } from './providers';
import { decryptSecret, encryptSecret } from './secrets';

const SECRET = 'a-test-secret-that-is-long-enough-123456';

describe('secrets', () => {
  it('round-trips with the same APP_SECRET and fails with another', () => {
    const stored = encryptSecret(SECRET, 'sk-live-123');
    expect(stored).toMatch(/^v1:[^:]+:[^:]+:[^:]+$/);
    expect(stored).not.toContain('sk-live');
    expect(encryptSecret(SECRET, 'sk-live-123')).not.toBe(stored);
    expect(decryptSecret(SECRET, stored)).toBe('sk-live-123');
    expect(() => decryptSecret(`${SECRET}-rotated`, stored)).toThrow();
    expect(() => decryptSecret(SECRET, 'plain')).toThrow();
  });
});

function fakeFetch(handler: (url: string, init: RequestInit) => Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  }) as typeof fetch;
  return { impl, calls };
}

const config = {
  provider: 'openai_compatible' as const,
  model: 'llama3.1',
  baseUrl: 'http://ollama:11434/v1/',
  apiKey: 'key-1',
};

describe('OpenAI-compatible provider', () => {
  const schema = z.object({ answer: z.string() });

  it('asks for JSON with the schema and validates the answer', async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({ choices: [{ message: { content: '```json\n{"answer":"42"}\n```' } }] }),
    );
    const provider = openAiCompatibleProvider(config, impl);
    expect(await provider.generate({ system: 'Be brief.', prompt: 'Question?', schema })).toEqual({
      answer: '42',
    });
    expect(calls[0]!.url).toBe('http://ollama:11434/v1/chat/completions');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer key-1');
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].content).toContain('"answer"');
  });

  it('maps HTTP errors and invalid output to LlmError codes', async () => {
    const unauthorized = openAiCompatibleProvider(
      config,
      fakeFetch(() => new Response('', { status: 401 })).impl,
    );
    await expect(unauthorized.generate({ system: '', prompt: '', schema })).rejects.toMatchObject({
      code: 'AI_AUTH',
    });
    const invalid = openAiCompatibleProvider(
      config,
      fakeFetch(() => Response.json({ choices: [{ message: { content: '{"other":1}' } }] })).impl,
    );
    await expect(invalid.generate({ system: '', prompt: '', schema })).rejects.toBeInstanceOf(
      LlmError,
    );
    const missingModel = openAiCompatibleProvider(
      config,
      fakeFetch(() => Response.json({ data: [{ id: 'mistral' }] })).impl,
    );
    await expect(missingModel.test()).rejects.toMatchObject({ code: 'AI_BAD_REQUEST' });
  });
});

describe('toProposal', () => {
  it('keeps known step ids once and replaces unknown ones', () => {
    const step = (id: string) => ({
      id,
      action: 'goto' as const,
      target: null,
      value: '/',
      description: '',
      expected: '',
    });
    const proposal = toProposal(
      {
        title: '  Open  ',
        priority: 'low',
        description: '',
        preconditions: '',
        tags: [],
        steps: [step('a'), step('a'), step('zzz')],
      },
      'automated',
      ['a'],
    );
    expect(proposal.title).toBe('Open');
    expect(proposal.steps[0]!.id).toBe('a');
    expect(proposal.steps[1]!.id).not.toBe('a');
    expect(proposal.steps[2]!.id).not.toBe('zzz');
  });
});
