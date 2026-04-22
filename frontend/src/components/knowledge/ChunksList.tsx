/**
 * ChunksList — paginated browser of every text chunk LightRAG has embedded
 * for the project. Lets the user verify what content is actually in the KB
 * (vs what's in the resource list).
 *
 * Server-side filtering by substring + per-document. Each row shows token
 * count, chunk index within source doc, and source resource title.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search, ChevronLeft, ChevronRight, Loader2, Layers } from 'lucide-react'
import { knowledgeApi, type KBChunk } from '../../api/client'

interface Props {
  projectId: string
}

const PAGE_SIZE = 25

export default function ChunksList({ projectId }: Props) {
  const [search, setSearch] = useState('')
  const [docFilter, setDocFilter] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)

  const offset = page * PAGE_SIZE

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['kb-chunks', projectId, search, docFilter, offset],
    queryFn: () => knowledgeApi.getChunks(projectId, {
      limit: PAGE_SIZE,
      offset,
      search: search || undefined,
      doc_id: docFilter || undefined,
    }),
    placeholderData: (prev) => prev,
  })

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // Build a doc list for the filter dropdown from the current page (best-effort)
  const docOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const c of items) {
      if (c.doc_id && !seen.has(c.doc_id)) {
        seen.set(c.doc_id, c.resource_title || c.doc_id)
      }
    }
    return Array.from(seen.entries())
  }, [items])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)] flex-wrap">
        <Layers size={14} className="text-[var(--accent)]" />
        <span className="text-sm font-semibold text-[var(--text-primary)]">嵌入片段</span>
        <span className="text-xs text-[var(--text-tertiary)]">共 {total} 个</span>

        <div className="flex-1" />

        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(0) }}
            placeholder="搜索片段内容…"
            className="pl-7 pr-2 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)] w-56"
          />
        </div>

        {docOptions.length > 0 && (
          <select
            value={docFilter}
            onChange={(e) => { setDocFilter(e.target.value); setPage(0) }}
            className="px-2 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
          >
            <option value="">全部来源</option>
            {docOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        )}

        {isFetching && <Loader2 size={12} className="animate-spin text-[var(--accent)]" />}
      </header>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="p-6 text-center text-xs text-[var(--text-tertiary)]">加载中…</div>
        ) : items.length === 0 ? (
          <div className="p-10 text-center text-xs text-[var(--text-tertiary)]">
            没有匹配的片段。请先把资源加入知识库并完成索引。
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {items.map((c) => (
              <ChunkRow key={c.chunk_id} chunk={c} expanded={expanded === c.chunk_id} onToggle={() => setExpanded(expanded === c.chunk_id ? null : c.chunk_id)} />
            ))}
          </ul>
        )}
      </div>

      {total > PAGE_SIZE && (
        <footer className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] text-xs text-[var(--text-secondary)]">
          <span>第 {page + 1} / {totalPages} 页</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="p-1 rounded hover:bg-[var(--bg-surface)] disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="p-1 rounded hover:bg-[var(--bg-surface)] disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </footer>
      )}
    </div>
  )
}

function ChunkRow({ chunk, expanded, onToggle }: { chunk: KBChunk; expanded: boolean; onToggle: () => void }) {
  const preview = chunk.content.length > 240 ? chunk.content.slice(0, 240) + '…' : chunk.content
  return (
    <li className="px-4 py-3 hover:bg-[var(--accent-light)]/40 transition-colors">
      <div className="flex items-center gap-2 mb-1 text-[10px]">
        <span className="font-mono text-[var(--text-tertiary)] truncate max-w-[40%]" title={chunk.chunk_id}>
          {chunk.chunk_id}
        </span>
        <span className="text-[var(--text-secondary)]">·</span>
        <span className="text-[var(--text-secondary)] truncate" title={chunk.doc_id}>
          来源：{chunk.resource_title || chunk.doc_id || '未知'}
        </span>
        {chunk.tokens != null && (
          <>
            <span className="text-[var(--text-secondary)]">·</span>
            <span className="text-[var(--text-tertiary)]">{chunk.tokens} tokens</span>
          </>
        )}
        {chunk.chunk_order_index != null && (
          <>
            <span className="text-[var(--text-secondary)]">·</span>
            <span className="text-[var(--text-tertiary)]">#{chunk.chunk_order_index}</span>
          </>
        )}
      </div>
      <button onClick={onToggle} className="text-left w-full">
        <p className="text-xs text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed">
          {expanded ? chunk.content : preview}
        </p>
        {chunk.content.length > 240 && (
          <span className="text-[10px] text-[var(--accent)] mt-1 inline-block">
            {expanded ? '收起' : '展开全文'}
          </span>
        )}
      </button>
    </li>
  )
}
