import { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableHeader } from '@tiptap/extension-table-header'
import { TableCell } from '@tiptap/extension-table-cell'
import { Placeholder } from '@tiptap/extension-placeholder'
import type { PRDDocument } from '../api/client'
import { prdApi } from '../api/client'

interface Props {
  prd: PRDDocument
  onSave?: (prd: PRDDocument) => void
}

export default function PRDEditor({ prd, onSave }: Props) {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Placeholder.configure({ placeholder: 'Your PRD content will appear here…' }),
    ],
    content: prd.content_html,
    editorProps: {
      attributes: {
        class:
          'prose prose-sm max-w-none min-h-[200px] px-6 py-4 focus:outline-none text-[var(--text-primary)]',
      },
    },
    onUpdate: ({ editor }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(async () => {
        const html = editor.getHTML()
        const updated = await prdApi.update(prd.project_id, prd.id, { content_html: html })
        onSave?.(updated)
      }, 2000)
    },
  })

  // Update editor when a different PRD is opened
  useEffect(() => {
    if (editor && prd.content_html !== editor.getHTML()) {
      editor.commands.setContent(prd.content_html, false)
    }
  }, [prd.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border)] shrink-0 flex-wrap">
        {[
          { label: 'B', action: () => editor?.chain().focus().toggleBold().run(), active: editor?.isActive('bold') },
          { label: 'I', action: () => editor?.chain().focus().toggleItalic().run(), active: editor?.isActive('italic') },
          { label: 'H1', action: () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), active: editor?.isActive('heading', { level: 1 }) },
          { label: 'H2', action: () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), active: editor?.isActive('heading', { level: 2 }) },
          { label: 'H3', action: () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), active: editor?.isActive('heading', { level: 3 }) },
          { label: '• List', action: () => editor?.chain().focus().toggleBulletList().run(), active: editor?.isActive('bulletList') },
          { label: '1. List', action: () => editor?.chain().focus().toggleOrderedList().run(), active: editor?.isActive('orderedList') },
        ].map(btn => (
          <button
            key={btn.label}
            onMouseDown={e => { e.preventDefault(); btn.action() }}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              btn.active
                ? 'bg-[var(--accent)] text-white'
                : 'hover:bg-[var(--accent-light)] text-[var(--text-secondary)]'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-y-auto bg-white">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  )
}
