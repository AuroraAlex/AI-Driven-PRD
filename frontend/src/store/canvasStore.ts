import { create } from 'zustand'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'

export type StickyColor = 'yellow' | 'green' | 'pink' | 'blue' | 'purple'

export type CustomTool =
  | `sticky_${StickyColor}`
  | 'user_story'
  | 'ai_card'
  | 'prd_card'
  | 'file_card'
  | 'frame'
  | 'mindmap_node'

export interface MindMapNode {
  /** Excalidraw element id for the shape */
  id: string
  text: string
  parentId: string | null
  childrenIds: string[]
  /** Arrow element id connecting parent → this node */
  arrowId: string | null
}

export interface SnapshotMeta {
  id: string
  label: string
  created_at: string
}

interface CanvasState {
  // ── Excalidraw API reference ──────────────────────────────────
  api: ExcalidrawImperativeAPI | null
  setApi: (api: ExcalidrawImperativeAPI) => void

  // ── Card insertion tool ───────────────────────────────────────
  pendingTool: CustomTool | null
  setPendingTool: (t: CustomTool | null) => void

  // ── Inspector ─────────────────────────────────────────────────
  selectedElementId: string | null
  setSelectedElementId: (id: string | null) => void

  // ── Mind map ──────────────────────────────────────────────────
  mindMapMode: boolean
  setMindMapMode: (on: boolean) => void
  mmNodes: Record<string, MindMapNode>
  upsertMmNode: (node: MindMapNode) => void
  removeMmNode: (id: string) => void
  resetMm: () => void

  // ── Version history ───────────────────────────────────────────
  showVersionHistory: boolean
  setShowVersionHistory: (v: boolean) => void
  snapshots: SnapshotMeta[]
  setSnapshots: (s: SnapshotMeta[]) => void

  // ── Template picker ───────────────────────────────────────────
  showTemplatePicker: boolean
  setShowTemplatePicker: (v: boolean) => void

  // ── Change counter (triggers minimap re-render) ───────────────
  changeCount: number
  bumpChangeCount: () => void

  // ── AI context stub ───────────────────────────────────────────
  /** Extract all text from canvas elements. Pre-wired for future AI integration. */
  extractText: () => string
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
  api: null,
  setApi: api => set({ api }),

  pendingTool: null,
  setPendingTool: t => set({ pendingTool: t }),

  selectedElementId: null,
  setSelectedElementId: id => set({ selectedElementId: id }),

  mindMapMode: false,
  setMindMapMode: on => set({ mindMapMode: on }),
  mmNodes: {},
  upsertMmNode: node => set(s => ({ mmNodes: { ...s.mmNodes, [node.id]: node } })),
  removeMmNode: id =>
    set(s => {
      const n = { ...s.mmNodes }
      delete n[id]
      return { mmNodes: n }
    }),
  resetMm: () => set({ mmNodes: {}, mindMapMode: false }),

  showVersionHistory: false,
  setShowVersionHistory: v => set({ showVersionHistory: v }),
  snapshots: [],
  setSnapshots: s => set({ snapshots: s }),

  showTemplatePicker: false,
  setShowTemplatePicker: v => set({ showTemplatePicker: v }),

  changeCount: 0,
  bumpChangeCount: () => set(s => ({ changeCount: s.changeCount + 1 })),

  extractText: () => {
    const api = get().api
    if (!api) return ''
    return api
      .getSceneElements()
      .filter(el => !el.isDeleted && el.type === 'text')
      .map(el => (el as Record<string, unknown>).text as string)
      .filter(Boolean)
      .join('\n')
  },
}))
