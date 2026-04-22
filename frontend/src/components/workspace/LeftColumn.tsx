/**
 * LeftColumn — vertical split: top = ResourcePanel, bottom = contextual tools.
 *
 * The bottom region swaps content based on the workspace's current face:
 *   - canvas:   CanvasToolbar + canvas SessionSwitcher
 *   - markdown: MarkdownTools (outline + snippets + counts)
 *
 * Both halves are independently resizable via a nested PanelGroup; sizes
 * persist via the panel group's autoSaveId.
 */
import { Group, Panel, Separator } from 'react-resizable-panels'
import ResourcePanel from '../resources/ResourcePanel'
import CanvasToolbar from '../canvas/CanvasToolbar'
import SessionSwitcher from './SessionSwitcher'
import MarkdownTools from './MarkdownTools'
import { useWorkspace } from './WorkspaceContext'
import { usePersistedLayout } from './usePersistedLayout'

interface Props {
  projectId: string
  canvasSessionId: string | null
  uploadInputId: string
}

export default function LeftColumn({ projectId, canvasSessionId, uploadInputId }: Props) {
  const { face, editingResourceId, setEditingResourceId, setFace } = useWorkspace()
  const { defaultLayout, onLayoutChanged } = usePersistedLayout('workspace.left.v1')

  return (
    <Group
      orientation="vertical"
      className="h-full flex flex-col"
      defaultLayout={defaultLayout}
      onLayoutChanged={onLayoutChanged}
    >
      <Panel id="left-top" defaultSize={55} minSize={25} maxSize={80}>
        <div className="h-full flex flex-col bg-[var(--bg-surface)] rounded-t-[var(--radius-lg)] border border-[var(--border)] border-b-0 overflow-hidden">
          <ResourcePanel
            projectId={projectId}
            uploadInputId={uploadInputId}
            activeResourceId={editingResourceId}
            onSelectResource={(r) => {
              setEditingResourceId(r.id)
              if (face !== 'markdown') setFace('markdown')
            }}
          />
        </div>
      </Panel>
      <Separator className="h-1 bg-transparent hover:bg-[var(--accent-light)] transition-colors cursor-row-resize" />
      <Panel id="left-bottom" defaultSize={45} minSize={20} maxSize={75}>
        <div className="h-full flex flex-col bg-[var(--bg-surface)] rounded-b-[var(--radius-lg)] border border-[var(--border)] border-t-0 overflow-hidden">
          {face === 'canvas' ? (
            <>
              <div className="px-3 py-2 border-b border-[var(--border)] flex items-center gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
                  画布工具
                </span>
                <div className="ml-auto">
                  <SessionSwitcher projectId={projectId} kind="canvas" />
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                {canvasSessionId ? (
                  <CanvasToolbar projectId={projectId} canvasSessionId={canvasSessionId} />
                ) : (
                  <p className="text-xs text-[var(--text-tertiary)] p-3">无活动画布</p>
                )}
              </div>
            </>
          ) : (
            <MarkdownTools projectId={projectId} />
          )}
        </div>
      </Panel>
    </Group>
  )
}
