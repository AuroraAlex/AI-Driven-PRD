/**
 * ReferencesDrawer.tsx — Slide-out panel listing all references in/out of
 * a given node (e.g. an AI card or PRD section). Provides a "🔗 N" badge
 * for inline use.
 */
import { useQuery } from '@tanstack/react-query'
import { Link2, X } from 'lucide-react'
import clsx from 'clsx'
import { referencesApi, type ReferenceEdge, type ReferenceNodeType } from '../../api/client'

interface Props {
  projectId: string
  nodeType: ReferenceNodeType
  nodeId: string
  onClose: () => void
}

const TYPE_LABEL: Record<ReferenceNodeType, string> = {
  canvas_card: '画布卡片',
  chat_message: '对话消息',
  prd_section: 'PRD 章节',
  rag_chunk: 'RAG 片段',
  file: '文件',
}

const RELATION_LABEL: Record<string, string> = {
  cites: '引用',
  derived_from: '派生自',
  mentions: '提及',
  embedded_in: '嵌入于',
}

export default function ReferencesDrawer({ projectId, nodeType, nodeId, onClose }: Props) {
  const { data: outgoing = [] } = useQuery({
    queryKey: ['refs-out', projectId, nodeType, nodeId],
    queryFn: () => referencesApi.list(projectId, { node_type: nodeType, node_id: nodeId, direction: 'outgoing' }),
  })
  const { data: incoming = [] } = useQuery({
    queryKey: ['refs-in', projectId, nodeType, nodeId],
    queryFn: () => referencesApi.list(projectId, { node_type: nodeType, node_id: nodeId, direction: 'incoming' }),
  })

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-80 bg-[var(--bg-surface)] border-l border-[var(--border)] shadow-xl flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          <Link2 size={14} className="text-[var(--accent)]" /> 引用关系
        </div>
        <button className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-4 text-xs">
        <Section title="本节点引用的对象" edges={outgoing} side="target" />
        <Section title="引用本节点的对象" edges={incoming} side="source" />
      </div>
    </div>
  )
}

function Section({ title, edges, side }: { title: string; edges: ReferenceEdge[]; side: 'source' | 'target' }) {
  return (
    <section>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1">{title}</div>
      {edges.length === 0 ? (
        <div className="text-[var(--text-tertiary)]">无</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {edges.map(e => {
            const t = side === 'target' ? e.target_type : e.source_type
            const id = side === 'target' ? e.target_id : e.source_id
            return (
              <li key={e.id} className={clsx('flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-base)] border border-[var(--border)]')}>
                <span className="px-1 rounded bg-[var(--accent-light)] text-[var(--accent)] text-[10px]">
                  {TYPE_LABEL[t]}
                </span>
                <span className="flex-1 truncate text-[var(--text-primary)]">{id}</span>
                <span className="text-[10px] text-[var(--text-tertiary)]">{RELATION_LABEL[e.relation] ?? e.relation}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export function ReferencesBadge({
  projectId, nodeType, nodeId, onClick,
}: {
  projectId: string
  nodeType: ReferenceNodeType
  nodeId: string
  onClick: () => void
}) {
  const { data: edges = [] } = useQuery({
    queryKey: ['refs-out', projectId, nodeType, nodeId],
    queryFn: () => referencesApi.list(projectId, { node_type: nodeType, node_id: nodeId, direction: 'both' }),
    staleTime: 30_000,
  })
  if (edges.length === 0) return null
  return (
    <button
      onClick={onClick}
      className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent-light)] text-[var(--accent)] hover:underline"
      title="查看引用关系"
    >
      🔗 {edges.length}
    </button>
  )
}
