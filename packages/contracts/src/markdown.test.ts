import { describe, expect, it } from 'vitest';
import { attachmentIdFromUrl, attachmentMarkdownUrl, extractAttachmentIds } from './markdown';

const A = '0199a3c4-1111-7000-8000-00000000000a';
const B = '0199a3c4-2222-7000-8000-00000000000b';
const C = '0199a3c4-3333-7000-8000-00000000000c';
const D = '0199a3c4-4444-7000-8000-00000000000d';

describe('extractAttachmentIds', () => {
  it('finds images in headings, lists and tables', () => {
    const markdown = [
      `## Setup ![logo](attachment:${A})`,
      '',
      `- step one ![shot](attachment:${B} "title")`,
      `  1. nested ![](attachment:${A})`,
      '',
      '| field | image |',
      '| --- | --- |',
      `| coupon | ![c](attachment:${C.toUpperCase()}) |`,
      '',
      `[ref]: attachment:${D}`,
    ].join('\n');
    expect(extractAttachmentIds(markdown)).toEqual([A, B, C, D]);
  });

  it('ignores other URLs and plain mentions', () => {
    const markdown = [
      '![remote](https://example.com/a.png)',
      `[doc](https://example.com/attachment:${A})`,
      `the id attachment:${B} in text`,
      '![bad](attachment:not-a-uuid)',
    ].join('\n');
    expect(extractAttachmentIds(markdown)).toEqual([]);
  });

  it('round-trips with attachmentMarkdownUrl', () => {
    expect(extractAttachmentIds(`![x](${attachmentMarkdownUrl(A)})`)).toEqual([A]);
    expect(attachmentIdFromUrl(`attachment:${A}`)).toBe(A);
    expect(attachmentIdFromUrl('https://example.com/x.png')).toBeNull();
  });
});
