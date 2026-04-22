/**
 * useDarkMode — reactive boolean that follows the OS color scheme and any
 * `dark` class manually placed on <html>. Used by Canvas/Markdown editor to
 * pick matching internal themes.
 */
import { useEffect, useState } from 'react'

function compute(): boolean {
  if (typeof window === 'undefined') return false
  if (document.documentElement.classList.contains('dark')) return true
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
}

export function useDarkMode(): boolean {
  const [dark, setDark] = useState<boolean>(compute)

  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const update = () => setDark(compute())
    mql.addEventListener?.('change', update)
    const obs = new MutationObserver(update)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => {
      mql.removeEventListener?.('change', update)
      obs.disconnect()
    }
  }, [])

  return dark
}
