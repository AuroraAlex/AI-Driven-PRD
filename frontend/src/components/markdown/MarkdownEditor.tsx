/**
 * MarkdownEditor — CodeMirror 6 editor + live preview pane.
 *
 * Layout modes: 'edit' | 'split' | 'preview'.
 * Toolbar inserts standard Markdown snippets at the cursor.
 * Calls `onChange` on every edit; the parent owns debounce/save logic.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { ForwardRefRenderFunction } from 'react'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  EditorView, keymap, lineNumbers, highlightActiveLine,
  drawSelection, rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { oneDark, oneDarkHighlightStyle } from '@codemirror/theme-one-dark'
import {
  Bold, Italic, Heading1, Heading2, Heading3, List, ListOrdered, Link2,
  Code as CodeIcon, Quote, Table as TableIcon, Image as ImageIcon, Sigma,
  Workflow, Eye, FileText, Columns,
} from 'lucide-react'
import MarkdownPreview from './MarkdownPreview'
import { useDarkMode } from '../../hooks/useDarkMode'

type Mode = 'edit' | 'split' | 'preview'

interface Props {
  value: string
  onChange: (next: string) => void
  placeholder?: string
  mode?: Mode
  onModeChange?: (m: Mode) => void
  className?: string
}

interface Snippet {
  before: string
  after?: string
  placeholder?: string
  block?: boolean
}

const SNIPPETS = {
  bold: { before: '**', after: '**', placeholder: '加粗文本' } as Snippet,
  italic: { before: '*', after: '*', placeholder: '斜体' } as Snippet,
  h1: { before: '# ', placeholder: '一级标题', block: true } as Snippet,
  h2: { before: '## ', placeholder: '二级标题', block: true } as Snippet,
  h3: { before: '### ', placeholder: '三级标题', block: true } as Snippet,
  ul: { before: '- ', placeholder: '列表项', block: true } as Snippet,
  ol: { before: '1. ', placeholder: '列表项', block: true } as Snippet,
  link: { before: '[', after: '](https://)', placeholder: '链接文字' } as Snippet,
  inlineCode: { before: '`', after: '`', placeholder: '代码' } as Snippet,
  codeBlock: { before: '```\n', after: '\n```', placeholder: 'code', block: true } as Snippet,
  quote: { before: '> ', placeholder: '引用', block: true } as Snippet,
  image: { before: '![', after: '](https://)', placeholder: 'alt 文本' } as Snippet,
  math: { before: '$$\n', after: '\n$$', placeholder: 'E = mc^2', block: true } as Snippet,
  mermaid: { before: '```mermaid\nflowchart LR\n', after: '\n```', placeholder: 'A --> B', block: true } as Snippet,
  table: {
    before: '| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| ',
    after: ' |  |  |',
    placeholder: '内容',
    block: true,
  } as Snippet,
}

function applySnippet(view: EditorView, s: Snippet) {
  const { state } = view
  const sel = state.selection.main
  const selected = state.sliceDoc(sel.from, sel.to)
  const text = selected || s.placeholder || ''
  const insert = `${s.before}${text}${s.after ?? ''}`
  let from = sel.from
  let to = sel.to
  if (s.block) {
    const line = state.doc.lineAt(sel.from)
    const atLineStart = sel.from === line.from
    if (!atLineStart) {
      // Move to start of next line if not at line start
      from = sel.from
      to = sel.to
      view.dispatch({
        changes: { from: line.to, insert: `\n${insert}` },
        selection: { anchor: line.to + 1 + s.before.length, head: line.to + 1 + s.before.length + text.length },
      })
      view.focus()
      return
    }
  }
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + s.before.length,
      head: from + s.before.length + text.length,
    },
  })
  view.focus()
}

export interface MarkdownEditorHandle {
  getValue: () => string
  insertAtCursor: (text: string) => void
  scrollToLine: (line: number) => void
}

const MarkdownEditorImpl: ForwardRefRenderFunction<MarkdownEditorHandle, Props> = ({
  value, onChange, placeholder, mode: modeProp, onModeChange, className,
}, ref) => {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const isDark = useDarkMode()
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    insertAtCursor: (text: string) => {
      const view = viewRef.current
      if (!view) return
      const sel = view.state.selection.main
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      })
      view.focus()
    },
    scrollToLine: (line: number) => {
      const view = viewRef.current
      if (!view) return
      const safe = Math.max(1, Math.min(line, view.state.doc.lines))
      const pos = view.state.doc.line(safe).from
      view.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 24 }),
      })
      view.focus()
    },
  }), [])

  const [internalMode, setInternalMode] = useState<Mode>('split')
  const mode = modeProp ?? internalMode
  const setMode = (m: Mode) => {
    if (onModeChange) onModeChange(m)
    else setInternalMode(m)
  }

  // Initialize CodeMirror once
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return
    const themeExt: Extension = isDark
      ? [oneDark, syntaxHighlighting(oneDarkHighlightStyle)]
      : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]
    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        lineNumbers(),
        highlightActiveLine(),
        drawSelection(),
        rectangularSelection(),
        indentOnInput(),
        bracketMatching(),
        markdown({ base: markdownLanguage }),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            onChangeRef.current(u.state.doc.toString())
          }
        }),
        themeCompartment.current.of(themeExt),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
          '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', overflow: 'auto' },
          '.cm-content': { padding: '12px 0' },
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Swap CodeMirror theme reactively when the OS / app theme flips.
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const themeExt: Extension = isDark
      ? [oneDark, syntaxHighlighting(oneDarkHighlightStyle)]
      : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]
    view.dispatch({ effects: themeCompartment.current.reconfigure(themeExt) })
  }, [isDark])

  // Sync external value changes (e.g. when switching documents)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Re-measure CodeMirror after the editor pane becomes visible again,
  // otherwise the gutter/scroller dimensions are stale and clicks may miss.
  useEffect(() => {
    if (mode === 'preview') return
    const view = viewRef.current
    if (!view) return
    requestAnimationFrame(() => view.requestMeasure())
  }, [mode])

  const tools = useMemo(() => [
    { key: 'bold', icon: <Bold size={14} />, snip: SNIPPETS.bold, title: '加粗' },
    { key: 'italic', icon: <Italic size={14} />, snip: SNIPPETS.italic, title: '斜体' },
    { key: 'h1', icon: <Heading1 size={14} />, snip: SNIPPETS.h1, title: '一级标题' },
    { key: 'h2', icon: <Heading2 size={14} />, snip: SNIPPETS.h2, title: '二级标题' },
    { key: 'h3', icon: <Heading3 size={14} />, snip: SNIPPETS.h3, title: '三级标题' },
    { key: 'ul', icon: <List size={14} />, snip: SNIPPETS.ul, title: '无序列表' },
    { key: 'ol', icon: <ListOrdered size={14} />, snip: SNIPPETS.ol, title: '有序列表' },
    { key: 'quote', icon: <Quote size={14} />, snip: SNIPPETS.quote, title: '引用' },
    { key: 'inlineCode', icon: <CodeIcon size={14} />, snip: SNIPPETS.inlineCode, title: '行内代码' },
    { key: 'codeBlock', icon: <CodeIcon size={14} className="opacity-70" />, snip: SNIPPETS.codeBlock, title: '代码块' },
    { key: 'link', icon: <Link2 size={14} />, snip: SNIPPETS.link, title: '链接' },
    { key: 'image', icon: <ImageIcon size={14} />, snip: SNIPPETS.image, title: '图片' },
    { key: 'table', icon: <TableIcon size={14} />, snip: SNIPPETS.table, title: '表格' },
    { key: 'math', icon: <Sigma size={14} />, snip: SNIPPETS.math, title: 'LaTeX 公式' },
    { key: 'mermaid', icon: <Workflow size={14} />, snip: SNIPPETS.mermaid, title: 'Mermaid 图' },
  ], [])

  return (
    <div className={`flex flex-col h-full overflow-hidden ${className ?? ''}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[var(--border)] shrink-0 flex-wrap bg-[var(--bg-surface)]">
        {tools.map(t => (
          <button
            key={t.key}
            type="button"
            title={t.title}
            onMouseDown={(e) => {
              e.preventDefault()
              if (viewRef.current) applySnippet(viewRef.current, t.snip)
            }}
            className="p-1.5 rounded hover:bg-[var(--accent-light)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t.icon}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          {[
            { id: 'edit' as Mode, icon: <FileText size={14} />, label: '编辑' },
            { id: 'split' as Mode, icon: <Columns size={14} />, label: '分屏' },
            { id: 'preview' as Mode, icon: <Eye size={14} />, label: '预览' },
          ].map(m => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${
                mode === m.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--accent-light)]'
              }`}
            >
              {m.icon} {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Editor host stays mounted across mode switches so CodeMirror keeps its DOM. */}
        <div
          ref={hostRef}
          className={`overflow-hidden bg-[var(--bg-surface)] ${
            mode === 'preview'
              ? 'hidden'
              : mode === 'split'
                ? 'w-1/2 border-r border-[var(--border)]'
                : 'w-full'
          }`}
          data-placeholder={placeholder}
        />
        {(mode === 'preview' || mode === 'split') && (
          <div className={`overflow-y-auto bg-[var(--bg-base)] px-6 py-4 ${mode === 'split' ? 'w-1/2' : 'w-full'}`}>
            {value.trim()
              ? <MarkdownPreview content={value} />
              : <div className="text-xs text-[var(--text-tertiary)]">暂无内容</div>
            }
          </div>
        )}
      </div>
    </div>
  )
}

const MarkdownEditor = forwardRef(MarkdownEditorImpl)
export default MarkdownEditor
