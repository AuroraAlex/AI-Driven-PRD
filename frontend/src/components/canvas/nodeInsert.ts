/**
 * nodeInsert.ts
 *
 * Factory functions that produce Excalidraw element arrays for each custom card type.
 * All elements in a composite card share the same groupId so they move as one unit.
 *
 * Usage:
 *   const els = createStickyNote(x, y, 'yellow')
 *   api.updateScene({ elements: [...api.getSceneElements(), ...els] })
 */

// We intentionally use a loose type so we don't need to import internal Excalidraw types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CanvasEl = Record<string, any>

function uid(): string {
  return Math.random().toString(36).slice(2, 12)
}

function base(overrides: Partial<CanvasEl> = {}): CanvasEl {
  return {
    id: uid(),
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    angle: 0,
    strokeColor: '#1e1e1e',
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    boundElements: [],
    updated: Date.now(),
    isDeleted: false,
    version: 1,
    versionNonce: Math.floor(Math.random() * 2_000_000_000),
    seed: Math.floor(Math.random() * 1_000_000),
    link: null,
    locked: false,
    customData: {},
    ...overrides,
  }
}

function mkText(overrides: Partial<CanvasEl> = {}): CanvasEl {
  return base({
    type: 'text',
    text: '',
    originalText: '',
    fontSize: 14,
    fontFamily: 2,        // 1 = hand-drawn (Virgil), 2 = Helvetica, 3 = mono
    textAlign: 'left',
    verticalAlign: 'top',
    containerId: null,
    lineHeight: 1.35,
    autoResize: true,
    strokeColor: '#212529',
    backgroundColor: 'transparent',
    strokeWidth: 1,
    ...overrides,
  })
}

// ── STICKY NOTE ───────────────────────────────────────────────────────────────

export const STICKY_COLORS: Record<string, { bg: string; stroke: string; text: string }> = {
  yellow: { bg: '#ffd43b', stroke: '#f59f00', text: '#212529' },
  green:  { bg: '#a9e34b', stroke: '#74b816', text: '#212529' },
  pink:   { bg: '#f783ac', stroke: '#e64980', text: '#212529' },
  blue:   { bg: '#74c0fc', stroke: '#339af0', text: '#212529' },
  purple: { bg: '#b197fc', stroke: '#7950f2', text: '#212529' },
}

export function createStickyNote(x: number, y: number, color = 'yellow'): CanvasEl[] {
  const c = STICKY_COLORS[color] ?? STICKY_COLORS.yellow
  const gid = uid()
  const rid = uid()
  const tid = uid()

  const rect = base({
    id: rid,
    type: 'rectangle',
    x, y,
    width: 200,
    height: 180,
    backgroundColor: c.bg,
    strokeColor: c.stroke,
    fillStyle: 'solid',
    roughness: 1,
    roundness: { type: 3 },
    strokeWidth: 2,
    groupIds: [gid],
    boundElements: [{ type: 'text', id: tid }],
    customData: { nodeType: 'sticky_note', color },
  })

  const text = mkText({
    id: tid,
    x: x + 12,
    y: y + 12,
    width: 176,
    height: 156,
    text: '在这里写下你的想法...',
    originalText: '在这里写下你的想法...',
    fontSize: 15,
    fontFamily: 1,
    containerId: rid,
    strokeColor: c.text,
    groupIds: [gid],
    customData: { nodeType: 'sticky_note_text', parentId: rid },
  })

  return [rect, text]
}

// ── USER STORY CARD ───────────────────────────────────────────────────────────

export function createUserStoryCard(x: number, y: number): CanvasEl[] {
  const gid = uid()
  const W = 280, H = 210

  const bg = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: H,
    backgroundColor: '#ffffff', strokeColor: '#dee2e6',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 1.5,
    groupIds: [gid], customData: { nodeType: 'user_story' },
  })

  const header = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: 38,
    backgroundColor: '#339af0', strokeColor: '#339af0',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 0,
    groupIds: [gid], customData: { nodeType: 'user_story_header' },
  })

  const headerText = mkText({
    id: uid(), x: x + 12, y: y + 9, width: W - 24, height: 20,
    text: '👤  User Story', originalText: '👤  User Story',
    fontSize: 13, fontFamily: 2, strokeColor: '#ffffff', groupIds: [gid],
    customData: { nodeType: 'user_story_header_text' },
  })

  const rows = [
    { label: 'As a:', ly: y + 48 },
    { label: 'I want:', ly: y + 96 },
    { label: 'So that:', ly: y + 150 },
  ]

  const fieldEls: CanvasEl[] = rows.flatMap(({ label, ly }) => [
    mkText({
      id: uid(), x: x + 12, y: ly, width: 58, height: 18,
      text: label, originalText: label,
      fontSize: 11, fontFamily: 2, strokeColor: '#868e96', groupIds: [gid],
      customData: { nodeType: 'user_story_label' },
    }),
    mkText({
      id: uid(), x: x + 74, y: ly, width: W - 86, height: 36,
      text: '...', originalText: '...',
      fontSize: 13, fontFamily: 1, strokeColor: '#212529', groupIds: [gid],
      customData: { nodeType: 'user_story_field' },
    }),
  ])

  return [bg, header, headerText, ...fieldEls]
}

// ── AI CARD ───────────────────────────────────────────────────────────────────

export function createAICard(x: number, y: number, content = ''): CanvasEl[] {
  const gid = uid()
  const W = 280, H = 200

  const bg = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: H,
    backgroundColor: '#f8f0ff', strokeColor: '#9775fa',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 1.5,
    groupIds: [gid], customData: { nodeType: 'ai_card' },
  })

  const header = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: 38,
    backgroundColor: '#7950f2', strokeColor: '#7950f2',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 0,
    groupIds: [gid], customData: { nodeType: 'ai_card_header' },
  })

  const headerText = mkText({
    id: uid(), x: x + 12, y: y + 9, width: W - 24, height: 20,
    text: '✦  AI 生成', originalText: '✦  AI 生成',
    fontSize: 13, fontFamily: 2, strokeColor: '#ffffff', groupIds: [gid],
    customData: { nodeType: 'ai_card_header_text' },
  })

  const body = mkText({
    id: uid(), x: x + 12, y: y + 48, width: W - 24, height: H - 60,
    text: content || '在这里记录 AI 的分析结果...',
    originalText: content || '在这里记录 AI 的分析结果...',
    fontSize: 13, fontFamily: 2, strokeColor: '#495057', groupIds: [gid],
    customData: { nodeType: 'ai_card_body' },
  })

  return [bg, header, headerText, body]
}

// ── PRD SECTION CARD ──────────────────────────────────────────────────────────

export function createPRDCard(x: number, y: number, title = ''): CanvasEl[] {
  const gid = uid()
  const W = 280, H = 200

  const bg = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: H,
    backgroundColor: '#f0fff4', strokeColor: '#40c057',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 1.5,
    groupIds: [gid], customData: { nodeType: 'prd_card' },
  })

  const header = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: 38,
    backgroundColor: '#40c057', strokeColor: '#40c057',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 0,
    groupIds: [gid], customData: { nodeType: 'prd_card_header' },
  })

  const headerText = mkText({
    id: uid(), x: x + 12, y: y + 9, width: W - 24, height: 20,
    text: '📄  ' + (title || 'PRD 章节'), originalText: '📄  ' + (title || 'PRD 章节'),
    fontSize: 13, fontFamily: 2, strokeColor: '#ffffff', groupIds: [gid],
    customData: { nodeType: 'prd_card_header_text' },
  })

  const body = mkText({
    id: uid(), x: x + 12, y: y + 48, width: W - 24, height: H - 60,
    text: '章节内容描述...', originalText: '章节内容描述...',
    fontSize: 13, fontFamily: 2, strokeColor: '#495057', groupIds: [gid],
    customData: { nodeType: 'prd_card_body' },
  })

  return [bg, header, headerText, body]
}

// ── FILE CARD ─────────────────────────────────────────────────────────────────

export function createFileCard(x: number, y: number): CanvasEl[] {
  const gid = uid()
  const W = 200, H = 160

  const bg = base({
    id: uid(), type: 'rectangle', x, y, width: W, height: H,
    backgroundColor: '#f8f9fa', strokeColor: '#ced4da',
    fillStyle: 'solid', roughness: 0, roundness: { type: 3 }, strokeWidth: 1.5,
    groupIds: [gid], customData: { nodeType: 'file_card', fileId: null },
  })

  const iconArea = base({
    id: uid(), type: 'rectangle',
    x: x + 20, y: y + 20, width: W - 40, height: 90,
    backgroundColor: '#e9ecef', strokeColor: '#dee2e6',
    fillStyle: 'solid', roughness: 0, roundness: { type: 2 }, strokeWidth: 1,
    groupIds: [gid], customData: { nodeType: 'file_card_icon' },
  })

  const iconText = mkText({
    id: uid(), x: x + W / 2 - 16, y: y + 42, width: 32, height: 36,
    text: '📎', originalText: '📎',
    fontSize: 28, fontFamily: 2, textAlign: 'center', strokeColor: '#868e96',
    groupIds: [gid], customData: { nodeType: 'file_card_icon_text' },
  })

  const label = mkText({
    id: uid(), x: x + 8, y: y + H - 32, width: W - 16, height: 24,
    text: '点击选择文件...', originalText: '点击选择文件...',
    fontSize: 11, fontFamily: 2, textAlign: 'center', strokeColor: '#868e96',
    groupIds: [gid], customData: { nodeType: 'file_card_label' },
  })

  return [bg, iconArea, iconText, label]
}

// ── FRAME / ZONE ──────────────────────────────────────────────────────────────

export function createFrame(x: number, y: number, w = 600, h = 400, title = '分区'): CanvasEl[] {
  const frame = base({
    id: uid(), type: 'frame', x, y, width: w, height: h,
    backgroundColor: 'transparent', strokeColor: '#339af0',
    fillStyle: 'solid', roughness: 0, roundness: null, strokeWidth: 2,
    name: title, groupIds: [],
    customData: { nodeType: 'frame' },
  })
  return [frame]
}

// ── MIND MAP NODE ─────────────────────────────────────────────────────────────

export function createMindMapNode(cx: number, cy: number, text: string, isRoot = false): CanvasEl[] {
  const W = isRoot ? 160 : 130
  const H = isRoot ? 52 : 44
  const id = uid()
  const tid = uid()

  const shape = base({
    id,
    type: 'ellipse',
    x: cx - W / 2, y: cy - H / 2, width: W, height: H,
    backgroundColor: isRoot ? '#339af0' : '#f1f3f5',
    strokeColor: isRoot ? '#1c7ed6' : '#adb5bd',
    fillStyle: 'solid', roughness: 0, strokeWidth: isRoot ? 2.5 : 1.5,
    groupIds: [],
    boundElements: [{ type: 'text', id: tid }],
    customData: { nodeType: isRoot ? 'mm_root' : 'mm_node', mmText: text },
  })

  const textEl = mkText({
    id: tid,
    x: cx - W / 2 + 8, y: cy - H / 2 + (H - 18) / 2, width: W - 16, height: 22,
    text, originalText: text,
    fontSize: isRoot ? 15 : 13, fontFamily: 2,
    textAlign: 'center', verticalAlign: 'middle',
    strokeColor: isRoot ? '#ffffff' : '#343a40',
    containerId: id, groupIds: [],
    customData: { nodeType: 'mm_node_text', shapeId: id },
  })

  return [shape, textEl]
}

// ── MIND MAP ARROW ────────────────────────────────────────────────────────────

export function createMindMapArrow(
  fromX: number, fromY: number,
  toX: number, toY: number,
  fromId: string, toId: string,
): CanvasEl {
  const bx = Math.min(fromX, toX)
  const by = Math.min(fromY, toY)
  const bw = Math.max(Math.abs(toX - fromX), 1)
  const bh = Math.max(Math.abs(toY - fromY), 1)

  return base({
    id: uid(),
    type: 'arrow',
    x: bx, y: by, width: bw, height: bh,
    points: [[fromX - bx, fromY - by], [toX - bx, toY - by]],
    startBinding: null, endBinding: null,
    startArrowhead: null, endArrowhead: 'arrow',
    strokeColor: '#adb5bd', strokeWidth: 1.5, roughness: 0,
    groupIds: [],
    customData: { nodeType: 'mm_arrow', fromId, toId },
  })
}
