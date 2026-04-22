/**
 * extractCanvasContext.ts — TS mirror of backend/agents/canvas/context.py.
 *
 * Renders one or more canvas sessions into a structured plain-text block
 * suitable for inclusion in an LLM prompt or token estimation.
 */

const CARD_ROOTS: Record<string, string> = {
  sticky_note: '便签',
  user_story: '用户故事',
  ai_card: 'AI 卡片',
  prd_card: 'PRD 章节',
  file_card: '文件卡',
  frame: '分区',
  mm_root: '思维导图根',
  mm_node: '思维导图节点',
}

const BODY_TYPES: Record<string, readonly string[]> = {
  sticky_note: ['sticky_note_text'],
  user_story: ['user_story_body'],
  ai_card: ['ai_card_body'],
  prd_card: ['prd_card_body'],
  file_card: ['file_card_label'],
  frame: [],
  mm_root: [],
  mm_node: [],
}

const ALL_BODY_TYPES = new Set(Object.values(BODY_TYPES).flat())

export interface CanvasCard {
  cardId: string
  nodeType: string
  title: string
  body: string
  references: string[]
}

export interface CanvasSessionContext {
  sessionId: string
  title: string
  cards: CanvasCard[]
}

export interface CanvasSessionInput {
  sessionId: string
  title: string
  elementsJson: string
}

const textOf = (el: Record<string, unknown>): string =>
  String((el.text as string) || (el.originalText as string) || '').trim()

export function parseCanvasElements(
  elementsJson: string,
  sessionId: string,
  sessionTitle: string,
): CanvasSessionContext {
  let elems: Array<Record<string, unknown>> = []
  try {
    elems = JSON.parse(elementsJson || '[]')
  } catch {
    elems = []
  }

  const cardsById = new Map<string, CanvasCard>()

  // First pass: card roots
  for (const el of elems) {
    if (el.isDeleted) continue
    const cd = (el.customData as Record<string, unknown>) || {}
    const nt = cd.nodeType as string | undefined
    if (!nt || !(nt in CARD_ROOTS)) continue
    const groupIds = (el.groupIds as string[] | undefined) || []
    const cid = nt === 'frame' ? (el.id as string) : (groupIds[0] || (el.id as string))
    const title = (el.name as string) || CARD_ROOTS[nt]
    if (!cardsById.has(cid)) {
      cardsById.set(cid, { cardId: cid, nodeType: nt, title, body: '', references: [] })
    }
  }

  // Second pass: bodies + references
  for (const el of elems) {
    if (el.isDeleted) continue
    const cd = (el.customData as Record<string, unknown>) || {}
    const nt = cd.nodeType as string | undefined

    // Body text by registered body type
    for (const [rootType, bodyTypes] of Object.entries(BODY_TYPES)) {
      if (nt && bodyTypes.includes(nt)) {
        const groupIds = (el.groupIds as string[] | undefined) || []
        const cid = groupIds[0] || (cd.parentId as string | undefined)
        if (cid && cardsById.has(cid)) {
          const txt = textOf(el)
          if (txt) {
            const card = cardsById.get(cid)!
            card.body = card.body ? `${card.body}\n${txt}` : txt
          }
        }
        break
      }
      void rootType
    }

    // Standalone labels (e.g. mm_node text without explicit body type)
    if (el.type === 'text' && (!nt || !ALL_BODY_TYPES.has(nt))) {
      const groupIds = (el.groupIds as string[] | undefined) || []
      const cid = groupIds[0]
      if (cid && cardsById.has(cid)) {
        const card = cardsById.get(cid)!
        if (!card.body) card.body = textOf(el)
      }
    }

    // AI card sources → references
    if (nt === 'ai_card') {
      const aiContent = (cd.aiContent as Record<string, unknown>) || {}
      const sources = (aiContent.sources as Array<Record<string, unknown>>) || []
      const groupIds = (el.groupIds as string[] | undefined) || []
      const cid = groupIds[0] || (el.id as string)
      const card = cardsById.get(cid)
      if (card) {
        for (const s of sources) {
          if (s && typeof s === 'object') {
            card.references.push(`${s.type ?? '?'}:${s.id ?? '?'}`)
          }
        }
      }
    }
  }

  return { sessionId, title: sessionTitle, cards: Array.from(cardsById.values()) }
}

export function renderSession(
  sess: CanvasSessionContext,
  mode: 'full' | 'summary' = 'full',
): string {
  if (sess.cards.length === 0) return `## 画布「${sess.title}」(空)`
  const lines = [`## 画布「${sess.title}」`]
  for (const card of sess.cards) {
    const label = CARD_ROOTS[card.nodeType] ?? card.nodeType
    let body = card.body
    if (mode === 'summary' && body.length > 120) {
      body = body.slice(0, 120).trimEnd() + '…'
    }
    lines.push(`- [${label}] ${card.title}`.trimEnd())
    if (body) for (const ln of body.split('\n')) lines.push(`    ${ln}`)
    if (card.references.length) lines.push(`    引用: ${card.references.join(', ')}`)
  }
  return lines.join('\n')
}

export function buildCanvasContext(
  sessions: CanvasSessionInput[],
  mode: 'full' | 'summary' = 'full',
): string {
  return sessions
    .map(s => renderSession(parseCanvasElements(s.elementsJson, s.sessionId, s.title), mode))
    .join('\n\n')
}

/** Mixed CJK/latin char→token heuristic (mirrors backend `len(text)/2.5`). */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.floor(text.length / 2.5))
}
