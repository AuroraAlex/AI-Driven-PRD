/**
 * WorkspaceContext
 *
 * Shared state for the redesigned workspace shell:
 *   - face: which side of the center card is showing (canvas | markdown)
 *   - editingResourceId: which ResourceBlock is open in the center Markdown face
 *   - markdownEditorRef: imperative handle exposed by the center MarkdownEditor
 *     (used by left-column tools to insert snippets / read outline).
 *
 * Lives at the WorkspaceShell level so LeftColumn / CenterFlipCard /
 * ResourcePanel can read & update it without prop drilling.
 */
import { createContext, useContext, useState, useCallback, useRef } from 'react'
import type { ReactNode } from 'react'

export type CenterFace = 'canvas' | 'markdown'

export interface MarkdownEditorHandle {
  /** Current document text. */
  getValue: () => string
  /** Insert text at the current cursor position and focus the editor. */
  insertAtCursor: (text: string) => void
  /** Scroll the editor to the given line (1-based). */
  scrollToLine: (line: number) => void
}

interface WorkspaceContextValue {
  face: CenterFace
  setFace: (f: CenterFace) => void
  toggleFace: () => void

  /** Resource (document/snippet) currently bound to the center Markdown face. */
  editingResourceId: string | null
  setEditingResourceId: (id: string | null) => void

  /** Editor imperative handle — set by the center editor on mount. */
  markdownEditorRef: React.MutableRefObject<MarkdownEditorHandle | null>
}

const Ctx = createContext<WorkspaceContextValue | null>(null)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [face, setFaceState] = useState<CenterFace>(() => {
    const u = new URLSearchParams(window.location.search)
    return u.get('face') === 'markdown' ? 'markdown' : 'canvas'
  })
  const [editingResourceId, setEditingResourceId] = useState<string | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorHandle | null>(null)

  const setFace = useCallback((f: CenterFace) => {
    setFaceState(f)
    const u = new URL(window.location.href)
    u.searchParams.set('face', f)
    window.history.replaceState(null, '', u.toString())
  }, [])

  const toggleFace = useCallback(() => {
    setFace(face === 'canvas' ? 'markdown' : 'canvas')
  }, [face, setFace])

  return (
    <Ctx.Provider
      value={{
        face,
        setFace,
        toggleFace,
        editingResourceId,
        setEditingResourceId,
        markdownEditorRef,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}

export function useWorkspace() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return v
}
