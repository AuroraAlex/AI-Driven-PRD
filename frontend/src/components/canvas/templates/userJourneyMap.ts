/**
 * userJourneyMap.ts — Canvas template: User Journey Map
 *
 * 5 horizontal swimlane zones (Awareness, Consideration, Decision, Onboarding, Retention)
 * Each zone contains pre-filled sticky notes as placeholders.
 */
import { createFrame, createStickyNote, type CanvasEl } from '../nodeInsert'

const LANE_W = 240
const LANE_H = 480
const GAP = 20
const ORIGIN_X = 100
const ORIGIN_Y = 100

const LANES = [
  { title: '认知阶段', color: 'blue' as const },
  { title: '考虑阶段', color: 'green' as const },
  { title: '决策阶段', color: 'yellow' as const },
  { title: '上手阶段', color: 'pink' as const },
  { title: '留存阶段', color: 'purple' as const },
]

const STICKY_TEXTS = [
  ['用户第一次听说产品', '广告/口碑触达', '需求萌芽'],
  ['搜索解决方案', '对比竞品', '关注核心价值'],
  ['试用/体验', '评估成本收益', '做出购买决定'],
  ['注册与配置', '首次使用体验', 'Aha Moment'],
  ['持续使用习惯', '功能深度挖掘', '成为推荐者'],
]

export function userJourneyMapElements(): CanvasEl[] {
  const elements: CanvasEl[] = []

  LANES.forEach((lane, i) => {
    const lx = ORIGIN_X + i * (LANE_W + GAP)
    const ly = ORIGIN_Y

    // Swimlane frame
    elements.push(...createFrame(lx, ly, LANE_W, LANE_H, lane.title))

    // 3 sticky notes per lane
    const texts = STICKY_TEXTS[i]
    texts.forEach((t, j) => {
      const sx = lx + 20
      const sy = ly + 50 + j * (180 + 16)
      const notes = createStickyNote(sx, sy, lane.color)
      // Override placeholder text with actual content
      const textEl = notes.find(e => e.customData?.nodeType === 'sticky_note_text')
      if (textEl) { textEl.text = t; textEl.originalText = t }
      elements.push(...notes)
    })
  })

  return elements
}
