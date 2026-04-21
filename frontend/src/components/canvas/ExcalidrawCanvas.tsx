import { useEffect, useRef, useState, useCallback } from 'react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types/types'
import { canvasApi } from '../../api/client'
import { useCanvasStore } from '../../store/canvasStore'
import {
  createStickyNote,
  createUserStoryCard,
  createAICard,
  createPRDCard,
  createFileCard,
  createFrame,
  type CanvasEl,
} from './nodeInsert'
import { addChildNode, addSiblingNode, deleteNode } from './mindMap'

// Lazy-load Excalidraw to avoid SSR issues and reduce initial bundle
let ExcalidrawComponent: typeof import('@excalidraw/excalidraw').Excalidraw | null = null

function useExcalidraw() {
  const [Comp, setComp] = useState<typeof ExcalidrawComponent>(null)
  useEffect(() => {
    if (ExcalidrawComponent) { setComp(() => ExcalidrawComponent); return }
    import('@excalidraw/excalidraw').then(m => {
      ExcalidrawComponent = m.Excalidraw
      setComp(() => m.Excalidraw)
    })
  }, [])
  return Comp
}

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface Props {
  projectId: string
}

/** Convert pointer event coords to Excalidraw scene coordinates. */
function toSceneCoords(
  e: React.PointerEvent,
  api: ExcalidrawImperativeAPI,
): { x: number; y: number } {
  const appState = api.getAppState()
  const zoom = typeof appState.zoom === 'object'
    ? (appState.zoom as { value: number }).value
    : (appState.zoom as number)
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  return {
    x: (e.clientX - rect.left - appState.scrollX) / zoom,
    y: (e.clientY - rect.top  - appState.scrollY) / zoom,
  }
}

export default function ExcalidrawCanvas({ projectId }: Props) {
  const Excalidraw = useExcalidraw()
  const [excalidrawAPI, setExcalidrawAPI] = useState<ExcalidrawImperativeAPI | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initialized = useRef(false)
  const lastSavedElementsJson = useRef<string>('[]')
  const isRestoring = useRef(false)
  const lastMinimapBump = useRef(0)
  const lastSelectedId = useRef<string | null>(null)

  // Stable API callback — must not change identity across renders, or Excalidraw
  // will treat it as a new prop and re-trigger its internal effects → infinite loop.
  const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
    setExcalidrawAPI(api)
    useCanvasStore.getState().setApi(api)
  }, [])

  // Clean up timers on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (savedTimer.current) clearTimeout(savedTimer.current)
    }
  }, [])

  // Load saved canvas — reset initialized when projectId changes
  useEffect(() => {
    if (!excalidrawAPI || initialized.current) return
    initialized.current = true
    isRestoring.current = true

    canvasApi.get(projectId).then(canvas => {
      if (!canvas) { isRestoring.current = false; return }
      try {
        const elements = JSON.parse(canvas.elements_json || '[]')
        const appState = JSON.parse(canvas.app_state_json || '{}')
        const files = JSON.parse(canvas.files_json || '{}')
        lastSavedElementsJson.current = canvas.elements_json || '[]'
        excalidrawAPI.updateScene({ elements, appState, files })
      } catch (_) { /* ignore parse errors */ }
      isRestoring.current = false
    }).catch(() => {
      initialized.current = false
      isRestoring.current = false
      setSaveStatus('error')
    })

    return () => { initialized.current = false }
  }, [excalidrawAPI, projectId])

  // Auto-save with debounce — only when elements actually changed
  const handleChange = useCallback(() => {
    if (!excalidrawAPI || isRestoring.current) return

    const currentElementsJson = JSON.stringify(excalidrawAPI.getSceneElements())
    if (currentElementsJson === lastSavedElementsJson.current) return

    // Bump minimap change counter — throttled to avoid render storms
    const now = Date.now()
    if (now - lastMinimapBump.current > 500) {
      lastMinimapBump.current = now
      useCanvasStore.getState().bumpChangeCount()
    }

    if (saveTimer.current) clearTimeout(saveTimer.current)
    setSaveStatus('saving')

    saveTimer.current = setTimeout(() => {
      const elements = excalidrawAPI.getSceneElements()
      const elementsJson = JSON.stringify(elements)
      const appState = excalidrawAPI.getAppState()

      canvasApi.save(projectId, {
        elements_json: elementsJson,
        app_state_json: JSON.stringify({
          viewBackgroundColor: appState.viewBackgroundColor,
          zoom: appState.zoom,
          scrollX: appState.scrollX,
          scrollY: appState.scrollY,
        }),
        files_json: JSON.stringify(excalidrawAPI.getFiles()),
      }).then(() => {
        lastSavedElementsJson.current = elementsJson
        setSaveStatus('saved')
        if (savedTimer.current) clearTimeout(savedTimer.current)
        savedTimer.current = setTimeout(() => setSaveStatus('idle'), 2000)
      }).catch(() => {
        setSaveStatus('error')
      })
    }, 1500)
  }, [excalidrawAPI, projectId])

  // Update inspector when selection changes — only when it actually changes
  const handlePointerUp = useCallback(() => {
    if (!excalidrawAPI) return
    const appState = excalidrawAPI.getAppState()
    const selectedIds = Object.keys((appState as Record<string, unknown>).selectedElementIds as Record<string, boolean> ?? {})
    const next = selectedIds[0] ?? null
    if (next === lastSelectedId.current) return
    lastSelectedId.current = next
    useCanvasStore.getState().setSelectedElementId(next)
  }, [excalidrawAPI])

  // Insert custom card on pointer down when a pendingTool is active
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!excalidrawAPI) return
    const { pendingTool, setPendingTool } = useCanvasStore.getState()
    if (!pendingTool) return

    // Ignore if Excalidraw's own toolbar/UI is the target
    const target = e.target as HTMLElement
    if (target.closest('.excalidraw-container [class*="ToolIcon"]')) return
    if (target.closest('.excalidraw__canvas') === null) return

    const { x, y } = toSceneCoords(e, excalidrawAPI)
    let newEls: CanvasEl[] = []

    if (pendingTool.startsWith('sticky_')) {
      const color = pendingTool.replace('sticky_', '')
      newEls = createStickyNote(x, y, color)
    } else if (pendingTool === 'user_story') {
      newEls = createUserStoryCard(x, y)
    } else if (pendingTool === 'ai_card') {
      newEls = createAICard(x, y)
    } else if (pendingTool === 'prd_card') {
      newEls = createPRDCard(x, y)
    } else if (pendingTool === 'file_card') {
      newEls = createFileCard(x, y)
    } else if (pendingTool === 'frame') {
      newEls = createFrame(x, y)
    }

    if (newEls.length) {
      excalidrawAPI.updateScene({
        elements: [...(excalidrawAPI.getSceneElements() as unknown as CanvasEl[]), ...newEls] as never[],
      })
      setPendingTool(null)
      e.preventDefault()
      e.stopPropagation()
    }
  }, [excalidrawAPI]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mind map keyboard shortcuts: Tab = add child, Enter = add sibling, Delete = delete node
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const { mindMapMode, selectedElementId, api } = useCanvasStore.getState()
      if (!mindMapMode || !api || !selectedElementId) return
      if (e.key === 'Tab') {
        e.preventDefault()
        addChildNode(api, selectedElementId)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        addSiblingNode(api, selectedElementId)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        deleteNode(api, selectedElementId)
        useCanvasStore.getState().setSelectedElementId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!Excalidraw) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)] text-sm">
        Loading canvas…
      </div>
    )
  }

  const statusLabel: Record<SaveStatus, string | null> = {
    idle: null,
    saving: '保存中…',
    saved: '已保存',
    error: '保存失败',
  }
  const statusColor: Record<SaveStatus, string> = {
    idle: '',
    saving: 'text-[var(--text-secondary)]',
    saved: 'text-green-500',
    error: 'text-red-500',
  }

  return (
    <div
      style={{ width: '100%', height: '100%', position: 'relative' }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
    >
      <Excalidraw
        excalidrawAPI={handleApi}
        onChange={handleChange}
        langCode="zh-CN"
        UIOptions={{ canvasActions: { saveToActiveFile: false, loadScene: false } }}
      />
      {saveStatus !== 'idle' && (
        <div
          className={`absolute top-2 right-2 text-xs px-2 py-1 rounded bg-[var(--bg-surface)] shadow ${statusColor[saveStatus]}`}
          style={{ zIndex: 10 }}
        >
          {statusLabel[saveStatus]}
        </div>
      )}
    </div>
  )
}
