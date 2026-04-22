/**
 * KnowledgePanel.tsx — dual-pane knowledge base browser.
 *
 * Left  : 未入库资源（user 手动选择加入）
 * Right : 已入库资源（user 可移出 KB）
 *
 * Click a resource on either side to open it (document/snippet) or to inspect
 * (file). The chevron button toggles `is_in_kb` via the resources API; the
 * backend syncs the underlying RAG index.
 *
 * The panel still exposes legacy "全部重建" / "重置图谱" controls for the
 * project-wide knowledge graph.
 */
import { useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database, Trash2, RefreshCcw, Loader2, FileText, Image as ImageIcon, File,
  StickyNote, ChevronRight, ChevronLeft,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  resourcesApi, knowledgeApi,
  type ResourceBlock, type ResourceKind, type ResourceRagStatus,
} from '../../api/client'

interface Props {
  projectId: string
}

const STATUS_LABEL: Record<ResourceRagStatus, string> = {
  unindexed: '未入库',
  pending: '排队中',
  indexing: '索引中',
  indexed: '已入库',
  failed: '失败',
}

const STATUS_CLASS: Record<ResourceRagStatus, string> = {
  unindexed: 'text-[var(--text-tertiary)]',
  pending: 'text-[var(--text-tertiary)]',
  indexing: 'text-[var(--accent)]',
  indexed: 'text-[var(--success)]',
  failed: 'text-[var(--warning)]',
}

const KIND_LABEL: Record<ResourceKind, string> = {
  file: '文件',
  snippet: '片段',
  document: '文档',
}

function kindIcon(kind: ResourceKind, fileType: string | null) {
  if (kind === 'snippet') return <StickyNote size={14} />
  if (kind === 'document') return <FileText size={14} />
  if (fileType === 'image') return <ImageIcon size={14} />
  return <File size={14} />
}

export default function KnowledgePanel({ projectId }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['resources', projectId],
    queryFn: () => resourcesApi.list(projectId),
    refetchInterval: (q) => {
      const data = q.state.data as ResourceBlock[] | undefined
      return data?.some(r => r.rag_status === 'indexing' || r.rag_status === 'pending') ? 2000 : false
    },
  })

  const { left, right } = useMemo(() => {
    const left: ResourceBlock[] = []
    const right: ResourceBlock[] = []
    for (const r of items) (r.is_in_kb ? right : left).push(r)
    return { left, right }
  }, [items])

  const indexMut = useMutation({
    mutationFn: (id: string) => resourcesApi.index(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const unindexMut = useMutation({
    mutationFn: (id: string) => resourcesApi.unindex(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const rebuildMut = useMutation({
    mutationFn: () => knowledgeApi.rebuild(projectId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const resetMut = useMutation({
    mutationFn: () => knowledgeApi.reset(projectId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  function openResource(r: ResourceBlock) {
    if (r.kind === 'file') return
    navigate(`/projects/${projectId}/docs/${r.id}`)
  }

  function ListColumn({
    title, rows, action, actionIcon,
  }: {
    title: string
    rows: ResourceBlock[]
    action: (id: string) => void
    actionIcon: React.ReactNode
  }) {
    return (
      <div className="flex-1 min-w-0 flex flex-col bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-base)]">
          <span className="text-sm font-semibold text-[var(--text-primary)]">{title}</span>
          <span className="text-xs text-[var(--text-tertiary)]">{rows.length}</span>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--text-tertiary)]">空</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rows.map(r => (
                <li key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--accent-light)] transition-colors group">
                  <span className="text-[var(--text-secondary)]">{kindIcon(r.kind, r.file_type)}</span>
                  <button className="flex-1 min-w-0 text-left" onClick={() => openResource(r)}>
                    <p className="text-xs font-medium truncate text-[var(--text-primary)]">
                      {r.title || r.original_filename || '未命名'}
                    </p>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-[var(--text-tertiary)]">{KIND_LABEL[r.kind]}</span>
                      <span className={STATUS_CLASS[r.rag_status]}>{STATUS_LABEL[r.rag_status]}</span>
                    </div>
                  </button>
                  <button
                    className="text-[var(--accent)] hover:text-[var(--accent-hover)] p-1 opacity-60 group-hover:opacity-100"
                    onClick={() => action(r.id)}
                    title={r.is_in_kb ? '移出知识库' : '加入知识库'}
                  >
                    {actionIcon}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Database size={14} className="text-[var(--accent)]" /> 知识库
        </div>
        <div className="flex items-center gap-1">
          <button
            className="text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
            onClick={() => rebuildMut.mutate()}
            disabled={rebuildMut.isPending}
            title="重建文件索引"
          >
            <RefreshCcw size={12} /> 重建
          </button>
          <button
            className="text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)]/10 flex items-center gap-1"
            onClick={() => {
              if (confirm('清空知识图谱？此操作不可撤销。')) resetMut.mutate()
            }}
            disabled={resetMut.isPending}
          >
            <Trash2 size={12} /> 重置
          </button>
          {(indexMut.isPending || unindexMut.isPending || rebuildMut.isPending || resetMut.isPending) && (
            <Loader2 size={12} className="animate-spin text-[var(--accent)]" />
          )}
        </div>
      </header>

      <div className="flex-1 flex gap-3 p-3 overflow-hidden">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-tertiary)]">加载中…</div>
        ) : (
          <>
            <ListColumn
              title="未入库资源"
              rows={left}
              action={(id) => indexMut.mutate(id)}
              actionIcon={<ChevronRight size={14} />}
            />
            <ListColumn
              title="已入库资源"
              rows={right}
              action={(id) => unindexMut.mutate(id)}
              actionIcon={<ChevronLeft size={14} />}
            />
          </>
        )}
      </div>
    </div>
  )
}
