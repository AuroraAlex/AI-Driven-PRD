/**
 * KnowledgePanel.tsx — Workspace tab listing every RAG-indexed source
 * (file / canvas / chat / prd) with status, sync triggers and reset.
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCcw, Trash2, Database, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import {
  canvasSessionsApi,
  chatSessionsApi,
  knowledgeApi,
  type RAGSource,
} from '../../api/client'
import { Button } from '../ui'

interface Props {
  projectId: string
}

const STATUS_COLOR: Record<string, string> = {
  indexed: 'text-[var(--success)]',
  indexing: 'text-[var(--accent)]',
  pending: 'text-[var(--text-tertiary)]',
  failed: 'text-[var(--warning)]',
  unindexed: 'text-[var(--text-tertiary)]',
}

const SOURCE_LABEL: Record<string, string> = {
  file: '文件',
  canvas: '画布',
  chat: '对话',
  prd: 'PRD',
}

export default function KnowledgePanel({ projectId }: Props) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'file' | 'canvas' | 'chat' | 'prd'>('all')

  const { data: sources = [], isLoading } = useQuery({
    queryKey: ['knowledge-sources', projectId],
    queryFn: () => knowledgeApi.sources(projectId),
    refetchInterval: 5000,
  })

  const { data: canvasSessions = [] } = useQuery({
    queryKey: ['canvas-sessions', projectId],
    queryFn: () => canvasSessionsApi.list(projectId),
  })

  const { data: chatSessions = [] } = useQuery({
    queryKey: ['chat-sessions', projectId],
    queryFn: () => chatSessionsApi.list(projectId),
  })

  const syncMut = useMutation({
    mutationFn: (data: { source_type: 'canvas' | 'chat' | 'prd'; session_ids?: string[] }) =>
      knowledgeApi.sync(projectId, data),
    onSettled: () => qc.invalidateQueries({ queryKey: ['knowledge-sources', projectId] }),
  })

  const rebuildMut = useMutation({
    mutationFn: () => knowledgeApi.rebuild(projectId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['knowledge-sources', projectId] }),
  })

  const resetMut = useMutation({
    mutationFn: () => knowledgeApi.reset(projectId),
    onSettled: () => qc.invalidateQueries({ queryKey: ['knowledge-sources', projectId] }),
  })

  const filtered: RAGSource[] = sources.filter(s => filter === 'all' || s.source_type === filter)

  const labelOf = (s: RAGSource): string => {
    if (s.source_type === 'canvas') {
      return canvasSessions.find(c => c.id === s.source_session_id)?.title ?? s.doc_id
    }
    if (s.source_type === 'chat') {
      return chatSessions.find(c => c.id === s.source_session_id)?.title ?? s.doc_id
    }
    return s.source_ref ?? s.doc_id
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Database size={14} className="text-[var(--accent)]" /> 知识库
        </div>
        <div className="flex items-center gap-1">
          <Button
            className="!text-xs !px-2 !py-1"
            onClick={() => syncMut.mutate({ source_type: 'canvas' })}
            disabled={syncMut.isPending}
          >同步画布</Button>
          <Button
            className="!text-xs !px-2 !py-1"
            onClick={() => syncMut.mutate({ source_type: 'chat' })}
            disabled={syncMut.isPending}
          >同步对话</Button>
          <Button
            className="!text-xs !px-2 !py-1"
            onClick={() => syncMut.mutate({ source_type: 'prd' })}
            disabled={syncMut.isPending}
          >同步 PRD</Button>
          <button
            className="ml-1 text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center gap-1"
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
        </div>
      </header>

      <div className="flex items-center gap-1 px-4 py-2 border-b border-[var(--border)]">
        {(['all', 'file', 'canvas', 'chat', 'prd'] as const).map(k => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={clsx(
              'text-xs px-2 py-0.5 rounded',
              filter === k ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)] hover:bg-[var(--accent-light)]',
            )}
          >
            {k === 'all' ? '全部' : SOURCE_LABEL[k]}
          </button>
        ))}
        {(syncMut.isPending || rebuildMut.isPending || resetMut.isPending) && (
          <Loader2 size={12} className="ml-auto animate-spin text-[var(--accent)]" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {isLoading && <div className="text-xs text-[var(--text-tertiary)]">加载中…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="text-xs text-[var(--text-tertiary)] py-4 text-center">尚无任何索引来源</div>
        )}
        <ul className="flex flex-col divide-y divide-[var(--border)]">
          {filtered.map(s => (
            <li key={s.id} className="py-2 flex items-center gap-2 text-xs">
              <span className="px-1 rounded bg-[var(--accent-light)] text-[var(--accent)] text-[10px]">
                {SOURCE_LABEL[s.source_type] ?? s.source_type}
              </span>
              <span className="flex-1 truncate text-[var(--text-primary)]">{labelOf(s)}</span>
              <span className={clsx('text-[10px]', STATUS_COLOR[s.status] ?? '')}>{s.status}</span>
              {s.indexed_at && (
                <span className="text-[10px] text-[var(--text-tertiary)]">
                  {new Date(s.indexed_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </li>
          ))}
        </ul>
        {syncMut.data?.failed?.length ? (
          <div className="mt-3 text-[11px] text-[var(--warning)]">
            最近一次同步失败 {syncMut.data.failed.length} 项：
            <ul className="list-disc pl-4">
              {syncMut.data.failed.map(f => (
                <li key={f.doc_id}>{f.doc_id}: {f.error}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
