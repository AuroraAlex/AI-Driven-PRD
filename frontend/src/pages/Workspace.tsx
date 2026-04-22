import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, LayoutPanelLeft, MessageSquare, FileText, Files, Database } from 'lucide-react'
import { projectsApi, type PRDDocument } from '../api/client'
import ExcalidrawCanvas from '../components/canvas/ExcalidrawCanvas'
import CanvasToolbar from '../components/canvas/CanvasToolbar'
import CanvasInspector from '../components/canvas/CanvasInspector'
import CanvasMinimap from '../components/canvas/CanvasMinimap'
import CanvasTemplateModal from '../components/canvas/CanvasTemplateModal'
import AICardEditor from '../components/canvas/AICardEditor'
import ChatPanel from '../components/chat/ChatPanel'
import FilePanel from '../components/files/FilePanel'
import TemplateModal from '../components/prd/TemplateModal'
import PRDEditor from './PRDEditor'
import SessionSwitcher from '../components/workspace/SessionSwitcher'
import KnowledgePanel from '../components/workspace/KnowledgePanel'
import { useSessionStore } from '../store/sessionStore'
import { useCanvasStore } from '../store/canvasStore'

type PanelId = 'canvas' | 'files' | 'prd' | 'knowledge'

export default function Workspace() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const [leftPanel, setLeftPanel] = useState<PanelId>('canvas')
  const [openPRD, setOpenPRD] = useState<PRDDocument | null>(null)

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
      {/* Top bar */}
      <header className="glass h-11 flex items-center gap-3 px-4 border-b border-[var(--border)] shrink-0 z-10">
        <button
          className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="font-semibold text-sm text-[var(--text-primary)] truncate">
          {project?.name ?? '…'}
        </span>
        <div className="flex items-center gap-1 ml-2">
          {[
            { id: 'canvas' as PanelId, icon: <LayoutPanelLeft size={14} />, label: 'Canvas' },
            { id: 'files' as PanelId, icon: <Files size={14} />, label: 'Files' },
            { id: 'prd' as PanelId, icon: <FileText size={14} />, label: 'PRD' },
            { id: 'knowledge' as PanelId, icon: <Database size={14} />, label: 'Knowledge' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setLeftPanel(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-[var(--radius-sm)] text-xs font-medium transition-colors ${
                leftPanel === tab.id
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--accent-light)]'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Main layout */}
      {leftPanel === 'knowledge' ? (
        <div className="flex-1 overflow-hidden">
          <KnowledgePanel projectId={projectId} />
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Left panel */}
          <div className="w-64 flex flex-col border-r border-[var(--border)] bg-[var(--bg-surface)] shrink-0 overflow-hidden">
            {leftPanel === 'canvas' && (
              <>
                <div className="px-3 py-2 border-b border-[var(--border)]">
                  <SessionSwitcher projectId={projectId} kind="canvas" />
                </div>
                {canvasSessionId && <CanvasToolbar projectId={projectId} canvasSessionId={canvasSessionId} />}
              </>
            )}
            {leftPanel === 'files' && <FilePanel projectId={projectId} />}
            {leftPanel === 'prd' && (
              <TemplateModal
                projectId={projectId}
                onOpen={prd => { setOpenPRD(prd); setLeftPanel('prd') }}
              />
            )}
          </div>

          {/* Center: Canvas / PRD editor */}
          <div className="flex-1 overflow-hidden relative">
            {openPRD ? (
              <div className="flex flex-col h-full">
                <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
                  <button
                    className="text-xs text-[var(--accent)] hover:underline"
                    onClick={() => setOpenPRD(null)}
                  >
                    ← Back to Canvas
                  </button>
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate">{openPRD.title}</span>
                </div>
                <PRDEditor prd={openPRD} onSave={setOpenPRD} />
              </div>
            ) : canvasSessionId ? (
              <>
                <ExcalidrawCanvas projectId={projectId} canvasSessionId={canvasSessionId} />
                <CanvasInspector />
                <CanvasMinimap />
                <CanvasTemplateModal />
                <AICardEditor projectId={projectId} canvasSessionId={canvasSessionId} />
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] text-sm">
                正在准备画布会话…
              </div>
            )}
          </div>

          {/* Right panel: Chat */}
          <div className="w-80 flex flex-col border-l border-[var(--border)] bg-[var(--bg-surface)] shrink-0">
            <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
              <MessageSquare size={14} className="text-[var(--accent)]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">AI Chat</span>
              <div className="ml-auto">
                <SessionSwitcher projectId={projectId} kind="chat" />
              </div>
            </div>
            {chatSessionId ? (
              <ChatPanel projectId={projectId} chatSessionId={chatSessionId} currentCanvasSessionId={canvasSessionId} />
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-tertiary)]">
                正在准备对话会话…
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

