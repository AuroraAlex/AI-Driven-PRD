/**
 * CanvasToolbar.tsx
 *
 * Floating left-side vertical toolbar for the canvas.
 * Replaces the static "Canvas fills the center area" placeholder in Workspace.tsx.
 * Renders inside the left sidebar (w-64) when the canvas tab is active.
 */
import { useCanvasStore, type CustomTool, type StickyColor } from '../../store/canvasStore'
import { canvasSnapshotApi } from '../../api/client'
import { addRootNode } from './mindMap'
import {
  MousePointer2, Hand, Type, Square, Minus, Circle,
  StickyNote, BrainCircuit, Layout, Film,
  FileImage, FileText, Bot, Layers,
  Download, History, Maximize2, LayoutTemplate,
} from 'lucide-react'
import clsx from 'clsx'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Section {
  title: string
  items: ToolItem[]
}

interface ToolItem {
  label: string
  icon: React.ReactNode
  action: () => void
  active?: boolean
  sub?: React.ReactNode  // rendered below the button (e.g. color row)
}

// ── Export helpers ────────────────────────────────────────────────────────────

async function exportPNG(api: ReturnType<typeof useCanvasStore.getState>['api']) {
  if (!api) return
  const mod = await import('@excalidraw/excalidraw')
  const blob = await mod.exportToBlob({
    elements: api.getSceneElements() as never[],
    appState: api.getAppState() as never,
    files: api.getFiles() as never,
    mimeType: 'image/png',
    quality: 1,
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = 'canvas.png'; a.click()
  URL.revokeObjectURL(url)
}

async function exportSVG(api: ReturnType<typeof useCanvasStore.getState>['api']) {
  if (!api) return
  const mod = await import('@excalidraw/excalidraw')
  const svg = await mod.exportToSvg({
    elements: api.getSceneElements() as never[],
    appState: api.getAppState() as never,
    files: api.getFiles() as never,
  })
  const url = URL.createObjectURL(new Blob([svg.outerHTML], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'canvas.svg'; a.click()
  URL.revokeObjectURL(url)
}

// ── Sticky colour swatches ────────────────────────────────────────────────────

const STICKY_COLORS: { key: StickyColor; hex: string }[] = [
  { key: 'yellow', hex: '#ffd43b' },
  { key: 'green',  hex: '#a9e34b' },
  { key: 'pink',   hex: '#f783ac' },
  { key: 'blue',   hex: '#74c0fc' },
  { key: 'purple', hex: '#b197fc' },
]

// ── Toolbar component ─────────────────────────────────────────────────────────

export default function CanvasToolbar({ projectId, canvasSessionId }: { projectId: string; canvasSessionId: string }) {
  const store = useCanvasStore()

  function setTool(tool: CustomTool | null) {
    store.setPendingTool(tool)
  }

  function activateMindMap() {
    store.setMindMapMode(true)
    if (store.api) addRootNode(store.api, '核心主题')
  }

  async function saveVersion() {
    if (!store.api || !canvasSessionId) return
    const label = prompt('版本备注（可选）') ?? '快照'
    const elements = JSON.stringify(store.api.getSceneElements())
    const appState = JSON.stringify(store.api.getAppState())
    await canvasSnapshotApi.create(projectId, canvasSessionId, elements, appState, label)
    const snaps = await canvasSnapshotApi.list(projectId, canvasSessionId)
    store.setSnapshots(snaps)
    store.setShowVersionHistory(true)
  }

  function fitView() {
    store.api?.scrollToContent(undefined, { animate: true } as never)
  }

  const sections: Section[] = [
    {
      title: '卡片',
      items: [
        {
          label: '便签',
          icon: <StickyNote size={16} />,
          active: store.pendingTool?.startsWith('sticky_'),
          action: () => {},
          sub: (
            <div className="flex gap-1 mt-1 px-1 flex-wrap">
              {STICKY_COLORS.map(c => (
                <button
                  key={c.key}
                  title={c.key}
                  className={clsx(
                    'w-5 h-5 rounded-full border-2 transition-transform hover:scale-110',
                    store.pendingTool === `sticky_${c.key}` ? 'border-[var(--accent)] scale-110' : 'border-transparent',
                  )}
                  style={{ background: c.hex }}
                  onClick={() => setTool(`sticky_${c.key}` as CustomTool)}
                />
              ))}
            </div>
          ),
        },
        {
          label: '用户故事',
          icon: <Layout size={16} />,
          active: store.pendingTool === 'user_story',
          action: () => setTool('user_story'),
        },
        {
          label: 'AI 卡片',
          icon: <Bot size={16} />,
          active: store.pendingTool === 'ai_card',
          action: () => setTool('ai_card'),
        },
        {
          label: 'PRD 章节',
          icon: <FileText size={16} />,
          active: store.pendingTool === 'prd_card',
          action: () => setTool('prd_card'),
        },
        {
          label: '文件卡',
          icon: <FileImage size={16} />,
          active: store.pendingTool === 'file_card',
          action: () => setTool('file_card'),
        },
      ],
    },
    {
      title: '结构',
      items: [
        {
          label: '分区框',
          icon: <Film size={16} />,
          active: store.pendingTool === 'frame',
          action: () => setTool('frame'),
        },
        {
          label: '思维导图',
          icon: <BrainCircuit size={16} />,
          active: store.mindMapMode,
          action: activateMindMap,
        },
      ],
    },
    {
      title: '操作',
      items: [
        {
          label: '选择模板',
          icon: <LayoutTemplate size={16} />,
          action: () => store.setShowTemplatePicker(true),
        },
        {
          label: '适应画布',
          icon: <Maximize2 size={16} />,
          action: fitView,
        },
        {
          label: '导出 PNG',
          icon: <Download size={16} />,
          action: () => exportPNG(store.api),
        },
        {
          label: '导出 SVG',
          icon: <Layers size={16} />,
          action: () => exportSVG(store.api),
        },
        {
          label: '保存版本',
          icon: <History size={16} />,
          action: saveVersion,
        },
        {
          label: '版本历史',
          icon: <History size={16} />,
          active: store.showVersionHistory,
          action: async () => {
            if (!canvasSessionId) return
            const snaps = await canvasSnapshotApi.list(projectId, canvasSessionId)
            store.setSnapshots(snaps)
            store.setShowVersionHistory(!store.showVersionHistory)
          },
        },
      ],
    },
  ]

  // Suppress unused icon imports lint warning
  void MousePointer2; void Hand; void Type; void Square; void Minus; void Circle

  return (
    <div className="flex flex-col h-full overflow-y-auto py-3 gap-4">
      {/* Pending-tool hint */}
      {store.pendingTool && (
        <div className="mx-3 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent-light)] text-xs text-[var(--accent)] flex items-center justify-between">
          <span>点击画布插入</span>
          <button className="hover:text-[var(--text-primary)]" onClick={() => setTool(null)}>✕</button>
        </div>
      )}

      {sections.map(section => (
        <div key={section.title}>
          <div className="px-4 mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
            {section.title}
          </div>
          <div className="flex flex-col gap-0.5 px-2">
            {section.items.map(item => (
              <div key={item.label}>
                <button
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-2 py-1.5 rounded-[var(--radius-sm)] text-xs text-left transition-colors',
                    item.active
                      ? 'bg-[var(--accent)] text-white'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--text-primary)]',
                  )}
                  onClick={item.action}
                >
                  {item.icon}
                  {item.label}
                </button>
                {item.sub}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Version history panel */}
      {store.showVersionHistory && store.snapshots.length > 0 && (
        <div className="mx-3 mt-1">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] mb-1 px-1">
            快照列表
          </div>
          <div className="flex flex-col gap-1 max-h-48 overflow-y-auto">
            {store.snapshots.map(snap => (
              <button
                key={snap.id}
                className="text-left px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-xs
                           text-[var(--text-secondary)] hover:border-[var(--accent)] hover:text-[var(--text-primary)] transition-colors"
                onClick={async () => {
                  if (!store.api || !canvasSessionId) return
                  const data = await canvasSnapshotApi.restore(projectId, canvasSessionId, snap.id)
                  store.api.updateScene({
                    elements: JSON.parse(data.elements_json || '[]') as never[],
                    appState: JSON.parse(data.app_state_json || '{}') as never,
                  })
                }}
              >
                <div className="font-medium truncate">{snap.label}</div>
                <div className="text-[10px] text-[var(--text-tertiary)]">
                  {new Date(snap.created_at).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
