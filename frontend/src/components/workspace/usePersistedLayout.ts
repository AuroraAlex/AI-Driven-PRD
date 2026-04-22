/**
 * usePersistedLayout — small helper that persists a react-resizable-panels v4
 * Layout map (`{ panelId: number }`) to localStorage.
 *
 * v4 removed the `autoSaveId` prop, so callers must provide a stable storage
 * key and wire `defaultLayout` + `onLayoutChanged` themselves. This hook
 * encapsulates the JSON parse/stringify dance.
 */
import { useCallback, useMemo } from 'react'

export type Layout = { [id: string]: number }

export function usePersistedLayout(key: string) {
  const defaultLayout = useMemo<Layout | undefined>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (!raw) return undefined
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? (parsed as Layout) : undefined
    } catch {
      return undefined
    }
  }, [key])

  const onLayoutChanged = useCallback(
    (layout: Layout) => {
      try {
        localStorage.setItem(key, JSON.stringify(layout))
      } catch {
        /* ignore quota errors */
      }
    },
    [key],
  )

  return { defaultLayout, onLayoutChanged }
}
