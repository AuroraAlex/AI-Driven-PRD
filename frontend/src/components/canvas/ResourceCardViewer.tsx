/**
 * ResourceCardViewer — modal that displays the full content of the resource
 * bound to a resource card (file_card). When the markdown body exceeds
 * `PAGE_SIZE` characters, splits it into pages so the modal stays scannable.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, ExternalLink, ChevronLeft, ChevronRight, FileText, Database } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCanvasStore } from '../../store/canvasStore'
import { resourcesApi } from '../../api/client'
import type { CanvasEl } from './nodeInsert'
import MarkdownPreview from '../markdown/MarkdownPreview'
import { Spinner } from '../ui'

const PAGE_SIZE = 4000  // chars per page

interface Props {
  projectId: string
}

/** Find the file_card root element with the given group id. */
function findResourceCard(api: ReturnType<typeof useCanvasStore.getState>['api'], gid: string) {
  if (!api) return null
  const els = api.getSceneElements() as unknown as CanvasEl[]
  return els.find(el => el.customData?.nodeType === 'file_card' && el.groupIds?.includes(gid)) ?? null
}

/** Split a long markdown string at paragraph boundaries to keep code/headings intact. */
function paginate(md: string, pageSize: number): string[] {
  if (md.length <= pageSize) return [md]
  const pages: string[] = []
  // Split on blank lines so we don't cut a paragraph or fenced block in half
  // (best-effort — fenced blocks larger than pageSize will still be force-cut).
  const blocks = md.split(/\n{2,}/)
  let current = ''
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : block
    if (candidate.length > pageSize && current) {
      pages.push(current)
      current = block
    } else if (candidate.length > pageSize) {
      // Single block bigger than pageSize → hard chunk
      let rest = block
      while (rest.length > pageSize) {
        pages.push(rest.slice(0, pageSize))
        rest = rest.slice(pageSize)
      }
      current = rest
    } else {
      current = candidate
    }
  }
  if (current) pages.push(current)
  return pages
}

export default function ResourceCardViewer({ projectId }: Props) {
  const openId = useCanvasStore(s => s.openResourceCardId)
  const setOpenId = useCanvasStore(s => s.setOpenResourceCardId)
  const api = useCanvasStore(s => s.api)
  const navigate = useNavigate()
  const [page, setPage] = useState(0)

  const cardEl = useMemo(() => (openId ? findResourceCard(api, openId) : null), [api, openId])
  const resourceId = (cardEl?.customData?.resourceId as string | undefined) ?? null

  const { data: resource, isLoading, error } = useQuery({
    queryKey: ['resource', projectId, resourceId],
    queryFn: () => resourcesApi.get(projectId, resourceId!),
    enabled: !!openId && !!resourceId,
  })

  const markdown = (resource?.markdown_content || resource?.extracted_text || '').trim()
  const pages = useMemo(() => paginate(markdown, PAGE_SIZE), [markdown])

  // Reset page index whenever a new resource opens
  useEffect(() => { setPage(0) }, [openId, resourceId])

  // Close on Esc
  useEffect(() => {
    if (!openId) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenId(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [openId, setOpenId])

  if (!openId) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => setOpenId(null)}
    >
      <div
        className="bg-[var(--bg-base)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-xl w-[min(900px,92vw)] h-[min(80vh,720px)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)] shrink-0">
          <FileText size={14} className="text-[var(--accent)]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
              {resource?.title || (resourceId ? '加载中…' : '未绑定资源')}
            </div>
            {resource && (
              <div className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-2">
                <span>{resource.kind}</span>
                {resource.is_in_kb && <span className="flex items-center gap-0.5"><Database size={9} /> 已入库</span>}
                <span>{markdown.length} 字符</span>
                {pages.length > 1 && <span>共 {pages.length} 页</span>}
              </div>
            )}
          </div>
          {resource && resource.kind === 'document' && (
            <button
              onClick={() => { setOpenId(null); navigate(`/projects/${projectId}/docs/${resource.id}`) }}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--text-primary)]"
              title="在文档编辑器中打开"
            >
              <ExternalLink size={12} /> 编辑
            </button>
          )}
          <button
            onClick={() => setOpenId(null)}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 bg-[var(--bg-base)]">
          {!resourceId ? (
            <div className="text-sm text-[var(--text-tertiary)] flex items-center justify-center h-full">
              该卡片未绑定资源，请在右侧检查器中选择一个资源。
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Spinner size={20} />
            </div>
          ) : error ? (
            <div className="text-sm text-[var(--error)]">加载失败：{(error as Error).message}</div>
          ) : !markdown ? (
            <div className="text-sm text-[var(--text-tertiary)]">资源内容为空。</div>
          ) : (
            <MarkdownPreview content={pages[page] ?? ''} />
          )}
        </div>

        {/* Pagination footer */}
        {pages.length > 1 && (
          <div className="flex items-center justify-center gap-3 px-4 py-2 border-t border-[var(--border)] shrink-0 text-xs">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="flex items-center gap-1 px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--accent-light)] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={12} /> 上一页
            </button>
            <span className="text-[var(--text-tertiary)]">
              第 {page + 1} / {pages.length} 页
            </span>
            <button
              onClick={() => setPage(p => Math.min(pages.length - 1, p + 1))}
              disabled={page >= pages.length - 1}
              className="flex items-center gap-1 px-2 py-1 rounded text-[var(--text-secondary)] hover:bg-[var(--accent-light)] disabled:opacity-40 disabled:hover:bg-transparent"
            >
              下一页 <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
