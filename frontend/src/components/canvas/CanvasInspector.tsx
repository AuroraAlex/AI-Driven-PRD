/**
 * CanvasInspector.tsx
 *
 * Floating right panel that appears when an element is selected.
 * Shows type-specific editing controls based on customData.nodeType.
 */
import { useEffect, useState } from 'react'
import { useCanvasStore } from '../../store/canvasStore'
import { STICKY_COLORS, type CanvasEl } from './nodeInsert'
import { X, Trash2 } from 'lucide-react'
import clsx from 'clsx'

type NodeType = string | undefined

function getNodeType(el: CanvasEl): NodeType {
  return el?.customData?.nodeType
}

function getRootNode(els: CanvasEl[], selectedId: string): CanvasEl | null {
  const el = els.find(e => e.id === selectedId)
  if (!el) return null
  // If it's a text/child element of a composite card, find the rect group root
  if (el.groupIds?.length) {
    const groupId = el.groupIds[0]
    const groupEls = els.filter(e => e.groupIds?.includes(groupId))
    // Root is the one with the nodeType we recognise
    const root = groupEls.find(e => {
      const nt = getNodeType(e)
      return ['sticky_note', 'user_story', 'ai_card', 'prd_card', 'file_card'].includes(nt ?? '')
    })
    return root ?? groupEls[0] ?? el
  }
  return el
}

export default function CanvasInspector() {
  const { api, selectedElementId, setSelectedElementId } = useCanvasStore()
  const [, forceUpdate] = useState(0)

  useEffect(() => {
    forceUpdate(n => n + 1)
  }, [selectedElementId])

  if (!api || !selectedElementId) return null

  const allEls = api.getSceneElements() as unknown as CanvasEl[]
  const root = getRootNode(allEls, selectedElementId)
  if (!root) return null

  const nodeType = getNodeType(root)

  function updateCustomData(id: string, patch: Record<string, unknown>) {
    const updated = allEls.map(el =>
      el.id === id ? { ...el, customData: { ...el.customData, ...patch }, updated: Date.now() } : el,
    )
    api!.updateScene({ elements: updated as never[] })
    forceUpdate(n => n + 1)
  }

  function updateText(shapeId: string, text: string) {
    const updated = allEls.map(el => {
      const cd = el.customData
      if (el.id === shapeId || cd?.containerId === shapeId || cd?.parentId === shapeId) {
        return { ...el, text, originalText: text, updated: Date.now() }
      }
      return el
    })
    api!.updateScene({ elements: updated as never[] })
    forceUpdate(n => n + 1)
  }

  function deleteElement() {
    if (!root) return
    const groupId = root.groupIds?.[0]
    const keep = groupId
      ? allEls.filter(e => !e.groupIds?.includes(groupId))
      : allEls.filter(e => e.id !== root.id)
    api!.updateScene({ elements: keep as never[] })
    setSelectedElementId(null)
  }

  function getStickyText(): string {
    const textEl = allEls.find(e =>
      e.customData?.nodeType === 'sticky_note_text' && e.customData?.parentId === root!.id,
    )
    return textEl?.text ?? ''
  }

  function getBodyText(bodyType: string): string {
    const textEl = allEls.find(e =>
      e.customData?.nodeType === bodyType && e.groupIds?.includes(root!.groupIds?.[0]),
    )
    return textEl?.text ?? ''
  }

  return (
    <div
      className="absolute right-3 top-3 z-20 w-56 bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius)] shadow-xl flex flex-col"
      style={{ maxHeight: 'calc(100% - 24px)', overflowY: 'auto' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
        <span className="text-xs font-semibold text-[var(--text-primary)]">
          {nodeType === 'sticky_note' && '便签'}
          {nodeType === 'user_story' && '用户故事'}
          {nodeType === 'ai_card' && 'AI 卡片'}
          {nodeType === 'prd_card' && 'PRD 章节'}
          {nodeType === 'file_card' && '文件卡'}
          {nodeType === 'frame' && '分区框'}
          {nodeType === 'mm_root' && '思维导图根节点'}
          {nodeType === 'mm_node' && '思维导图节点'}
          {(!nodeType || !['sticky_note','user_story','ai_card','prd_card','file_card','frame','mm_root','mm_node'].includes(nodeType)) && '元素属性'}
        </span>
        <button
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          onClick={() => setSelectedElementId(null)}
        >
          <X size={12} />
        </button>
      </div>

      {/* Type-specific controls */}
      <div className="flex flex-col gap-3 p-3">

        {/* ── Sticky Note ─────────────────────────────────────────── */}
        {nodeType === 'sticky_note' && (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">颜色</span>
              <div className="flex gap-1.5">
                {Object.entries(STICKY_COLORS).map(([key, c]) => (
                  <button
                    key={key}
                    title={key}
                    className={clsx(
                      'w-6 h-6 rounded-full border-2 transition-transform hover:scale-110',
                      root.customData?.color === key ? 'border-[var(--accent)] scale-110' : 'border-transparent',
                    )}
                    style={{ background: c.bg }}
                    onClick={() => {
                      updateCustomData(root.id, { color: key })
                      // Update rect colors
                      const updated = allEls.map(el => {
                        if (el.id === root.id) return { ...el, backgroundColor: c.bg, strokeColor: c.stroke, updated: Date.now() }
                        if (el.customData?.nodeType === 'sticky_note_text' && el.customData?.parentId === root.id) {
                          return { ...el, strokeColor: c.text, updated: Date.now() }
                        }
                        return el
                      })
                      api!.updateScene({ elements: updated as never[] })
                      forceUpdate(n => n + 1)
                    }}
                  />
                ))}
              </div>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">内容</span>
              <textarea
                className="text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded p-1.5 resize-none text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                rows={4}
                value={getStickyText()}
                onChange={e => updateText(root.id, e.target.value)}
              />
            </label>
          </>
        )}

        {/* ── AI Card body ─────────────────────────────────────────── */}
        {nodeType === 'ai_card' && (
          <button
            className="text-xs px-2 py-1.5 rounded-[var(--radius-sm)] border border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors"
            onClick={() => {
              const gid = root.groupIds?.[0] ?? root.id
              useCanvasStore.getState().setOpenAICardId(gid)
            }}
          >
            打开内容编辑器
          </button>
        )}

        {/* ── PRD card body ────────────────────────────────────────── */}
        {nodeType === 'prd_card' && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">内容</span>
            <textarea
              className="text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded p-1.5 resize-none text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              rows={6}
              value={getBodyText('prd_card_body')}
              onChange={e => {
                const bodyType = 'prd_card_body'
                const textEl = allEls.find(el =>
                  el.customData?.nodeType === bodyType && el.groupIds?.includes(root.groupIds?.[0]),
                )
                if (textEl) {
                  api!.updateScene({ elements: allEls.map(el => el.id === textEl.id ? { ...el, text: e.target.value, originalText: e.target.value, updated: Date.now() } : el) as never[] })
                  forceUpdate(n => n + 1)
                }
              }}
            />
          </label>
        )}

        {/* ── Frame title ──────────────────────────────────────────── */}
        {nodeType === 'frame' && (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase tracking-wide">标题</span>
            <input
              className="text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
              value={root.name ?? ''}
              onChange={e => {
                const updated = allEls.map(el => el.id === root.id ? { ...el, name: e.target.value, updated: Date.now() } : el)
                api!.updateScene({ elements: updated as never[] })
                forceUpdate(n => n + 1)
              }}
            />
          </label>
        )}

        {/* ── Position / size ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-2 text-[10px] text-[var(--text-tertiary)]">
          <div>X: <span className="text-[var(--text-secondary)]">{Math.round(root.x)}</span></div>
          <div>Y: <span className="text-[var(--text-secondary)]">{Math.round(root.y)}</span></div>
          {root.width != null && <div>W: <span className="text-[var(--text-secondary)]">{Math.round(root.width)}</span></div>}
          {root.height != null && <div>H: <span className="text-[var(--text-secondary)]">{Math.round(root.height)}</span></div>}
        </div>
      </div>

      {/* Delete */}
      <div className="px-3 pb-3">
        <button
          className="w-full flex items-center justify-center gap-1.5 text-xs text-red-400 hover:text-red-500 border border-red-200 hover:border-red-400 rounded py-1.5 transition-colors"
          onClick={deleteElement}
        >
          <Trash2 size={12} /> 删除元素
        </button>
      </div>
    </div>
  )
}
