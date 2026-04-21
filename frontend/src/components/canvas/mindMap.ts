/**
 * mindMap.ts
 *
 * Mind map operations: add root, add child, delete node, re-layout.
 * All mutations go through Excalidraw's updateScene so they are
 * automatically persisted by ExcalidrawCanvas.tsx's auto-save.
 */
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'
import { createMindMapNode, createMindMapArrow, type CanvasEl } from './nodeInsert'
import { useCanvasStore, type MindMapNode } from '../../store/canvasStore'

const RADIUS_L1 = 240   // root → first-level children
const RADIUS_L2 = 180   // deeper levels

// ── Helpers ───────────────────────────────────────────────────────────────────

function getViewportCenter(api: ExcalidrawImperativeAPI): { x: number; y: number } {
  const s = api.getAppState()
  const zoom = typeof s.zoom === 'object' ? (s.zoom as { value: number }).value : (s.zoom as number)
  // Approximate canvas coords for the centre of the visible viewport
  return {
    x: (-s.scrollX + 500) / zoom,
    y: (-s.scrollY + 320) / zoom,
  }
}

function getDepth(node: MindMapNode, nodes: Record<string, MindMapNode>): number {
  let d = 0, cur: MindMapNode | undefined = node
  while (cur?.parentId) { d++; cur = nodes[cur.parentId] }
  return d
}

function elementCenter(el: CanvasEl): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 }
}

/** Update arrow element to connect two centre points. */
function refreshArrow(arrow: CanvasEl, fromX: number, fromY: number, toX: number, toY: number): CanvasEl {
  const bx = Math.min(fromX, toX)
  const by = Math.min(fromY, toY)
  const bw = Math.max(Math.abs(toX - fromX), 1)
  const bh = Math.max(Math.abs(toY - fromY), 1)
  return {
    ...arrow,
    x: bx, y: by, width: bw, height: bh,
    points: [[fromX - bx, fromY - by], [toX - bx, toY - by]],
    updated: Date.now(),
  }
}

// ── Add root node ─────────────────────────────────────────────────────────────

export function addRootNode(api: ExcalidrawImperativeAPI, text = '核心主题'): string {
  const store = useCanvasStore.getState()
  const center = getViewportCenter(api)

  const els = createMindMapNode(center.x, center.y, text, true)
  const rootId = (els[0] as CanvasEl).id as string

  api.updateScene({ elements: [...api.getSceneElements(), ...els] as never[] })

  store.upsertMmNode({ id: rootId, text, parentId: null, childrenIds: [], arrowId: null })
  return rootId
}

// ── Add child node ────────────────────────────────────────────────────────────

export function addChildNode(api: ExcalidrawImperativeAPI, parentId: string, text = '子节点'): string {
  const store = useCanvasStore.getState()
  const nodes = store.mmNodes
  const parent = nodes[parentId]
  if (!parent) return ''

  const allEls = api.getSceneElements() as unknown as CanvasEl[]
  const parentEl = allEls.find(e => e.id === parentId)
  if (!parentEl) return ''

  const pc = elementCenter(parentEl)
  const depth = getDepth(parent, nodes)
  const radius = depth === 0 ? RADIUS_L1 : RADIUS_L2
  const siblingCount = parent.childrenIds.length

  // Distribute siblings evenly around the parent
  const totalSlots = siblingCount + 1
  const baseAngle = depth === 0
    ? -Math.PI / 2  // first child of root goes up
    : Math.atan2(pc.y - (allEls.find(e => e.id === parent.parentId!)?.y ?? pc.y), pc.x - (allEls.find(e => e.id === parent.parentId!)?.x ?? pc.x))
  const angleStep = (Math.PI * 2) / Math.max(totalSlots, 4)
  const angle = baseAngle + angleStep * siblingCount

  const cx = pc.x + Math.cos(angle) * radius
  const cy = pc.y + Math.sin(angle) * radius

  const childEls = createMindMapNode(cx, cy, text, false)
  const childId = (childEls[0] as CanvasEl).id as string

  const arrow = createMindMapArrow(pc.x, pc.y, cx, cy, parentId, childId)
  const arrowId = (arrow as CanvasEl).id as string

  api.updateScene({ elements: [...allEls, ...childEls, arrow] as never[] })

  store.upsertMmNode({ ...parent, childrenIds: [...parent.childrenIds, childId] })
  store.upsertMmNode({ id: childId, text, parentId, childrenIds: [], arrowId })

  // Relayout all siblings so angles are evenly distributed
  relayoutChildren(api, parentId)
  return childId
}

// ── Add sibling node ──────────────────────────────────────────────────────────

export function addSiblingNode(api: ExcalidrawImperativeAPI, siblingId: string, text = '兄弟节点'): string {
  const store = useCanvasStore.getState()
  const sibling = store.mmNodes[siblingId]
  if (!sibling?.parentId) return addRootNode(api, text)
  return addChildNode(api, sibling.parentId, text)
}

// ── Delete node (and all descendants) ────────────────────────────────────────

export function deleteNode(api: ExcalidrawImperativeAPI, nodeId: string): void {
  const store = useCanvasStore.getState()
  const nodes = store.mmNodes

  // Collect all descendant shape IDs
  function collectIds(id: string): string[] {
    const n = nodes[id]
    if (!n) return [id]
    return [id, ...n.childrenIds.flatMap(collectIds)]
  }
  const shapesToDelete = new Set(collectIds(nodeId))

  // Find bound text + arrow elements
  const toDelete = new Set<string>(shapesToDelete)
  const allEls = api.getSceneElements() as unknown as CanvasEl[]
  allEls.forEach(el => {
    const cd = el.customData
    if (!cd) return
    if (cd.nodeType === 'mm_node_text' && shapesToDelete.has(cd.shapeId)) toDelete.add(el.id)
    if (cd.nodeType === 'mm_arrow' && (shapesToDelete.has(cd.fromId) || shapesToDelete.has(cd.toId))) toDelete.add(el.id)
  })

  api.updateScene({ elements: allEls.filter(e => !toDelete.has(e.id)) as never[] })

  // Remove from store + update parent
  const node = nodes[nodeId]
  if (node?.parentId) {
    const p = nodes[node.parentId]
    if (p) store.upsertMmNode({ ...p, childrenIds: p.childrenIds.filter(id => id !== nodeId) })
  }
  shapesToDelete.forEach(id => store.removeMmNode(id))
}

// ── Relayout children of a given parent ──────────────────────────────────────

export function relayoutChildren(api: ExcalidrawImperativeAPI, parentId: string): void {
  const store = useCanvasStore.getState()
  const nodes = store.mmNodes
  const parent = nodes[parentId]
  if (!parent || parent.childrenIds.length === 0) return

  const allEls = api.getSceneElements() as unknown as CanvasEl[]
  const parentEl = allEls.find(e => e.id === parentId)
  if (!parentEl) return

  const pc = elementCenter(parentEl)
  const depth = getDepth(parent, nodes)
  const radius = depth === 0 ? RADIUS_L1 : RADIUS_L2
  const n = parent.childrenIds.length
  const baseAngle = -Math.PI / 2  // start distributing from top

  // Build a position map for children
  const newPos: Record<string, { cx: number; cy: number }> = {}
  parent.childrenIds.forEach((cid, i) => {
    const angle = baseAngle + ((Math.PI * 2) / n) * i
    newPos[cid] = {
      cx: pc.x + Math.cos(angle) * radius,
      cy: pc.y + Math.sin(angle) * radius,
    }
  })

  // Update element positions and arrows
  const updated = allEls.map(el => {
    const pos = newPos[el.id]
    if (pos) {
      return { ...el, x: pos.cx - el.width / 2, y: pos.cy - el.height / 2, updated: Date.now() }
    }
    // Update bound text elements that belong to repositioned nodes
    const cd = el.customData
    if (cd?.nodeType === 'mm_node_text' && newPos[cd.shapeId]) {
      const p = newPos[cd.shapeId]
      return { ...el, x: p.cx - el.width / 2, y: p.cy - 11, updated: Date.now() }
    }
    // Update arrows
    if (cd?.nodeType === 'mm_arrow') {
      const fromEl = allEls.find(e => e.id === cd.fromId)
      const toEl = allEls.find(e => e.id === cd.toId)
      const fromPos = newPos[cd.fromId] ?? (fromEl ? elementCenter(fromEl) : null)
      const toPos = newPos[cd.toId] ?? (toEl ? elementCenter(toEl) : null)
      if (fromPos && toPos) {
        return refreshArrow(el, fromPos.cx, fromPos.cy, toPos.cx, toPos.cy)
      }
    }
    return el
  })

  api.updateScene({ elements: updated as never[] })
}
