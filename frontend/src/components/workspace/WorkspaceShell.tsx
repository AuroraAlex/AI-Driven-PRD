/**
 * WorkspaceShell — outer 3-column resizable layout for the workspace page.
 *   ┌─────────┬───────────────────┬─────────┐
 *   │  left   │   center flip     │  chat   │
 *   │ (res +  │  (canvas|markdown)│         │
 *   │  tools) │                   │         │
 *   └─────────┴───────────────────┴─────────┘
 *
 * Column sizes are persisted via PanelGroup's autoSaveId.
 */
import { Group, Panel, Separator } from 'react-resizable-panels'
import { MessageSquare } from 'lucide-react'
import LeftColumn from './LeftColumn'
import CenterFlipCard from './CenterFlipCard'
import SessionSwitcher from './SessionSwitcher'
import ChatPanel from '../chat/ChatPanel'
import { WorkspaceProvider } from './WorkspaceContext'
import { usePersistedLayout } from './usePersistedLayout'

interface Props {
  projectId: string
  canvasSessionId: string | null
  chatSessionId: string | null
}

const UPLOAD_INPUT_ID = 'workspace-resource-upload-input'

export default function WorkspaceShell({ projectId, canvasSessionId, chatSessionId }: Props) {
  const { defaultLayout, onLayoutChanged } = usePersistedLayout('workspace.cols.v1')
  return (
    <WorkspaceProvider>
      <div className="h-full w-full p-2 bg-[var(--bg-base)]">
        <Group
          orientation="horizontal"
          className="h-full flex gap-2"
          defaultLayout={defaultLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <Panel id="col-left" defaultSize={22} minSize={16} maxSize={32} className="h-full">
            <LeftColumn
              projectId={projectId}
              canvasSessionId={canvasSessionId}
              uploadInputId={UPLOAD_INPUT_ID}
            />
          </Panel>
          <Separator className="w-1 mx-0.5 rounded bg-transparent hover:bg-[var(--accent-light)] transition-colors cursor-col-resize" />

          <Panel id="col-center" defaultSize={50} minSize={30} maxSize={64} className="h-full">
            <CenterFlipCard projectId={projectId} canvasSessionId={canvasSessionId} />
          </Panel>
          <Separator className="w-1 mx-0.5 rounded bg-transparent hover:bg-[var(--accent-light)] transition-colors cursor-col-resize" />

          <Panel id="col-right" defaultSize={28} minSize={18} maxSize={40} className="h-full">
            <div className="h-full flex flex-col bg-[var(--bg-surface)] rounded-[var(--radius-lg)] border border-[var(--border)] overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
                <MessageSquare size={14} className="text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">AI Chat</span>
                <div className="ml-auto">
                  <SessionSwitcher projectId={projectId} kind="chat" />
                </div>
              </div>
              {chatSessionId ? (
                <ChatPanel
                  projectId={projectId}
                  chatSessionId={chatSessionId}
                  currentCanvasSessionId={canvasSessionId}
                />
              ) : (
                <div className="flex-1 flex items-center justify-center text-xs text-[var(--text-tertiary)]">
                  正在准备对话会话…
                </div>
              )}
            </div>
          </Panel>
        </Group>
      </div>
    </WorkspaceProvider>
  )
}
