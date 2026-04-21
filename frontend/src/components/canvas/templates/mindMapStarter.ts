/**
 * mindMapStarter.ts — Canvas template: Mind Map Starter
 *
 * Central root node + 5 branches with 2 sub-nodes each.
 * Also populates canvasStore mmNodes so the mind map tool
 * knows about these nodes and can extend them.
 */
import { createMindMapNode, createMindMapArrow, type CanvasEl } from '../nodeInsert'
import { useCanvasStore } from '../../../store/canvasStore'

const CX = 600
const CY = 400
const R1 = 250
const R2 = 150

const BRANCHES = ['功能需求', '非功能需求', '用户场景', '技术架构', '竞品分析']
const SUB: Record<string, [string, string]> = {
  '功能需求':   ['核心流程', '边界条件'],
  '非功能需求': ['性能指标', '安全要求'],
  '用户场景':   ['主要用户', '使用场景'],
  '技术架构':   ['前端技术', '后端技术'],
  '竞品分析':   ['直接竞品', '间接竞品'],
}

export function mindMapStarterElements(): CanvasEl[] {
  const elements: CanvasEl[] = []
  const store = useCanvasStore.getState()
  store.resetMm()

  // Root node
  const rootEls = createMindMapNode(CX, CY, '产品核心概念', true)
  const rootId = (rootEls[0] as CanvasEl).id as string
  elements.push(...rootEls)
  store.upsertMmNode({ id: rootId, text: '产品核心概念', parentId: null, childrenIds: [], arrowId: null })

  BRANCHES.forEach((branch, i) => {
    const angle = -Math.PI / 2 + ((Math.PI * 2) / BRANCHES.length) * i
    const bx = CX + Math.cos(angle) * R1
    const by = CY + Math.sin(angle) * R1

    const bEls = createMindMapNode(bx, by, branch, false)
    const bid = (bEls[0] as CanvasEl).id as string
    elements.push(...bEls)

    const arrow = createMindMapArrow(CX, CY, bx, by, rootId, bid)
    const arrowId = (arrow as CanvasEl).id as string
    elements.push(arrow)

    const childIds: string[] = []
    const subs = SUB[branch]
    subs.forEach((sub, j) => {
      const subAngle = angle - 0.4 + 0.8 * j
      const sx = bx + Math.cos(subAngle) * R2
      const sy = by + Math.sin(subAngle) * R2

      const sEls = createMindMapNode(sx, sy, sub, false)
      const sid = (sEls[0] as CanvasEl).id as string
      elements.push(...sEls)

      const sArrow = createMindMapArrow(bx, by, sx, sy, bid, sid)
      const sArrowId = (sArrow as CanvasEl).id as string
      elements.push(sArrow)

      childIds.push(sid)
      store.upsertMmNode({ id: sid, text: sub, parentId: bid, childrenIds: [], arrowId: sArrowId })
    })

    store.upsertMmNode({ id: bid, text: branch, parentId: rootId, childrenIds: childIds, arrowId })
    // Update root's children list
    const root = useCanvasStore.getState().mmNodes[rootId]
    if (root) store.upsertMmNode({ ...root, childrenIds: [...root.childrenIds, bid] })
  })

  return elements
}
