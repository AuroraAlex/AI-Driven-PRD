/**
 * CanvasMinimap.tsx
 *
 * A small overview map in the bottom-right corner of the canvas area.
 * Redraws whenever canvasStore.changeCount increments.
 * Click to navigate to a canvas region.
 */
import { useEffect, useRef } from 'react'
import { useCanvasStore } from '../../store/canvasStore'

const MAP_W = 160
const MAP_H = 90
const PADDING = 20

export default function CanvasMinimap() {
  const { api, changeCount } = useCanvasStore()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!api || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return

    const els = api.getSceneElements().filter(e => !e.isDeleted)
    if (els.length === 0) {
      ctx.clearRect(0, 0, MAP_W, MAP_H)
      return
    }

    // Compute bounding box of all elements
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of els) {
      if ('x' in el && 'y' in el && 'width' in el && 'height' in el) {
        const x = el.x as number, y = el.y as number, w = el.width as number, h = el.height as number
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x + w > maxX) maxX = x + w
        if (y + h > maxY) maxY = y + h
      }
    }

    const bw = maxX - minX + PADDING * 2
    const bh = maxY - minY + PADDING * 2
    const scale = Math.min(MAP_W / bw, MAP_H / bh)
    const offsetX = (MAP_W - bw * scale) / 2 - (minX - PADDING) * scale
    const offsetY = (MAP_H - bh * scale) / 2 - (minY - PADDING) * scale

    ctx.clearRect(0, 0, MAP_W, MAP_H)

    // Draw each element as a coloured rect dot
    for (const el of els) {
      if (!('x' in el && 'y' in el && 'width' in el && 'height' in el)) continue
      const ex = el.x as number, ey = el.y as number, ew = el.width as number, eh = el.height as number
      const fill = (el as Record<string, unknown>).backgroundColor as string | undefined
      ctx.fillStyle = (fill && fill !== 'transparent') ? fill : '#adb5bd'
      ctx.fillRect(
        ex * scale + offsetX,
        ey * scale + offsetY,
        Math.max(ew * scale, 2),
        Math.max(eh * scale, 2),
      )
    }

    // Draw viewport indicator
    const appState = api.getAppState()
    const zoom = typeof appState.zoom === 'object'
      ? (appState.zoom as { value: number }).value
      : (appState.zoom as number)
    const vpW = window.innerWidth / zoom
    const vpH = window.innerHeight / zoom
    const vpX = -appState.scrollX / zoom
    const vpY = -appState.scrollY / zoom
    ctx.strokeStyle = '#339af0'
    ctx.lineWidth = 1.5
    ctx.strokeRect(
      vpX * scale + offsetX,
      vpY * scale + offsetY,
      vpW * scale,
      vpH * scale,
    )
  }, [api, changeCount])

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!api) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    const els = api.getSceneElements().filter(e => !e.isDeleted)
    if (els.length === 0) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const el of els) {
      if ('x' in el && 'y' in el && 'width' in el && 'height' in el) {
        const x = el.x as number, y = el.y as number, w = el.width as number, h = el.height as number
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x + w > maxX) maxX = x + w
        if (y + h > maxY) maxY = y + h
      }
    }

    const bw = maxX - minX + PADDING * 2
    const bh = maxY - minY + PADDING * 2
    const scale = Math.min(MAP_W / bw, MAP_H / bh)
    const offsetX = (MAP_W - bw * scale) / 2 - (minX - PADDING) * scale
    const offsetY = (MAP_H - bh * scale) / 2 - (minY - PADDING) * scale

    const canvasX = (mx - offsetX) / scale
    const canvasY = (my - offsetY) / scale

    const appState = api.getAppState()
    const zoom = typeof appState.zoom === 'object'
      ? (appState.zoom as { value: number }).value
      : (appState.zoom as number)

    api.updateScene({
      appState: {
        ...appState,
        scrollX: -canvasX * zoom + window.innerWidth / 2,
        scrollY: -canvasY * zoom + window.innerHeight / 2,
      },
    })
  }

  if (!api) return null

  return (
    <div
      className="absolute bottom-4 right-4 z-10 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg overflow-hidden cursor-crosshair"
      title="小地图 — 点击跳转"
    >
      <canvas
        ref={canvasRef}
        width={MAP_W}
        height={MAP_H}
        onClick={handleClick}
        style={{ display: 'block' }}
      />
    </div>
  )
}
