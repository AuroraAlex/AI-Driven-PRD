/**
 * CenterFlipCard
 *
 * The main center column. Renders a 3D flip card with two faces:
 *   - Front: Excalidraw canvas (+ overlays)
 *   - Back : Markdown editor bound to the currently selected ResourceBlock
 *
 * Both faces stay mounted so the flip animation is smooth and the canvas
 * doesn't reset its viewport when switching back. A small toggle button
 * floats at the top-right of whichever face is currently visible.
 */
import { useEffect, useMemo, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  LayoutPanelLeft, FileText, FilePlus, Upload, Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ExcalidrawCanvas from '../canvas/ExcalidrawCanvas'
import CanvasInspector from '../canvas/CanvasInspector'
import CanvasMinimap from '../canvas/CanvasMinimap'
import CanvasTemplateModal from '../canvas/CanvasTemplateModal'
import AICardEditor from '../canvas/AICardEditor'
import ResourceCardViewer from '../canvas/ResourceCardViewer'
import MarkdownEditor, { type MarkdownEditorHandle } from '../markdown/MarkdownEditor'
import { resourcesApi, type ResourceBlock } from '../../api/client'
import { useWorkspace } from './WorkspaceContext'

interface Props {
  projectId: string
  canvasSessionId: string | null
}

/**
 * Resources that are eligible to appear in the center Markdown editor.
 * PRDs are excluded — they live behind the top-bar PRD button on the
 * dedicated ProjectOverview page.
 */
function isCenterEditable(r: ResourceBlock): boolean {
  if (r.kind !== 'document' && r.kind !== 'snippet') return false
  if (r.origin_type === 'prd_template') return false
  return true
}

export default function CenterFlipCard({ projectId, canvasSessionId }: Props) {
  const { face, toggleFace, editingResourceId, setEditingResourceId, markdownEditorRef } =
    useWorkspace()
  const qc = useQueryClient()

  const { data: resources = [] } = useQuery({
    queryKey: ['resources', projectId],
    queryFn: () => resourcesApi.list(projectId),
  })

  const editable = useMemo(() => resources.filter(isCenterEditable), [resources])

  // Default the editing target to the first editable resource.
  useEffect(() => {
    if (editingResourceId && editable.some(r => r.id === editingResourceId)) return
    setEditingResourceId(editable[0]?.id ?? null)
  }, [editable, editingResourceId, setEditingResourceId])

  return (
    <div className="relative h-full w-full" style={{ perspective: '2000px' }}>
      <div
        className="relative h-full w-full transition-transform duration-700 ease-[cubic-bezier(.4,.2,.2,1)]"
        style={{
          transformStyle: 'preserve-3d',
          transform: face === 'markdown' ? 'rotateY(180deg)' : 'rotateY(0deg)',
        }}
      >
        {/* Front face: Canvas */}
        <Face side="front" hidden={face === 'markdown'}>
          <FlipToggle face={face} onToggle={toggleFace} />
          {canvasSessionId ? (
            <>
              <ExcalidrawCanvas projectId={projectId} canvasSessionId={canvasSessionId} />
              <CanvasInspector projectId={projectId} />
              <CanvasMinimap />
              <CanvasTemplateModal />
              <AICardEditor projectId={projectId} canvasSessionId={canvasSessionId} />
              <ResourceCardViewer projectId={projectId} />
            </>
          ) : (
            <div className="h-full flex items-center justify-center text-[var(--text-tertiary)] text-sm">
              正在准备画布会话…
            </div>
          )}
        </Face>

        {/* Back face: Markdown editor bound to a ResourceBlock */}
        <Face side="back" hidden={face === 'canvas'}>
          <FlipToggle face={face} onToggle={toggleFace} />
          <MarkdownFace
            projectId={projectId}
            editable={editable}
            editingResourceId={editingResourceId}
            setEditingResourceId={setEditingResourceId}
            editorRef={markdownEditorRef}
            onResourcesChanged={() => qc.invalidateQueries({ queryKey: ['resources', projectId] })}
            uploadInputId={UPLOAD_INPUT_ID}
          />
        </Face>
      </div>
    </div>
  )
}

const UPLOAD_INPUT_ID = 'workspace-resource-upload-input'

function Face({
  side, hidden, children,
}: { side: 'front' | 'back'; hidden: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 rounded-[var(--radius-lg)] bg-[var(--bg-surface)] shadow-[var(--shadow-sm)] border border-[var(--border)] overflow-hidden"
      style={{
        backfaceVisibility: 'hidden',
        WebkitBackfaceVisibility: 'hidden',
        transform: side === 'back' ? 'rotateY(180deg)' : 'rotateY(0deg)',
        // Hide the off-side from pointer events so flipped face isn't accidentally clickable
        pointerEvents: hidden ? 'none' : 'auto',
      }}
      aria-hidden={hidden}
    >
      {children}
    </div>
  )
}

function FlipToggle({ face, onToggle }: { face: 'canvas' | 'markdown'; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-[var(--radius-sm)] text-xs font-medium
                 bg-[var(--bg-glass)] backdrop-blur border border-[var(--border)] text-[var(--text-secondary)]
                 hover:text-[var(--accent)] hover:border-[var(--accent)] transition-colors shadow-sm"
      title="翻面切换 Canvas / Markdown"
    >
      {face === 'canvas' ? <FileText size={13} /> : <LayoutPanelLeft size={13} />}
      {face === 'canvas' ? '切到 Markdown' : '切到 Canvas'}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────────

interface MarkdownFaceProps {
  projectId: string
  editable: ResourceBlock[]
  editingResourceId: string | null
  setEditingResourceId: (id: string | null) => void
  editorRef: React.MutableRefObject<MarkdownEditorHandle | null>
  onResourcesChanged: () => void
  uploadInputId: string
}

function MarkdownFace({
  projectId, editable, editingResourceId, setEditingResourceId,
  editorRef, onResourcesChanged, uploadInputId,
}: MarkdownFaceProps) {
  const qc = useQueryClient()

  const { data: doc, isLoading } = useQuery({
    queryKey: ['resource', projectId, editingResourceId],
    queryFn: () => resourcesApi.get(projectId, editingResourceId!),
    enabled: !!editingResourceId,
  })

  const valueRef = useRef('')
  if (doc) valueRef.current = doc.markdown_content || ''

  const saveTimer = useRef<number | null>(null)

  const updateMut = useMutation({
    mutationFn: (payload: { title?: string; markdown_content?: string }) =>
      resourcesApi.update(projectId, editingResourceId!, payload),
    onSuccess: (data) => {
      qc.setQueryData(['resource', projectId, editingResourceId], data)
      onResourcesChanged()
    },
    onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
  })

  const createMut = useMutation({
    mutationFn: () =>
      resourcesApi.create(projectId, {
        kind: 'document',
        title: '未命名文档',
        markdown_content: '# 未命名文档\n\n',
      }),
    onSuccess: (r) => {
      onResourcesChanged()
      setEditingResourceId(r.id)
      toast.success('已新建文档')
    },
  })

  function onChangeBody(next: string) {
    valueRef.current = next
    if (!editingResourceId) return
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      updateMut.mutate({ markdown_content: next })
    }, 1500)
  }

  function onChangeTitle(next: string) {
    if (!editingResourceId) return
    qc.setQueryData<ResourceBlock>(['resource', projectId, editingResourceId], (prev) =>
      prev ? { ...prev, title: next } : prev)
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      updateMut.mutate({ title: next })
    }, 800)
  }

  // Empty state — no editable resources at all
  if (editable.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-8 gap-4">
        <FileText size={48} className="text-[var(--text-tertiary)] opacity-50" />
        <div>
          <p className="text-sm font-medium text-[var(--text-primary)]">暂无可编辑的资源</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            新建一个文档或在左侧上传文件后开始编辑
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
          >
            {createMut.isPending ? <Loader2 size={13} className="animate-spin" /> : <FilePlus size={13} />}
            新建文档
          </button>
          <button
            onClick={() => document.getElementById(uploadInputId)?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
          >
            <Upload size={13} /> 上传文件
          </button>
        </div>
      </div>
    )
  }

  if (isLoading || !doc) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-[var(--text-tertiary)]">
        <Loader2 size={16} className="animate-spin mr-2" /> 加载文档…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Title bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] shrink-0">
        <FileText size={14} className="text-[var(--accent)] shrink-0" />
        <input
          className="flex-1 min-w-0 text-sm font-semibold bg-transparent outline-none border-b border-transparent focus:border-[var(--accent)] py-0.5"
          value={doc.title}
          onChange={e => onChangeTitle(e.target.value)}
          placeholder="文档标题"
        />
        {updateMut.isPending && (
          <span className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1">
            <Loader2 size={10} className="animate-spin" /> 保存中
          </span>
        )}
      </div>
      {/* Editor */}
      <div className="flex-1 min-h-0">
        <MarkdownEditor
          ref={editorRef}
          value={valueRef.current}
          onChange={onChangeBody}
          placeholder="开始编辑…"
        />
      </div>
    </div>
  )
}
