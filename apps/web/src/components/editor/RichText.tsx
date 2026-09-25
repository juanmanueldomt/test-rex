import { attachmentIdFromUrl, attachmentMarkdownUrl } from '@testrex/contracts';
import { cn } from '@testrex/ui';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  SquareCode,
  Strikethrough,
  Table2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { markdownExtensions } from './markdown';

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

/** Turns `attachment:<id>` into the download URL of the current application. */
export function attachmentResolver(orgSlug: string, appKey: string) {
  return (src: string) => {
    const id = attachmentIdFromUrl(src);
    return id ? `/api/orgs/${orgSlug}/apps/${appKey}/attachments/${id}` : src;
  };
}

export interface RichTextEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  /** Id of the visible label element, and its text (names the toolbar). */
  labelledBy: string;
  label: string;
  describedBy?: string;
  invalid?: boolean;
  placeholder?: string;
  resolveImageSrc: (src: string) => string;
  /** Uploads a pasted/dropped/chosen image and returns its attachment id. */
  onUploadImage?: (file: File) => Promise<string>;
  className?: string;
}

function ToolbarButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-4',
        active && 'bg-muted text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({
  editor,
  label,
  onPickImage,
}: {
  editor: Editor;
  label: string;
  onPickImage?: () => void;
}) {
  const { t } = useTranslation();
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined;
    const href = window.prompt(t('editor.linkPrompt'), previous ?? 'https://');
    if (href === null) return;
    if (href.trim() === '') chain().unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };
  return (
    <div
      role="toolbar"
      aria-label={t('editor.toolbar', { field: label })}
      className="flex flex-wrap items-center gap-0.5 border-b px-1 py-1"
    >
      <ToolbarButton
        label={t('editor.heading2')}
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => chain().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.heading3')}
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => chain().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.bold')}
        active={editor.isActive('bold')}
        onClick={() => chain().toggleBold().run()}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.italic')}
        active={editor.isActive('italic')}
        onClick={() => chain().toggleItalic().run()}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.strike')}
        active={editor.isActive('strike')}
        onClick={() => chain().toggleStrike().run()}
      >
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.code')}
        active={editor.isActive('code')}
        onClick={() => chain().toggleCode().run()}
      >
        <Code />
      </ToolbarButton>
      <span className="mx-1 h-5 w-px bg-border" aria-hidden />
      <ToolbarButton
        label={t('editor.bulletList')}
        active={editor.isActive('bulletList')}
        onClick={() => chain().toggleBulletList().run()}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.orderedList')}
        active={editor.isActive('orderedList')}
        onClick={() => chain().toggleOrderedList().run()}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.taskList')}
        active={editor.isActive('taskList')}
        onClick={() => chain().toggleTaskList().run()}
      >
        <ListChecks />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.codeBlock')}
        active={editor.isActive('codeBlock')}
        onClick={() => chain().toggleCodeBlock().run()}
      >
        <SquareCode />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.table')}
        onClick={() => chain().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}
      >
        <Table2 />
      </ToolbarButton>
      <ToolbarButton label={t('editor.link')} active={editor.isActive('link')} onClick={setLink}>
        <Link2 />
      </ToolbarButton>
      {onPickImage ? (
        <ToolbarButton label={t('editor.image')} onClick={onPickImage}>
          <ImagePlus />
        </ToolbarButton>
      ) : null}
    </div>
  );
}

const contentClasses =
  'rich-text min-h-32 px-3 py-2 text-sm focus-visible:outline-none [&_.ProseMirror]:min-h-28 [&_.ProseMirror]:outline-none';

/** Markdown rich-text editor (TipTap). Images pasted or dropped are uploaded as attachments. */
export function RichTextEditor({
  value,
  onChange,
  labelledBy,
  label,
  describedBy,
  invalid,
  placeholder,
  resolveImageSrc,
  onUploadImage,
  className,
}: RichTextEditorProps) {
  const { t } = useTranslation();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadRef = useRef(onUploadImage);
  const changeRef = useRef(onChange);
  useEffect(() => {
    uploadRef.current = onUploadImage;
    changeRef.current = onChange;
  });

  const extensions = useMemo(
    () => markdownExtensions({ placeholder, resolveImageSrc }),
    [placeholder, resolveImageSrc],
  );

  const editor = useEditor(
    {
      extensions,
      content: value,
      contentType: 'markdown',
      editorProps: {
        attributes: {
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-labelledby': labelledBy,
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          ...(invalid ? { 'aria-invalid': 'true' } : {}),
        },
        handlePaste: (_view, event) => insertImages(event.clipboardData?.files),
        handleDrop: (view, event) => {
          const files = (event as DragEvent).dataTransfer?.files;
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
          return insertImages(files, position);
        },
      },
      onUpdate: ({ editor: current }) => changeRef.current(current.getMarkdown()),
    },
    [extensions],
  );

  function insertImages(files: FileList | null | undefined, position?: number): boolean {
    const images = [...(files ?? [])].filter((file) => IMAGE_TYPES.includes(file.type));
    const upload = uploadRef.current;
    if (images.length === 0 || !upload) return false;
    void (async () => {
      for (const file of images) {
        try {
          const id = await upload(file);
          const node = {
            type: 'image',
            attrs: { src: attachmentMarkdownUrl(id), alt: file.name.replace(/\.[^.]+$/, '') },
          };
          if (position !== undefined) editor?.chain().insertContentAt(position, node).run();
          else editor?.chain().focus().insertContent(node).run();
        } catch {
          // The upload callback reports the error to the user.
        }
      }
    })();
    return true;
  }

  // Replace the content when the value changes from outside (e.g. a revision is restored).
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.getMarkdown() !== value && !editor.isFocused) {
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false });
    }
  }, [editor, value]);

  if (!editor) return null;
  return (
    <div
      className={cn(
        'rounded-md border border-input bg-card shadow-xs focus-within:ring-2 focus-within:ring-ring',
        invalid && 'border-destructive',
        className,
      )}
    >
      <Toolbar
        editor={editor}
        label={label}
        onPickImage={onUploadImage ? () => fileInput.current?.click() : undefined}
      />
      <EditorContent editor={editor} className={contentClasses} />
      {onUploadImage ? (
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(',')}
          className="sr-only"
          tabIndex={-1}
          aria-label={t('editor.image')}
          onChange={(event) => {
            insertImages(event.target.files);
            event.target.value = '';
          }}
        />
      ) : null}
    </div>
  );
}

/** Read-only rendering of stored Markdown with the same extensions (no second renderer). */
export function MarkdownView({
  markdown,
  resolveImageSrc,
  className,
  emptyText,
}: {
  markdown: string;
  resolveImageSrc: (src: string) => string;
  className?: string;
  emptyText?: string;
}) {
  const extensions = useMemo(() => markdownExtensions({ resolveImageSrc }), [resolveImageSrc]);
  const editor = useEditor(
    {
      extensions,
      content: markdown,
      contentType: 'markdown',
      editable: false,
      // Rendered text, not a field: drop the textbox role TipTap adds to every editor.
      editorProps: { attributes: { role: 'presentation' } },
    },
    [extensions, markdown],
  );
  if (!markdown.trim()) {
    return emptyText ? <p className="text-sm text-muted-foreground">{emptyText}</p> : null;
  }
  return <EditorContent editor={editor} className={cn('rich-text text-sm', className)} />;
}
