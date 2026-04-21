/**
 * featureBreakdown.ts — Canvas template: Feature Breakdown (Epic → Feature → Story)
 *
 * 3-level hierarchy: Epics at top, Features in middle, User Stories at bottom.
 * Uses Frames (zones) for each level group.
 */
import { createFrame, createPRDCard, createUserStoryCard, type CanvasEl } from '../nodeInsert'

const ORIGIN_X = 100
const ORIGIN_Y = 100

export function featureBreakdownElements(): CanvasEl[] {
  const elements: CanvasEl[] = []

  // ── Epic row ──────────────────────────────────────────────────
  const epicData = [
    { title: 'Epic: 用户认证', x: ORIGIN_X, y: ORIGIN_Y },
    { title: 'Epic: 核心功能', x: ORIGIN_X + 620, y: ORIGIN_Y },
  ]
  epicData.forEach(({ title, x, y }) => {
    elements.push(...createFrame(x, y, 560, 80, title))
  })

  // ── Feature row ───────────────────────────────────────────────
  const featureData = [
    { title: '注册与登录',    x: ORIGIN_X,       y: ORIGIN_Y + 130 },
    { title: '权限管理',      x: ORIGIN_X + 310, y: ORIGIN_Y + 130 },
    { title: '需求管理',      x: ORIGIN_X + 620, y: ORIGIN_Y + 130 },
    { title: '协作与评论',    x: ORIGIN_X + 930, y: ORIGIN_Y + 130 },
  ]
  featureData.forEach(({ title, x, y }) => {
    const card = createPRDCard(x, y, title)
    elements.push(...card)
  })

  // ── User Story row ────────────────────────────────────────────
  const storyPositions = [
    { x: ORIGIN_X,       y: ORIGIN_Y + 380 },
    { x: ORIGIN_X + 310, y: ORIGIN_Y + 380 },
    { x: ORIGIN_X + 620, y: ORIGIN_Y + 380 },
    { x: ORIGIN_X + 930, y: ORIGIN_Y + 380 },
  ]
  storyPositions.forEach(({ x, y }) => {
    elements.push(...createUserStoryCard(x, y))
  })

  return elements
}
