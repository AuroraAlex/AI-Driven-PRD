/**
 * MarkdownTools — left-column bottom panel shown when the center face is the
 * Markdown editor. Provides:
 *   - Document outline (parsed h1/h2/h3 headings) — click to scroll
 *   - Quick-insert snippets (table, mermaid, math, link)
 *   - Word/char counts
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Hash, TableProperties, Workflow, Sigma, Link2, Image as ImageIcon,
  ListTree,
} from 'lucide-react'
import { resourcesApi } from '../../api/client'
import { useWorkspace } from './WorkspaceContext'

interface Heading { level: number; text: string; line: number }

function parseHeadings(md: string): Heading[] {
  const out: Heading[] = []
  const lines = md.split('\n')
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^```/.test(l)) { inFence = !inFence; continue }
    if (inFence) continue
    const m = /^(#{1,3})\s+(.+?)\s*$/.exec(l)
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 })
  }
  return out
}

interface Props { projectId: string }

export default function MarkdownTools({ projectId }: Props) {
  const { editingResourceId, markdownEditorRef } = useWorkspace()

  const { data: doc } = useQuery({
    queryKey: ['resource', projectId, editingResourceId],
    queryFn: () => resourcesApi.get(projectId, editingResourceId!),
    enabled: !!editingResourceId,
  })

  const text = doc?.markdown_content ?? ''
  const headings = useMemo(() => parseHeadings(text), [text])
  const charCount = text.length
  const wordCount = useMemo(
    () => (text.match(/[\u4e00-\u9fa5]|[A-Za-z0-9]+/g) ?? []).length,
    [text],
  )

  const insert = (s: string) => markdownEditorRef.current?.insertAtCursor(s)
  const SNIPPETS = [
    { key: 'table', icon: <TableProperties size={13} />, label: '表格',
      text: '\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|     |     |     |\n' },
    { key: 'mermaid', icon: <Workflow size={13} />, label: 'Mermaid',
      text: '\n```mermaid\nflowchart LR\n  A --> B\n```\n' },
    { key: 'math', icon: <Sigma size={13} />, label: '公式',
      text: '\n$$\nE = mc^2\n$$\n' },
    { key: 'link', icon: <Link2 size={13} />, label: '链接',
      text: '[文字](https://)' },
    { key: 'image', icon: <ImageIcon size={13} />, label: '图片',
      text: '![alt](https://)' },
  ]

  const disabled = !editingResourceId
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Outline */}
      <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-1.5 shrink-0">
        <ListTree size={13} className="text-[var(--text-secondary)]" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">大纲</span>
        <span className="ml-auto text-[10px] text-[var(--text-tertiary)]">{headings.length} 项</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-1">
        {disabled ? (
          <p className="text-[11px] text-[var(--text-tertiary)] px-2 py-3">无活动文档</p>
        ) : headings.length === 0 ? (
          <p className="text-[11px] text-[var(--text-tertiary)] px-2 py-3">尚未添加标题</p>
        ) : (
          <ul className="flex flex-col">
            {headings.map((h, i) => (
              <li key={`${h.line}-${i}`}>
                <button
                  className="w-full text-left text-xs px-2 py-1 rounded hover:bg-[var(--accent-light)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1.5"
                  style={{ paddingLeft: 8 + (h.level - 1) * 12 }}
                  onClick={() => markdownEditorRef.current?.scrollToLine(h.line)}
                  title={h.text}
                >
                  <Hash size={10} className="opacity-50 shrink-0" />
                  <span className="truncate">{h.text}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Snippets */}
      <div className="border-t border-[var(--border)] shrink-0">
        <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
          快速插入
        </div>
        <div className="grid grid-cols-2 gap-1 px-2 pb-2">
          {SNIPPETS.map(s => (
            <button
              key={s.key}
              disabled={disabled}
              onClick={() => insert(s.text)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] rounded border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {s.icon}{s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Counts */}
      <div className="px-3 py-2 border-t border-[var(--border)] flex items-center justify-between text-[10px] text-[var(--text-tertiary)] shrink-0">
        <span>{wordCount} 词</span>
        <span>{charCount} 字符</span>
      </div>
    </div>
  )
}
