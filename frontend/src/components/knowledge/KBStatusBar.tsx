/**
 * KBStatusBar — compact progress strip shown above every KB tab.
 *
 * Polls /rag/progress every 2s while a job is running, then backs off to 10s
 * when idle. Surfaces:
 *   • doc-count chips (processed / pending / processing / failed)
 *   • indexing job + latest pipeline message
 *   • a thin progress bar (cur_batch / total_batches)
 *   • a "ready" / "not ready" pill so the user knows whether the KB can be
 *     queried by chat or AI cards.
 */
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, AlertTriangle, Loader2, Clock, FileX } from 'lucide-react'
import { knowledgeApi, type KBProgress } from '../../api/client'

interface Props {
  projectId: string
  /** Render compact one-line variant (used inside narrow panels) */
  compact?: boolean
}

export function useKBProgress(projectId: string) {
  return useQuery({
    queryKey: ['kb-progress', projectId],
    queryFn: () => knowledgeApi.getProgress(projectId),
    refetchInterval: (q) => {
      const data = q.state.data as KBProgress | undefined
      if (!data) return 2000
      return data.busy ? 1500 : 10000
    },
    staleTime: 1000,
  })
}

export default function KBStatusBar({ projectId, compact = false }: Props) {
  const { data, isLoading } = useKBProgress(projectId)

  if (isLoading || !data) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--text-tertiary)] border-b border-[var(--border)] bg-[var(--bg-base)]">
        <Loader2 size={12} className="animate-spin" /> 加载状态…
      </div>
    )
  }

  const { doc_counts: c, busy, job_name, latest_message, cur_batch, total_batches, kb_ready, failed_docs, queue_depth, ingest_active } = data
  // LightRAG's `batchs` counts chunk-batches per document. For most small
  // resources that is 1 / 1 → "100%" forever, which misleads users. Only show
  // a percentage when there are actually multiple batches; otherwise render an
  // indeterminate bar while busy.
  const showPercent = total_batches > 1
  const pct = showPercent ? Math.min(100, Math.round((cur_batch / total_batches) * 100)) : 0
  // Total docs still in the pipeline = LightRAG-side (pending+processing) +
  // worker-side waiting. These are disjoint sets because the worker only
  // hands a doc to LightRAG one at a time.
  const inFlightTotal = c.pending + c.processing + queue_depth

  return (
    <div className="border-b border-[var(--border)] bg-[var(--bg-base)]">
      <div className={`flex items-center gap-3 px-3 ${compact ? 'py-1.5' : 'py-2'} flex-wrap`}>
        {kb_ready ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--success)]/15 text-[var(--success)]">
            <CheckCircle2 size={12} /> 就绪
          </span>
        ) : busy ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
            <Loader2 size={12} className="animate-spin" /> 索引中
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--warning)]/15 text-[var(--warning)]">
            <AlertTriangle size={12} /> 未就绪
          </span>
        )}

        <Chip color="success" icon={<CheckCircle2 size={11} />} label={`已索引 ${c.processed}`} />
        {c.processing > 0 && <Chip color="accent" icon={<Loader2 size={11} className="animate-spin" />} label={`处理中 ${c.processing}`} />}
        {c.pending > 0 && <Chip color="muted" icon={<Clock size={11} />} label={`LightRAG 待处理 ${c.pending}`} />}
        {queue_depth > 0 && <Chip color="muted" icon={<Clock size={11} />} label={`等待入队 ${queue_depth}`} />}
        {c.failed > 0 && <Chip color="warning" icon={<FileX size={11} />} label={`失败 ${c.failed}`} />}

        {(job_name || latest_message) && (
          <span className="text-[11px] text-[var(--text-tertiary)] truncate max-w-[40%]">
            {job_name && <span className="font-medium text-[var(--text-secondary)]">{job_name}</span>}
            {job_name && latest_message && ' · '}
            {latest_message}
          </span>
        )}
      </div>

      {busy && (
        <div className="px-3 pb-2">
          <div className="h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            {showPercent ? (
              <div
                className="h-full bg-[var(--accent)] transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            ) : (
              // Indeterminate stripe — single doc / unknown total.
              <div className="h-full w-1/3 bg-[var(--accent)] animate-[kbslide_1.4s_ease-in-out_infinite]" />
            )}
          </div>
          <div className="text-[10px] text-[var(--text-tertiary)] mt-1 flex items-center gap-2">
            {showPercent ? (
              <>批次 {cur_batch}/{total_batches}（{pct}%）</>
            ) : (
              <>{ingest_active ? '正在索引文档' : '准备中'}{inFlightTotal > 0 && `，剩余 ${inFlightTotal} 个文档`}</>
            )}
          </div>
        </div>
      )}

      {failed_docs.length > 0 && !compact && (
        <details className="px-3 pb-2">
          <summary className="text-[11px] text-[var(--warning)] cursor-pointer">
            查看 {failed_docs.length} 个失败文档
          </summary>
          <ul className="mt-1 space-y-1 max-h-32 overflow-y-auto">
            {failed_docs.map((d) => (
              <li key={d.doc_id} className="text-[10px] text-[var(--text-tertiary)] truncate">
                <span className="text-[var(--warning)]">{d.doc_id}</span>
                {d.error && <> — {d.error}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Chip({ color, icon, label }: { color: 'success' | 'accent' | 'warning' | 'muted'; icon: React.ReactNode; label: string }) {
  const cls =
    color === 'success' ? 'text-[var(--success)] bg-[var(--success)]/10'
    : color === 'accent' ? 'text-[var(--accent)] bg-[var(--accent)]/10'
    : color === 'warning' ? 'text-[var(--warning)] bg-[var(--warning)]/10'
    : 'text-[var(--text-tertiary)] bg-[var(--bg-surface)]'
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full ${cls}`}>
      {icon}{label}
    </span>
  )
}
