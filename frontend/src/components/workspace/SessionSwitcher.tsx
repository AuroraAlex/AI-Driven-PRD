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
  const [renameTarget, setRenameTarget] = useState<{ id: string; title: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null)

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
          <div className="absolute z-40 mt-1 right-0 w-72 max-h-80 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg flex flex-col">
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
                <span className={clsx('flex-1 min-w-0 truncate', s.archived_at && 'line-through')}>{s.title}</span>
                <button
                  className="shrink-0 p-1 text-[var(--text-tertiary)] hover:text-[var(--accent)]"
                  title="重命名"
                  onClick={e => {
                    e.stopPropagation()
                    setRenameTarget({ id: s.id, title: s.title })
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="shrink-0 p-1 text-[var(--text-tertiary)] hover:text-[var(--accent)]"
                  title={s.archived_at ? '取消归档' : '归档'}
                  onClick={e => {
                    e.stopPropagation()
                    archiveMut.mutate({ id: s.id, archived: !s.archived_at })
                  }}
                >
                  {s.archived_at ? <ArchiveRestore size={12} /> : <Archive size={12} />}
                </button>
                <button
                  className="shrink-0 p-1 text-[var(--text-tertiary)] hover:text-[var(--warning)]"
                  title="删除"
                  onClick={e => {
                    e.stopPropagation()
                    setDeleteTarget({ id: s.id, title: s.title })
                  }}
                >
                  <Trash2 size={12} />
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

      {renameTarget && (
        <RenamePrompt
          title={`重命名${labelFor(kind)}`}
          initial={renameTarget.title}
          onCancel={() => setRenameTarget(null)}
          onConfirm={(next) => {
            const id = renameTarget.id
            const original = renameTarget.title
            setRenameTarget(null)
            if (next.trim() && next.trim() !== original) {
              renameMut.mutate({ id, title: next.trim() })
            }
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmPrompt
          message={`确认删除${labelFor(kind)}「${deleteTarget.title}」？此操作不可撤销。`}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const id = deleteTarget.id
            setDeleteTarget(null)
            deleteMut.mutate(id)
          }}
        />
      )}
    </div>
  )
}

function RenamePrompt({
  title, initial, onCancel, onConfirm,
}: {
  title: string
  initial: string
  onCancel: () => void
  onConfirm: (next: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onCancel}>
      <div
        className="bg-[var(--bg-base)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-xl w-[min(420px,90vw)] p-4 flex flex-col gap-3"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-[var(--text-primary)]">{title}</div>
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onConfirm(value)
            else if (e.key === 'Escape') onCancel()
          }}
          className="w-full border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            onClick={onCancel}
          >取消</button>
          <button
            className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
            onClick={() => onConfirm(value)}
            disabled={!value.trim()}
          >保存</button>
        </div>
      </div>
    </div>
  )
}

function ConfirmPrompt({
  message, onCancel, onConfirm,
}: {
  message: string
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onCancel}>
      <div
        className="bg-[var(--bg-base)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-xl w-[min(380px,90vw)] p-4 flex flex-col gap-3"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="text-sm text-[var(--text-primary)]">{message}</div>
        <div className="flex justify-end gap-2">
          <button
            className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
            onClick={onCancel}
          >取消</button>
          <button
            className="text-xs px-3 py-1.5 rounded-[var(--radius-sm)] bg-[var(--warning)] text-white hover:opacity-90"
            onClick={onConfirm}
          >删除</button>
        </div>
      </div>
    </div>
  )
}
