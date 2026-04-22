/**
 * GraphView3D — interactive 3D force graph of the project's LightRAG entity
 * network. Powered by react-force-graph-3d (which wraps three.js).
 */
import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Download, RefreshCcw } from 'lucide-react'
import ForceGraph3D from 'react-force-graph-3d'
import { knowledgeApi, type KBGraphNode } from '../../api/client'

interface Props {
  projectId: string
}

// Colour palette per entity type — keeps the same colour stable across renders.
const COLORS = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#a78bfa', '#f87171', '#22d3ee', '#fb923c']
function colorFor(type: string): string {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return COLORS[h % COLORS.length]
}

export default function GraphView3D({ projectId }: Props) {
  const [limit, setLimit] = useState(500)
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<unknown>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [selected, setSelected] = useState<KBGraphNode | null>(null)

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['kb-graph', projectId, limit],
    queryFn: () => knowledgeApi.getGraph(projectId, limit),
    staleTime: 30_000,
  })

  // Resize observer for the canvas
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const graphData = useMemo(() => {
    if (!data) return { nodes: [], links: [] }
    return {
      nodes: data.nodes.map(n => ({ ...n, color: colorFor(n.type) })),
      links: data.links,
    }
  }, [data])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-6 py-3 border-b border-[var(--border)] flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">知识图谱</h2>
          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
            {data
              ? `共 ${data.total_nodes} 个实体 / ${data.total_links} 条关系${data.truncated ? `（按度数截取前 ${graphData.nodes.length} 个）` : ''}`
              : '加载中…'}
          </p>
        </div>
        <label className="text-xs text-[var(--text-secondary)] flex items-center gap-1">
          展示节点数
          <select
            className="px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-xs"
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          >
            {[100, 300, 500, 1000, 2000, 5000].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <button
          className="text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--accent)] flex items-center gap-1"
          onClick={() => refetch()}
          disabled={isFetching}
        >
          {isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          刷新
        </button>
        <a
          className="text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] hover:border-[var(--accent)] flex items-center gap-1 text-[var(--text-secondary)]"
          href={knowledgeApi.graphmlUrl(projectId)}
          download
        >
          <Download size={12} />
          GraphML
        </a>
      </header>

      <div ref={containerRef} className="flex-1 relative bg-[var(--bg-base)]">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-tertiary)]">
            <Loader2 size={16} className="animate-spin mr-2" /> 加载图谱…
          </div>
        ) : graphData.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-[var(--text-tertiary)] text-center px-6">
            尚未生成图谱。
            <br />
            请先在「资源」页签把至少一个文件 / 文档加入知识库，或点击"重建"。
          </div>
        ) : (
          <ForceGraph3D
            ref={fgRef as never}
            width={size.w}
            height={size.h}
            graphData={graphData}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={(n) => {
              const node = n as unknown as KBGraphNode
              return `<div style="font-family: ui-sans-serif; padding:4px 6px;"><b>${escapeHtml(node.label)}</b><br/><span style='opacity:.7'>${escapeHtml(node.type)} · degree ${node.degree}</span></div>`
            }}
            nodeAutoColorBy="type"
            nodeVal={(n) => Math.max(1, Math.log2(((n as unknown as KBGraphNode).degree || 1) + 1))}
            linkOpacity={0.35}
            linkWidth={(l) => Math.min(2, ((l as unknown as { weight: number }).weight || 1) * 0.5)}
            linkDirectionalParticles={0}
            onNodeClick={(n) => setSelected(n as unknown as KBGraphNode)}
            enableNodeDrag
          />
        )}

        {selected && (
          <aside className="absolute top-3 right-3 w-72 max-h-[60%] overflow-y-auto bg-[var(--bg-surface)]/95 backdrop-blur border border-[var(--border)] rounded-[var(--radius-md)] p-3 shadow-lg">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)] break-words">{selected.label}</p>
                <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5">{selected.type} · degree {selected.degree}</p>
              </div>
              <button
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] text-xs"
                onClick={() => setSelected(null)}
              >×</button>
            </div>
            {selected.description && (
              <p className="text-xs text-[var(--text-secondary)] mt-2 leading-relaxed break-words whitespace-pre-wrap">
                {selected.description}
              </p>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}
