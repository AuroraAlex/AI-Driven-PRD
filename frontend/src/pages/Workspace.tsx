import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Database, FileText } from 'lucide-react'
import { projectsApi } from '../api/client'
import WorkspaceShell from '../components/workspace/WorkspaceShell'
import { useSessionStore } from '../store/sessionStore'
import { useCanvasStore } from '../store/canvasStore'

export default function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const sessionStore = useSessionStore()
  const setCurrentCanvasSessionId = useCanvasStore(s => s.setCurrentCanvasSessionId)
  const canvasSessionId = projectId ? sessionStore.getCanvasSessionId(projectId) : null
  const chatSessionId = projectId ? sessionStore.getChatSessionId(projectId) : null

  useEffect(() => {
    setCurrentCanvasSessionId(canvasSessionId)
  }, [canvasSessionId, setCurrentCanvasSessionId])

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  })

  if (!projectId) return null

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-base)] overflow-hidden">
      {/* Top bar — only 知识库 + PRD remain */}
      <header className="glass h-11 flex items-center gap-3 px-4 border-b border-[var(--border)] shrink-0 z-10">
        <button
          className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          onClick={() => navigate('/')}
          title="返回首页"
        >
          <ArrowLeft size={16} />
        </button>
        <span className="font-semibold text-sm text-[var(--text-primary)] truncate">
          {project?.name ?? '…'}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => navigate(`/projects/${projectId}/knowledge`)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] transition-colors"
          >
            <Database size={14} />
            知识库
          </button>
          <button
            onClick={() => navigate(`/projects/${projectId}/overview`)}
            className="flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)] transition-colors"
          >
            <FileText size={14} />
            PRD
          </button>
        </div>
      </header>

      {/* Main 3-column resizable shell */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <WorkspaceShell
          projectId={projectId}
          canvasSessionId={canvasSessionId}
          chatSessionId={chatSessionId}
        />
      </div>
    </div>
  )
}
