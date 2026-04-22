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
import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database, Trash2, RefreshCcw, Loader2, FileText, Image as ImageIcon, File,
  StickyNote, ChevronRight, ChevronLeft, Square, CheckSquare, XCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import {
  resourcesApi, knowledgeApi,
  type ResourceBlock, type ResourceKind, type ResourceRagStatus,
} from '../../api/client'
import { useKBProgress } from '../knowledge/KBStatusBar'

interface Props {
  projectId: string
}

const STATUS_LABEL: Record<ResourceRagStatus, string> = {
  unindexed: '未入库',
  pending: '排队中',
  queued: '排队中',
  indexing: '索引中',
  indexed: '已入库',
  failed: '失败',
}

const STATUS_CLASS: Record<ResourceRagStatus, string> = {
  unindexed: 'text-[var(--text-tertiary)]',
  pending: 'text-[var(--text-tertiary)]',
  queued: 'text-[var(--text-tertiary)]',
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
  const { data: kbProgress } = useKBProgress(projectId)
  const kbBusy = !!kbProgress?.busy

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

  // ── Selection state per side ──────────────────────────────────────────────
  const [selLeft, setSelLeft] = useState<Set<string>>(new Set())
  const [selRight, setSelRight] = useState<Set<string>>(new Set())

  // Drop selections that no longer exist (resource deleted / moved).
  useEffect(() => {
    const leftIds = new Set(left.map(r => r.id))
    const rightIds = new Set(right.map(r => r.id))
    setSelLeft(prev => new Set([...prev].filter(id => leftIds.has(id))))
    setSelRight(prev => new Set([...prev].filter(id => rightIds.has(id))))
  }, [left, right])

  const indexBatchMut = useMutation({
    mutationFn: (ids: string[]) => resourcesApi.indexBatch(projectId, ids),
    onSuccess: (data) => {
      setSelLeft(new Set())
      const parts: string[] = []
      if (data.queued) parts.push(`已入队 ${data.queued} 个`)
      if (data.skipped) parts.push(`跳过 ${data.skipped} 个空内容`)
      toast.success(parts.join('，') || '操作完成')
    },
    onError: (e: unknown) => toast.error(`入库失败：${e instanceof Error ? e.message : String(e)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const unindexBatchMut = useMutation({
    mutationFn: (ids: string[]) => resourcesApi.unindexBatch(projectId, ids),
    onSuccess: (data) => {
      setSelRight(new Set())
      toast.success(`已从知识库移出 ${data.unindexed} 个`)
    },
    onError: (e: unknown) => toast.error(`出库失败：${e instanceof Error ? e.message : String(e)}`),
    onSettled: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const cancelMut = useMutation({
    mutationFn: () => resourcesApi.cancelIngest(projectId),
    onSuccess: (data) => {
      const parts: string[] = []
      if (data.cancelled_active) parts.push('已中断进行中的索引')
      if (data.drained > 0) parts.push(`已清空队列 ${data.drained} 项`)
      if (data.reset_rows > 0) parts.push(`重置 ${data.reset_rows} 条记录`)
      toast.success(parts.join('，') || '没有正在进行的任务')
    },
    onError: (e: unknown) => toast.error(`中断失败：${e instanceof Error ? e.message : String(e)}`),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['resources', projectId] })
      qc.invalidateQueries({ queryKey: ['kb-progress', projectId] })
    },
  })

  const rebuildMut = useMutation({
    mutationFn: () => knowledgeApi.rebuild(projectId),
    onSuccess: (data) => {
      const failedCount = data.failed?.length ?? 0
      if (failedCount === 0 && data.rebuilt > 0) {
        toast.success(`重建成功：${data.rebuilt} 个文档已入库`)
      } else if (failedCount === 0 && data.rebuilt === 0) {
        toast('知识库为空，没有可入库的资源', { icon: 'ℹ️' })
      } else if (data.rebuilt > 0) {
        toast.error(`部分失败：成功 ${data.rebuilt} 个，失败 ${failedCount} 个。请查看后端日志`)
      } else {
        toast.error(`重建失败：${failedCount} 个文档全部失败。请查看后端日志`)
      }
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`重建失败：${msg}`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const resetMut = useMutation({
    mutationFn: () => knowledgeApi.reset(projectId),
    onSuccess: () => toast.success('知识图谱已重置'),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`重置失败：${msg}`)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  // Aggregate "is something in flight?" – disables every interactive
  // control while batch / rebuild / reset are running OR while the backend
  // queue still has pending jobs. This prevents user from racing operations.
  const batchBusy = indexBatchMut.isPending || unindexBatchMut.isPending
  const anyBusy = batchBusy || rebuildMut.isPending || resetMut.isPending || kbBusy

  function openResource(r: ResourceBlock) {
    if (r.kind === 'file') return
    if (anyBusy) return
    navigate(`/projects/${projectId}/docs/${r.id}`)
  }

  function ListColumn({
    title, rows, selected, setSelected,
  }: {
    title: string
    rows: ResourceBlock[]
    selected: Set<string>
    setSelected: (s: Set<string>) => void
  }) {
    const allChecked = rows.length > 0 && rows.every(r => selected.has(r.id))
    const noneChecked = rows.every(r => !selected.has(r.id))
    function toggle(id: string) {
      if (anyBusy) return
      const next = new Set(selected)
      if (next.has(id)) next.delete(id); else next.add(id)
      setSelected(next)
    }
    return (
      <div className="relative flex-1 min-w-0 flex flex-col bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-base)]">
          <span className="text-sm font-semibold text-[var(--text-primary)]">
            {title} <span className="text-[var(--text-tertiary)] font-normal">({rows.length})</span>
          </span>
          <div className="flex items-center gap-1">
            <button
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={anyBusy || rows.length === 0 || allChecked}
              onClick={() => setSelected(new Set(rows.map(r => r.id)))}
            >全选</button>
            <button
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)] disabled:opacity-40 disabled:cursor-not-allowed"
              disabled={anyBusy || noneChecked}
              onClick={() => setSelected(new Set())}
            >全不选</button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rows.length === 0 ? (
            <div className="p-6 text-center text-xs text-[var(--text-tertiary)]">空</div>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {rows.map(r => {
                const checked = selected.has(r.id)
                return (
                  <li
                    key={r.id}
                    className={`flex items-center gap-2 px-3 py-2 transition-colors cursor-pointer select-none ${
                      checked ? 'bg-[var(--accent-light)]' : 'hover:bg-[var(--bg-base)]'
                    }`}
                    onClick={() => toggle(r.id)}
                  >
                    <span
                      className={`flex items-center justify-center transition-colors ${
                        checked ? 'text-[var(--accent)]' : 'text-[var(--text-tertiary)]'
                      }`}
                      aria-checked={checked}
                      role="checkbox"
                    >
                      {checked ? <CheckSquare size={14} /> : <Square size={14} />}
                    </span>
                    <span className="text-[var(--text-secondary)]">{kindIcon(r.kind, r.file_type)}</span>
                    <button
                      className="flex-1 min-w-0 text-left disabled:cursor-not-allowed"
                      disabled={anyBusy}
                      onClick={(e) => { e.stopPropagation(); openResource(r) }}
                    >
                      <p className="text-xs font-medium truncate text-[var(--text-primary)]">
                        {r.title || r.original_filename || '未命名'}
                      </p>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-[var(--text-tertiary)]">{KIND_LABEL[r.kind]}</span>
                        <span className={STATUS_CLASS[r.rag_status]}>{STATUS_LABEL[r.rag_status]}</span>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
        {/* Lock overlay during ingestion: dim + block pointer events */}
        {anyBusy && (
          <div
            className="absolute inset-0 bg-[var(--bg-base)]/60 backdrop-blur-[1px] cursor-not-allowed flex items-center justify-center"
            aria-hidden
          >
            <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)] bg-[var(--bg-surface)] border border-[var(--border)] rounded-full px-2.5 py-1 shadow-sm">
              <Loader2 size={11} className="animate-spin text-[var(--accent)]" />
              知识库处理中…
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Database size={14} className="text-[var(--accent)]" /> 知识库
          {kbBusy && (
            <span className="text-[10px] font-normal text-[var(--accent)] flex items-center gap-1 ml-2">
              <Loader2 size={10} className="animate-spin" />
              处理中{kbProgress?.queue_depth ? `（队列 ${kbProgress.queue_depth}）` : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(kbBusy || batchBusy) && (
            <button
              className="text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)]/10 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => {
                if (confirm('中断当前索引任务？已经入队但未处理的资源会被回滚为「未入库」。')) {
                  cancelMut.mutate()
                }
              }}
              disabled={cancelMut.isPending}
              title="中断当前索引任务"
            >
              <XCircle size={12} /> 中断
            </button>
          )}
          <button
            className="text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => rebuildMut.mutate()}
            disabled={anyBusy}
            title={anyBusy ? '正在处理，请稍后再试' : '重建文件索引'}
          >
            <RefreshCcw size={12} /> 重建
          </button>
          <button
            className="text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)]/10 flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={() => {
              if (confirm('清空知识图谱？此操作不可撤销。')) resetMut.mutate()
            }}
            disabled={anyBusy}
            title={anyBusy ? '正在处理，请稍后再试' : '重置整个图谱'}
          >
            <Trash2 size={12} /> 重置
          </button>
          {anyBusy && (
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
              selected={selLeft}
              setSelected={setSelLeft}
            />
            {/* Center batch action column */}
            <div className="flex flex-col items-center justify-center gap-3 px-1">
              <button
                className="w-9 h-9 rounded-full border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--accent)]"
                disabled={anyBusy || selLeft.size === 0}
                onClick={() => indexBatchMut.mutate([...selLeft])}
                title={selLeft.size > 0 ? `入库 ${selLeft.size} 个` : '请先勾选左侧资源'}
              >
                <ChevronRight size={18} />
              </button>
              <span className="text-[10px] text-[var(--text-tertiary)]">
                {selLeft.size > 0 && `→ ${selLeft.size}`}
                {selLeft.size > 0 && selRight.size > 0 && ' / '}
                {selRight.size > 0 && `${selRight.size} ←`}
              </span>
              <button
                className="w-9 h-9 rounded-full border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)] hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-[var(--warning)]"
                disabled={anyBusy || selRight.size === 0}
                onClick={() => unindexBatchMut.mutate([...selRight])}
                title={selRight.size > 0 ? `出库 ${selRight.size} 个` : '请先勾选右侧资源'}
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            <ListColumn
              title="已入库资源"
              rows={right}
              selected={selRight}
              setSelected={setSelRight}
            />
          </>
        )}
      </div>
    </div>
  )
}
