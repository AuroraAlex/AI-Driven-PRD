/**
 * SessionSwitcher.tsx — Generic dropdown for switching between sessions of a
 * given kind (canvas / chat). Provides "new", "rename" and "archive" actions.
 *
 * Persists the active session id via the session store and uses React Query
 * to fetch / mutate the session list through the supplied API.
 */
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus, Pencil, Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import {
  canvasSessionsApi,
  chatSessionsApi,
  type CanvasSession,
  type ChatSession,
} from '../../api/client'
import { useSessionStore } from '../../store/sessionStore'

export type SessionKind = 'canvas' | 'chat'
type AnySession = CanvasSession | ChatSession

interface Props {
  projectId: string
  kind: SessionKind
  /** Optional click hook. Called after the active id has been updated. */
  onChange?: (sessionId: string) => void
  className?: string
}

const apiFor = (kind: SessionKind) => (kind === 'canvas' ? canvasSessionsApi : chatSessionsApi)

const labelFor = (kind: SessionKind) => (kind === 'canvas' ? '画布' : '对话')

export default function SessionSwitcher({ projectId, kind, onChange, className }: Props) {
  const qc = useQueryClient()
  const api = apiFor(kind)
  const queryKey = [`${kind}-sessions`, projectId] as const

  const { data: sessions = [], isFetched } = useQuery<AnySession[]>({
    queryKey,
    queryFn: () => api.list(projectId) as Promise<AnySession[]>,
  })

  const sessionStore = useSessionStore()
  const activeId = kind === 'canvas'
    ? sessionStore.getCanvasSessionId(projectId)
    : sessionStore.getChatSessionId(projectId)

  const setActiveId = (id: string | null) => {
    if (kind === 'canvas') sessionStore.setCanvasSessionId(projectId, id)
    else sessionStore.setChatSessionId(projectId, id)
  }

  // Guard against double auto-create (StrictMode double-effect, refetch races)
  const autoCreateInFlight = useRef(false)

  // Auto-select first active session, or auto-create one if none exist
  useEffect(() => {
    if (!isFetched) return
    if (activeId && sessions.find(s => s.id === activeId)) return
    const firstActive = sessions.find(s => !s.archived_at)
    if (firstActive) {
      setActiveId(firstActive.id)
      onChange?.(firstActive.id)
      return
    }
    if (sessions.length === 0 && !autoCreateInFlight.current) {
      autoCreateInFlight.current = true
      api.create(projectId)
        .then(s => {
          qc.invalidateQueries({ queryKey })
          setActiveId(s.id)
          onChange?.(s.id)
        })
        .finally(() => { autoCreateInFlight.current = false })
    }
  }, [sessions, activeId, isFetched]) // eslint-disable-line react-hooks/exhaustive-deps

  const [open, setOpen] = useState(false)

  const createMut = useMutation({
    mutationFn: () => api.create(projectId),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey })
      setActiveId(s.id)
      onChange?.(s.id)
      setOpen(false)
    },
  })

  const renameMut = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.update(projectId, id, { title }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })

  const archiveMut = useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      api.update(projectId, id, { archived }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(projectId, id),
    onSuccess: (_d, id) => {
      qc.invalidateQueries({ queryKey })
      if (id === activeId) setActiveId(null)
    },
  })

  const active = sessions.find(s => s.id === activeId) ?? null
  const visible = sessions

  return (
    <div className={clsx('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 text-xs rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:border-[var(--accent)] transition-colors max-w-[200px]"
        title={`切换${labelFor(kind)}`}
      >
        <span className="truncate">{active?.title ?? `选择${labelFor(kind)}…`}</span>
        <ChevronDown size={12} className="shrink-0 opacity-60" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 mt-1 left-0 w-64 max-h-80 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg flex flex-col">
            {visible.length === 0 && (
              <div className="px-3 py-2 text-xs text-[var(--text-tertiary)]">暂无{labelFor(kind)}</div>
            )}
            {visible.map(s => (
              <div
                key={s.id}
                className={clsx(
                  'flex items-center gap-1 px-2 py-1.5 text-xs hover:bg-[var(--accent-light)] cursor-pointer group',
                  s.id === activeId && 'bg-[var(--accent-light)] text-[var(--accent)]',
                  s.archived_at && 'text-[var(--text-tertiary)]',
                )}
                onClick={() => {
                  setActiveId(s.id)
                  onChange?.(s.id)
                  setOpen(false)
                }}
              >
                <span className={clsx('flex-1 truncate', s.archived_at && 'line-through')}>{s.title}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--accent)]"
                  title="重命名"
                  onClick={e => {
                    e.stopPropagation()
                    const next = prompt(`重命名${labelFor(kind)}`, s.title)
                    if (next && next.trim() && next !== s.title) {
                      renameMut.mutate({ id: s.id, title: next.trim() })
                    }
                  }}
                >
                  <Pencil size={11} />
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--accent)]"
                  title={s.archived_at ? '取消归档' : '归档'}
                  onClick={e => {
                    e.stopPropagation()
                    archiveMut.mutate({ id: s.id, archived: !s.archived_at })
                  }}
                >
                  {s.archived_at ? <ArchiveRestore size={11} /> : <Archive size={11} />}
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-[var(--warning)]"
                  title="删除"
                  onClick={e => {
                    e.stopPropagation()
                    if (confirm(`确认删除${labelFor(kind)}「${s.title}」？此操作不可撤销。`)) {
                      deleteMut.mutate(s.id)
                    }
                  }}
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            <button
              className="border-t border-[var(--border)] flex items-center gap-1.5 px-3 py-2 text-xs text-[var(--accent)] hover:bg-[var(--accent-light)]"
              onClick={() => createMut.mutate()}
              disabled={createMut.isPending}
            >
              <Plus size={12} /> 新建{labelFor(kind)}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
