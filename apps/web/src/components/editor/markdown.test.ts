// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'vitest';
import { markdownExtensions } from './markdown';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function load(markdown: string, resolveImageSrc?: (src: string) => string): Editor {
  const editor = new Editor({
    extensions: markdownExtensions({ resolveImageSrc }),
    content: markdown,
    contentType: 'markdown',
  });
  editors.push(editor);
  return editor;
}

/** Markdown after one load/save cycle. */
const roundTrip = (markdown: string) => load(markdown).getMarkdown();

const ATTACHMENT = '0199a3c4-1111-7000-8000-00000000000a';

const FIXTURE = [
  '# Guest checkout with coupon',
  '',
  '## Test data',
  '',
  '- coupon `SAVE10`',
  '- customer:',
  '  - guest, no account',
  '  - billing in **EUR**',
  '',
  '## Navigation',
  '',
  '1. Open the cart',
  '2. Apply *the coupon* and ~~press enter~~ click [Apply](https://example.com/apply)',
  '',
  '- [ ] coupon field visible',
  '- [x] total updated',
  '',
  '| Field | Value |',
  '| --- | --- |',
  '| coupon | SAVE10 |',
  '| total | 90.00 |',
  '',
  '```ts',
  'const total = apply(cart, "SAVE10");',
  '```',
  '',
  `![checkout screen](attachment:${ATTACHMENT})`,
].join('\n');

describe('Markdown round trip', () => {
  it('keeps headings, nested lists, task lists, tables, code and images', () => {
    const once = roundTrip(FIXTURE);
    // A second cycle changes nothing, and the document structure is the same as the input's.
    expect(roundTrip(once)).toBe(once);
    expect(load(once).getJSON()).toEqual(load(FIXTURE).getJSON());

    expect(once).toContain('# Guest checkout with coupon');
    expect(once).toContain('## Test data');
    expect(once).toMatch(/- customer:\n {2}- guest, no account\n {2}- billing in \*\*EUR\*\*/);
    expect(once).toMatch(/1\. Open the cart\n2\. Apply/);
    expect(once).toContain('- [ ] coupon field visible');
    expect(once).toContain('- [x] total updated');
    expect(once).toMatch(/\| *coupon *\| *SAVE10 *\|/);
    expect(once).toContain('```ts\nconst total = apply(cart, "SAVE10");\n```');
    expect(once).toContain(`![checkout screen](attachment:${ATTACHMENT})`);
    expect(once).toContain('[Apply](https://example.com/apply)');
  });

  it('keeps each headed section of steps to reach with its list', () => {
    const steps = '## Test data\n\n- user A\n- user B\n\n## Navigation\n\n- open cart\n- pay';
    const json = load(roundTrip(steps)).getJSON();
    expect(json.content?.map((node) => node.type)).toEqual([
      'heading',
      'bulletList',
      'heading',
      'bulletList',
    ]);
  });
});

describe('safety', () => {
  it('shows raw HTML as text instead of rendering it', () => {
    const editor = load(
      'Hello <script>alert(1)</script> and <b>bold?</b>\n\n<div onclick="x()">block</div>',
    );
    const html = editor.getHTML();
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('<div onclick');
    expect(editor.getText()).toContain('<script>alert(1)</script>');
    expect(editor.getText()).toContain('<b>bold?</b>');
    expect(editor.getText()).toContain('<div onclick="x()">block</div>');
  });

  it('does not create javascript: links', () => {
    const html = load('[click](javascript:alert(1))').getHTML();
    expect(html).not.toMatch(/href="javascript:/i);
  });

  it('resolves attachment images for display but stores the attachment reference', () => {
    const editor = load(`![shot](attachment:${ATTACHMENT})`, (src) =>
      src.replace('attachment:', '/api/orgs/acme/apps/CHK/attachments/'),
    );
    expect(editor.getHTML()).toContain(`src="/api/orgs/acme/apps/CHK/attachments/${ATTACHMENT}"`);
    expect(editor.getMarkdown()).toContain(`(attachment:${ATTACHMENT})`);
  });
});
