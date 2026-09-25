// TipTap configuration shared by the rich-text editor and the read-only Markdown view. Rich
// text is stored as Markdown; only extensions that serialize to Markdown losslessly are enabled.
import { mergeAttributes, type AnyExtension } from '@tiptap/core';
import Image, { type ImageOptions } from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { Markdown } from '@tiptap/markdown';
import StarterKit from '@tiptap/starter-kit';
import { Lexer, Marked, type marked, type Token, type TokensList } from 'marked';

type AnyToken = Token & { tokens?: Token[]; items?: Token[]; header?: Token[]; rows?: Token[][] };

/** Replaces raw HTML tokens with literal text, recursively and in place. */
function neutralizeHtml(tokens: Token[]): void {
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as AnyToken;
    if (token.type === 'html') {
      const text = { type: 'text', raw: token.raw, text: token.raw, escaped: false } as Token;
      tokens[index] = (token as { block?: boolean }).block
        ? ({ type: 'paragraph', raw: token.raw, text: token.raw, tokens: [text] } as Token)
        : text;
      continue;
    }
    if (token.tokens) neutralizeHtml(token.tokens);
    if (token.items) neutralizeHtml(token.items);
    if (token.header) neutralizeHtml(token.header);
    if (token.rows) for (const row of token.rows) neutralizeHtml(row);
  }
}

/** A lexer for which raw HTML in Markdown is just text: it is shown, never interpreted. */
class TextOnlyHtmlLexer extends Lexer {
  override lex(src: string): TokensList {
    const tokens = super.lex(src);
    neutralizeHtml(tokens);
    return tokens;
  }

  override inlineTokens(src: string, tokens: Token[] = []): Token[] {
    const result = super.inlineTokens(src, tokens);
    neutralizeHtml(result);
    return result;
  }
}

/** A private marked instance per editor (TipTap registers its tokenizers on it). */
export function createSafeMarked(): typeof marked {
  const instance = new Marked();
  (instance as unknown as { Lexer: unknown }).Lexer = TextOnlyHtmlLexer;
  return instance as unknown as typeof marked;
}

export interface ImageOptionsWithResolver {
  /** Maps the stored `src` (e.g. `attachment:<id>`) to a URL the browser can load. */
  resolveSrc: (src: string) => string;
}

/**
 * Images keep their stored `src` in the document (and thus in Markdown) and are displayed
 * through `resolveSrc`, so `attachment:<id>` stays valid if the organization slug changes.
 */
const AttachmentImage = Image.extend<ImageOptions & ImageOptionsWithResolver>({
  addOptions() {
    return {
      ...(this.parent?.() as ImageOptions),
      resolveSrc: (src: string) => src,
    };
  },
  renderHTML({ HTMLAttributes }) {
    const src = typeof HTMLAttributes.src === 'string' ? HTMLAttributes.src : '';
    return [
      'img',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        src: this.options.resolveSrc(src),
        loading: 'lazy',
      }),
    ];
  },
});

export interface MarkdownExtensionOptions {
  placeholder?: string;
  resolveImageSrc?: (src: string) => string;
}

export function markdownExtensions(options: MarkdownExtensionOptions = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      // Underline has no Markdown syntax, so it would not survive a save.
      underline: false,
      link: {
        openOnClick: false,
        autolink: true,
        protocols: ['http', 'https', 'mailto'],
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    AttachmentImage.configure({
      resolveSrc: options.resolveImageSrc ?? ((src: string) => src),
    }),
    TableKit.configure({ table: { resizable: false } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ...(options.placeholder ? [Placeholder.configure({ placeholder: options.placeholder })] : []),
    Markdown.configure({ marked: createSafeMarked() }),
  ];
}
