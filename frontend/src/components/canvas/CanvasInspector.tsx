/**
 * CanvasInspector.tsx
 *
 * Floating right panel that appears when an element is selected.
 * Shows type-specific editing controls based on customData.nodeType.
 */
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useCanvasStore } from '../../store/canvasStore'
import { STICKY_COLORS, applyResourceToCard, type CanvasEl } from './nodeInsert'
import { resourcesApi, type ResourceBlock, type ResourceKind } from '../../api/client'
import { X, Trash2, Eye, Search, FileText, FileType, Sparkles } from 'lucide-react'
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

export default function CanvasInspector({ projectId }: { projectId?: string }) {
  const { api, selectedElementId, setSelectedElementId } = useCanvasStore()
  const setOpenResourceCardId = useCanvasStore(s => s.setOpenResourceCardId)
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
          {nodeType === 'file_card' && '资源卡'}
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

        {/* ── Resource Card (file_card) ─────────────────────────── */}
        {nodeType === 'file_card' && (
          <ResourceCardControls
            projectId={projectId}
            cardEl={root}
            onPick={(res) => {
              const gid = root.groupIds?.[0]
              if (!gid) return
              const next = applyResourceToCard(allEls, gid, {
                resourceId: res.id,
                title: res.title,
                preview: res.markdown_content || res.extracted_text || '',
                kind: res.kind,
              })
              api!.updateScene({ elements: next as never[] })
              forceUpdate(n => n + 1)
            }}
            onClear={() => {
              const gid = root.groupIds?.[0]
              if (!gid) return
              const next = applyResourceToCard(allEls, gid, {
                resourceId: null, title: null, preview: null, kind: null,
              })
              api!.updateScene({ elements: next as never[] })
              forceUpdate(n => n + 1)
            }}
            onView={() => {
              const gid = root.groupIds?.[0]
              if (gid) setOpenResourceCardId(gid)
            }}
          />
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

// ── Resource card picker ────────────────────────────────────────────────────

const KIND_LABELS: Record<ResourceKind, string> = {
  file: '文件',
  document: '文档',
  snippet: '片段',
}

const KIND_ICONS: Record<ResourceKind, typeof FileText> = {
  file: FileType,
  document: FileText,
  snippet: Sparkles,
}

function ResourceCardControls({
  projectId, cardEl, onPick, onClear, onView,
}: {
  projectId?: string
  cardEl: CanvasEl
  onPick: (res: ResourceBlock) => void
  onClear: () => void
  onView: () => void
}) {
  const resourceId = (cardEl.customData?.resourceId as string | undefined) ?? null
  const [pickerOpen, setPickerOpen] = useState(!resourceId)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<ResourceKind | 'all'>('all')

  const { data: resources = [], isLoading } = useQuery({
    queryKey: ['resources', projectId, 'inspector-picker'],
    queryFn: () => resourcesApi.list(projectId!),
    enabled: !!projectId && pickerOpen,
    staleTime: 10_000,
  })

  const filtered = useMemo(() => {
    return resources.filter(r => {
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      if (search.trim()) {
        const q = search.toLowerCase()
        if (!r.title.toLowerCase().includes(q)
          && !(r.summary || '').toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [resources, kindFilter, search])

  return (
    <div className="flex flex-col gap-2">
      {resourceId ? (
        <>
          <button
            onClick={onView}
            className="flex items-center justify-center gap-1 text-xs px-2 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Eye size={12} /> 查看完整内容
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={() => setPickerOpen(v => !v)}
              className="flex-1 text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--accent-light)]"
            >
              {pickerOpen ? '收起' : '更换资源'}
            </button>
            <button
              onClick={onClear}
              className="text-xs px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-tertiary)] hover:text-[var(--warning)]"
              title="解除绑定"
            >
              解绑
            </button>
          </div>
        </>
      ) : (
        <div className="text-[11px] text-[var(--text-tertiary)]">
          选择一个资源进行绑定（双击卡片可展开查看）。
        </div>
      )}

      {pickerOpen && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2">
          <div className="flex items-center gap-1">
            <Search size={11} className="text-[var(--text-tertiary)]" />
            <input
              autoFocus
              placeholder="搜索资源…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 text-xs bg-[var(--bg-base)] border border-[var(--border)] rounded px-1.5 py-1 focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div className="flex gap-1 text-[10px]">
            {(['all', 'file', 'document', 'snippet'] as const).map(k => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className={clsx(
                  'px-1.5 py-0.5 rounded',
                  kindFilter === k
                    ? 'bg-[var(--accent)] text-white'
                    : 'bg-[var(--bg-base)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]',
                )}
              >
                {k === 'all' ? '全部' : KIND_LABELS[k]}
              </button>
            ))}
          </div>
          <div className="max-h-56 overflow-y-auto flex flex-col gap-0.5 border border-[var(--border)] rounded bg-[var(--bg-base)]">
            {isLoading && (
              <div className="text-[11px] text-[var(--text-tertiary)] px-2 py-2">加载中…</div>
            )}
            {!isLoading && filtered.length === 0 && (
              <div className="text-[11px] text-[var(--text-tertiary)] px-2 py-2">暂无资源</div>
            )}
            {filtered.map(r => {
              const Icon = KIND_ICONS[r.kind]
              const active = r.id === resourceId
              return (
                <button
                  key={r.id}
                  onClick={() => { onPick(r); setPickerOpen(false) }}
                  className={clsx(
                    'flex items-start gap-1.5 px-2 py-1.5 text-left text-[11px] hover:bg-[var(--accent-light)]',
                    active && 'bg-[var(--accent-light)]',
                  )}
                >
                  <Icon size={11} className="mt-0.5 text-[var(--text-tertiary)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[var(--text-primary)]">{r.title}</div>
                    {r.summary && (
                      <div className="truncate text-[10px] text-[var(--text-tertiary)]">{r.summary}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
