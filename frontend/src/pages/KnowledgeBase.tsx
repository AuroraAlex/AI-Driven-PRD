/**
 * KnowledgeBase page — dedicated route for managing the project's knowledge
 * base. Replaces the old in-workspace KnowledgeModal.
 *
 * Tabs:
 *   1. 资源     — pick which resources are in the KB (KnowledgePanel)
 *   2. 片段     — every embedded text chunk LightRAG actually stored
 *   3. 设置     — per-project parameters (embedding, chunk size, rerank, …)
 *   4. 模式对比 — same query x 4 RAG modes side-by-side, for verification
 *   5. 图谱     — interactive 3D entity graph (react-force-graph-3d)
 *
 * A persistent KBStatusBar is rendered above the tab content so the user
 * always sees indexing progress + readiness, no matter which tab is active.
 */
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Database, Settings as SettingsIcon, GitCompare, Network, Layers } from 'lucide-react'
import { projectsApi } from '../api/client'
import KnowledgePanel from '../components/workspace/KnowledgePanel'
import SettingsForm from '../components/knowledge/SettingsForm'
import ModeCompare from '../components/knowledge/ModeCompare'
import GraphView3D from '../components/knowledge/GraphView3D'
import ChunksList from '../components/knowledge/ChunksList'
import KBStatusBar from '../components/knowledge/KBStatusBar'

type TabKey = 'resources' | 'chunks' | 'settings' | 'compare' | 'graph'

const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'resources', label: '资源', icon: <Database size={14} /> },
  { key: 'chunks', label: '片段', icon: <Layers size={14} /> },
  { key: 'settings', label: '设置', icon: <SettingsIcon size={14} /> },
  { key: 'compare', label: '模式对比', icon: <GitCompare size={14} /> },
  { key: 'graph', label: '图谱', icon: <Network size={14} /> },
]

export default function KnowledgeBase() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('resources')

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  })

  if (!projectId) return null

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-base)] overflow-hidden">
      <header className="glass h-11 flex items-center gap-3 px-4 border-b border-[var(--border)] shrink-0 z-10">
        <button
          className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          onClick={() => navigate(`/workspace/${projectId}`)}
          title="返回工作区"
        >
          <ArrowLeft size={16} />
        </button>
        <Database size={14} className="text-[var(--accent)]" />
        <span className="font-semibold text-sm text-[var(--text-primary)] truncate">
          {project?.name ?? '…'} · 知识库
        </span>
      </header>

      <nav className="flex gap-1 px-4 pt-3 border-b border-[var(--border)] bg-[var(--bg-base)] shrink-0">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-t-[var(--radius-sm)] border-b-2 transition-colors ${
              tab === t.key
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--bg-surface)]'
                : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        <KBStatusBar projectId={projectId} />
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'resources' && (
            <div className="h-full"><KnowledgePanel projectId={projectId} /></div>
          )}
          {tab === 'chunks' && <ChunksList projectId={projectId} />}
          {tab === 'settings' && <SettingsForm projectId={projectId} />}
          {tab === 'compare' && <ModeCompare projectId={projectId} />}
          {tab === 'graph' && <GraphView3D projectId={projectId} />}
        </div>
      </main>
    </div>
  )
}
