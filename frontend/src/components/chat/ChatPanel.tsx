import { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Send, Bot, User, Settings, Database, LayoutTemplate,
  Square, RotateCcw, Pencil, Trash2, Copy, Check, ChevronDown, ChevronRight, ChevronUp, Sliders,
} from 'lucide-react'
import clsx from 'clsx'
import { canvasApi, canvasSessionsApi, chatApi, settingsApi, type ChatMessage, type ChatMessageMeta } from '../../api/client'
import { useChatStore } from '../../store/chatStore'
import { Button, Spinner } from '../ui'
import SettingsModal from '../ui/SettingsModal'
import CustomModelModal from './CustomModelModal'
import MarkdownMessage from './MarkdownMessage'
import { buildCanvasContext, estimateTokens } from '../canvas/extractCanvasContext'

const RAG_MODES = ['hybrid', 'local', 'global', 'naive']
const CUSTOM_VALUE = '__custom__'
const SUMMARY_SUGGEST_THRESHOLD = 4000

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  dashscope: '阿里云百炼',
}

interface Props {
  projectId: string
  chatSessionId: string
  /** Default canvas session id to suggest as included context. */
  currentCanvasSessionId?: string | null
}

export default function ChatPanel({ projectId, chatSessionId, currentCanvasSessionId }: Props) {
  const {
    messages, streaming, streamBuffer,
    provider, model, customModels, ragEnabled, ragMode,
    setMessages, addMessage, setStreaming, appendToken, clearBuffer,
    setProvider, setModel, setCustomModel, setRagEnabled, setRagMode,
    getPrefs, updatePrefs,
  } = useChatStore()
  const prefs = getPrefs(chatSessionId)
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const [showCanvasPicker, setShowCanvasPicker] = useState(false)
  const [estimatedTokens, setEstimatedTokens] = useState(0)
  const [editTarget, setEditTarget] = useState<{ id: string; content: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const qc = useQueryClient()

  // Auto-include current canvas session if no selection yet
  useEffect(() => {
    if (currentCanvasSessionId && prefs.canvasSessionIds.length === 0 && prefs.includeCanvasContext) {
      updatePrefs(chatSessionId, { canvasSessionIds: [currentCanvasSessionId] })
    }
  }, [chatSessionId, currentCanvasSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch available models based on configured API keys
  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['available-models'],
    queryFn: settingsApi.models,
    staleTime: 30_000,
  })

  // Group preset models by provider
  const modelsByProvider = useMemo(() => {
    const map: Record<string, { label: string; value: string }[]> = {}
    for (const m of models) {
      if (!map[m.provider]) map[m.provider] = []
      map[m.provider].push({ label: m.label, value: m.value })
    }
    return map
  }, [models])

  const availableProviders = useMemo(
    () => Object.keys(modelsByProvider),
    [modelsByProvider],
  )

  // Keep provider/model in sync with the available list.
  useEffect(() => {
    if (availableProviders.length === 0) return
    // Auto-pick provider if none set or current one vanished
    let p = provider
    if (!availableProviders.includes(p)) {
      p = availableProviders[0]
      setProvider(p)
    }
    const presets = modelsByProvider[p] || []
    const custom = customModels[p]
    const validValues = new Set([...presets.map(m => m.value), custom].filter(Boolean) as string[])
    if (!validValues.has(model)) {
      setModel(presets[0]?.value || custom || '')
    }
  }, [availableProviders, provider, customModels])

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  // Clear cross-session leakage from the global Zustand `messages` slice when
  // switching to a different chat session — otherwise the previous session's
  // bubbles linger until the new history finishes loading, AND any
  // edit/delete fired against those bubbles 404s because the message
  // doesn't belong to the active session.
  useEffect(() => {
    setMessages([])
    clearBuffer()
  }, [chatSessionId, setMessages, clearBuffer])

  // Load history on mount and sync into the Zustand store whenever it changes.
  // (React Query v5 removed `onSuccess`, so we sync via effect instead.)
  const { data: historyData } = useQuery({
    queryKey: ['chat-history', projectId, chatSessionId],
    queryFn: () => chatApi.history(projectId, chatSessionId),
    enabled: !!chatSessionId,
  })
  useEffect(() => {
    if (historyData) setMessages(historyData)
  }, [historyData, setMessages])

  // List canvas sessions for the picker
  const { data: canvasSessions = [] } = useQuery({
    queryKey: ['canvas-sessions', projectId],
    queryFn: () => canvasSessionsApi.list(projectId),
  })

  // Estimate tokens of selected canvas context (whenever selection / mode changes)
  useEffect(() => {
    let cancelled = false
    if (!prefs.includeCanvasContext || prefs.canvasSessionIds.length === 0) {
      setEstimatedTokens(0)
      return
    }
    Promise.all(
      prefs.canvasSessionIds.map(async sid => {
        const cv = await canvasApi.get(projectId, sid).catch(() => null)
        const title = canvasSessions.find(s => s.id === sid)?.title ?? sid
        return { sessionId: sid, title, elementsJson: cv?.elements_json ?? '[]' }
      }),
    ).then(inputs => {
      if (cancelled) return
      const text = buildCanvasContext(inputs, prefs.canvasContextMode)
      setEstimatedTokens(estimateTokens(text))
    })
    return () => { cancelled = true }
  }, [projectId, prefs.includeCanvasContext, prefs.canvasContextMode, prefs.canvasSessionIds.join(','), canvasSessions]) // eslint-disable-line react-hooks/exhaustive-deps

  const presets = modelsByProvider[provider] || []
  const currentCustom = customModels[provider] || ''

  function handleProviderChange(next: string) {
    setProvider(next)
    const nextPresets = modelsByProvider[next] || []
    const nextCustom = customModels[next]
    setModel(nextPresets[0]?.value || nextCustom || '')
  }

  function handleModelChange(val: string) {
    if (val === CUSTOM_VALUE) {
      setShowCustomModal(true)
      return
    }
    setModel(val)
  }

  function handleCustomConfirm(fullId: string) {
    setCustomModel(provider, fullId)
    setModel(fullId)
    setShowCustomModal(false)
  }

  async function runStream(
    streamFactory: (signal: AbortSignal) => Promise<Response>,
  ) {
    setStreaming(true)
    clearBuffer()
    const ac = new AbortController()
    abortRef.current = ac

    let aborted = false
    const meta: ChatMessageMeta = {}
    const ragSources: NonNullable<ChatMessageMeta['rag_sources']> = []

    const cleanup = () => {
      if (ragSources.length > 0) meta.rag_sources = ragSources
      if (aborted) meta.stopped = true
      abortRef.current = null
      // 1) Flip the Send button back FIRST in its own commit so it's never
      //    batched with the message-push render below (React 19 will
      //    otherwise sometimes leave the button visually stuck on Stop).
      flushSync(() => {
        setStreaming(false)
      })
      // 2) Push the assistant bubble locally for instant feedback (the real
      //    DB row will replace it via the history refetch below — that gives
      //    us the real id so edit/delete work).
      const finalContent = useChatStore.getState().streamBuffer
      if (finalContent.trim().length > 0) {
        useChatStore.getState().setMessages([
          ...useChatStore.getState().messages,
          {
            id: `__local_${crypto.randomUUID()}`,
            role: 'assistant',
            content: finalContent,
            model_used: model,
            trace_id: null,
            meta: Object.keys(meta).length ? meta : null,
            created_at: new Date().toISOString(),
          },
        ])
      }
      clearBuffer()
      qc.invalidateQueries({ queryKey: ['chat-history', projectId, chatSessionId] })
    }

    try {
      const res = await streamFactory(ac.signal)
      if (!res.body) throw new Error('No body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'token') {
              appendToken(evt.data)
            } else if (evt.type === 'rag_hit' && evt.data) {
              ragSources.push({ mode: evt.data.mode ?? null, context: evt.data.context ?? '' })
            } else if (evt.type === 'done' && evt.data?.usage) {
              meta.usage = evt.data.usage
            } else if (evt.type === 'aborted') {
              aborted = true
            } else if (evt.type === 'error') {
              console.warn('chat error event', evt.data)
            }
          } catch (_) { /* skip malformed frames */ }
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') aborted = true
      else console.error('Chat stream error', err)
    } finally {
      cleanup()
    }
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming || !model) return
    setInput('')

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      model_used: model,
      trace_id: null,
      meta: null,
      created_at: new Date().toISOString(),
    }
    addMessage(userMsg)

    await runStream(signal => chatApi.stream(projectId, chatSessionId, {
      message: text,
      model,
      ragMode,
      ragEnabled,
      includeCanvasContext: prefs.includeCanvasContext,
      canvasContextMode: prefs.canvasContextMode,
      canvasSessionIds: prefs.canvasSessionIds,
    }, signal))
  }

  function handleStop() {
    abortRef.current?.abort()
  }

  async function handleRegenerate(userMessageId: string, content: string) {
    if (streaming || !model) return
    // Optimistically drop everything after the anchor in local state
    const idx = messages.findIndex(m => m.id === userMessageId)
    if (idx >= 0) useChatStore.getState().setMessages(messages.slice(0, idx + 1))
    await runStream(signal => chatApi.regenerate(projectId, chatSessionId, userMessageId, {
      message: content,
      model,
      ragMode,
      ragEnabled,
      includeCanvasContext: prefs.includeCanvasContext,
      canvasContextMode: prefs.canvasContextMode,
      canvasSessionIds: prefs.canvasSessionIds,
    }, signal))
  }

  async function handleEdit(messageId: string, currentContent: string) {
    setEditTarget({ id: messageId, content: currentContent })
  }

  async function commitEdit(next: string) {
    if (!editTarget) return
    const { id } = editTarget
    setEditTarget(null)
    if (next.trim() === editTarget.content.trim()) return
    if (id.startsWith('__local_')) {
      alert('该消息尚未持久化，无法编辑（请稍候片刻让历史同步后再试）。')
      return
    }
    try {
      await chatApi.editMessage(projectId, chatSessionId, id, next)
      useChatStore.getState().setMessages(
        useChatStore.getState().messages.map(m =>
          m.id === id ? { ...m, content: next, meta: { ...(m.meta ?? {}), edited_at: new Date().toISOString() } } : m,
        ),
      )
      qc.invalidateQueries({ queryKey: ['chat-history', projectId, chatSessionId] })
    } catch (err: any) {
      console.error(err)
      alert('编辑失败：' + (err?.response?.data?.detail || err?.message || '未知错误，请确认后端已重启加载新接口。'))
    }
  }

  async function handleDelete(messageId: string) {
    setConfirmDelete(messageId)
  }

  async function commitDelete() {
    const id = confirmDelete
    if (!id) return
    setConfirmDelete(null)
    // Local-only optimistic message (not yet refetched from DB) — just drop it.
    if (id.startsWith('__local_')) {
      useChatStore.getState().setMessages(
        useChatStore.getState().messages.filter(m => m.id !== id),
      )
      return
    }
    try {
      await chatApi.deleteMessage(projectId, chatSessionId, id)
      useChatStore.getState().setMessages(
        useChatStore.getState().messages.filter(m => m.id !== id),
      )
      qc.invalidateQueries({ queryKey: ['chat-history', projectId, chatSessionId] })
    } catch (err: any) {
      console.error(err)
      alert('删除失败：' + (err?.response?.data?.detail || err?.message || '未知错误，请确认后端已重启加载新接口。'))
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0 h-full">
      {showSettings && (
        <SettingsModal
          onClose={() => {
            setShowSettings(false)
            qc.invalidateQueries({ queryKey: ['available-models'] })
          }}
        />
      )}
      {showCustomModal && (
        <CustomModelModal
          provider={provider}
          providerLabel={PROVIDER_LABELS[provider] || provider}
          initialValue={currentCustom}
          onClose={() => setShowCustomModal(false)}
          onConfirm={handleCustomConfirm}
        />
      )}
      {editTarget && (
        <EditMessageModal
          initial={editTarget.content}
          onCancel={() => setEditTarget(null)}
          onConfirm={commitEdit}
        />
      )}
      {confirmDelete && (
        <ConfirmModal
          message="确认删除该消息？此操作不可撤销。"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={commitDelete}
        />
      )}

      {/* Toolbar */}
      <div className="border-b border-[var(--border)] shrink-0 text-xs">
        {/* Header row: collapse toggle + summary + settings */}
        <button
          type="button"
          onClick={() => setConfigOpen(v => !v)}
          className="w-full flex items-center gap-2 px-4 py-2 hover:bg-[var(--accent-light)] transition-colors"
          title={configOpen ? '收起配置' : '展开配置'}
        >
          {configOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          <Sliders size={12} className="text-[var(--text-tertiary)]" />
          <span className="text-[var(--text-secondary)] truncate min-w-0 flex-1 text-left">
            {modelsLoading ? '加载模型…'
              : availableProviders.length === 0 ? '未配置 API Key'
              : `${PROVIDER_LABELS[provider] || provider} · ${(model || '').split('/').pop() || '未选模型'}`}
          </span>
          {!configOpen && (
            <span className="text-[10px] text-[var(--text-tertiary)] flex items-center gap-1.5 shrink-0">
              {ragEnabled && <span className="flex items-center gap-0.5"><Database size={10}/>RAG</span>}
              {prefs.includeCanvasContext && prefs.canvasSessionIds.length > 0 && (
                <span className="flex items-center gap-0.5"><LayoutTemplate size={10}/>{prefs.canvasSessionIds.length}</span>
              )}
            </span>
          )}
          <Settings
            size={13}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] shrink-0"
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setShowSettings(true) }}
          />
        </button>

        {configOpen && (
          <div className="px-4 pb-3 flex flex-col gap-2">
            {modelsLoading ? (
              <div className="flex items-center gap-1.5 text-[var(--text-tertiary)]">
                <Spinner size={12} /> 加载模型…
              </div>
            ) : availableProviders.length === 0 ? (
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-1.5 text-[var(--warning)] hover:opacity-80 transition-opacity"
              >
                <Settings size={12} /> 请先配置 API Key
              </button>
            ) : (
              <>
                {/* Row: Provider */}
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-tertiary)] w-16 shrink-0">平台</span>
                  <select
                    className="flex-1 min-w-0 border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
                    value={provider}
                    onChange={e => handleProviderChange(e.target.value)}
                  >
                    {availableProviders.map(p => (
                      <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                    ))}
                  </select>
                </div>
                {/* Row: Model */}
                <div className="flex items-center gap-2">
                  <span className="text-[var(--text-tertiary)] w-16 shrink-0">模型</span>
                  <select
                    className="flex-1 min-w-0 border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
                    value={model}
                    onChange={e => handleModelChange(e.target.value)}
                  >
                    {presets.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                    {currentCustom && !presets.find(m => m.value === currentCustom) && (
                      <option value={currentCustom}>
                        {currentCustom.replace(`${provider}/`, '')}（自定义）
                      </option>
                    )}
                    <option value={CUSTOM_VALUE}>自定义模型…</option>
                  </select>
                </div>
              </>
            )}

            {/* Row: RAG */}
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-tertiary)] w-16 shrink-0 flex items-center gap-1"><Database size={11}/>RAG</span>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={ragEnabled}
                  onChange={e => setRagEnabled(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[var(--text-secondary)]">启用</span>
              </label>
              {ragEnabled && (
                <select
                  className="flex-1 min-w-0 border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
                  value={ragMode}
                  onChange={e => setRagMode(e.target.value)}
                >
                  {RAG_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              )}
            </div>

            {/* Row: Canvas context */}
            <div className="flex items-center gap-2">
              <span className="text-[var(--text-tertiary)] w-16 shrink-0 flex items-center gap-1"><LayoutTemplate size={11}/>画布</span>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={prefs.includeCanvasContext}
                  onChange={e => updatePrefs(chatSessionId, { includeCanvasContext: e.target.checked })}
                  className="accent-[var(--accent)]"
                />
                <span className="text-[var(--text-secondary)]">启用</span>
              </label>
              {prefs.includeCanvasContext && (
                <>
                  <button
                    type="button"
                    onClick={() => setShowCanvasPicker(v => !v)}
                    className="flex-1 min-w-0 truncate text-left px-2 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    选画布 ({prefs.canvasSessionIds.length})
                  </button>
                  <select
                    className="shrink-0 border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
                    value={prefs.canvasContextMode}
                    onChange={e => updatePrefs(chatSessionId, { canvasContextMode: e.target.value as 'full' | 'summary' })}
                  >
                    <option value="full">完整</option>
                    <option value="summary">摘要</option>
                  </select>
                </>
              )}
            </div>

            {prefs.includeCanvasContext && estimatedTokens > 0 && (
              <div className="flex items-center gap-2 pl-[72px]">
                <span className={clsx('text-[11px]', estimatedTokens >= SUMMARY_SUGGEST_THRESHOLD ? 'text-[var(--warning)]' : 'text-[var(--text-tertiary)]')}>
                  ~{estimatedTokens} tokens
                  {estimatedTokens >= SUMMARY_SUGGEST_THRESHOLD && prefs.canvasContextMode === 'full' && (
                    <button
                      onClick={() => updatePrefs(chatSessionId, { canvasContextMode: 'summary' })}
                      className="ml-1 underline hover:opacity-80"
                    >
                      切换为摘要
                    </button>
                  )}
                </span>
              </div>
            )}

            {!ragEnabled && !prefs.includeCanvasContext && (
              <span className="text-[11px] text-[var(--text-tertiary)] pl-[72px]">仅使用对话上下文</span>
            )}
          </div>
        )}

        {showCanvasPicker && (
          <div className="px-4 pb-2">
            <div className="border border-[var(--border)] rounded-[var(--radius-sm)] p-2 bg-[var(--bg-surface)] max-h-40 overflow-y-auto flex flex-col gap-1">
              {canvasSessions.length === 0 && (
                <span className="text-[11px] text-[var(--text-tertiary)]">该项目还没有画布</span>
              )}
              {canvasSessions.map(s => {
                const checked = prefs.canvasSessionIds.includes(s.id)
                return (
                  <label key={s.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={e => {
                        const next = e.target.checked
                          ? [...prefs.canvasSessionIds, s.id]
                          : prefs.canvasSessionIds.filter(id => id !== s.id)
                        updatePrefs(chatSessionId, { canvasSessionIds: next })
                      }}
                      className="accent-[var(--accent)]"
                    />
                    <span className={clsx(s.archived_at && 'text-[var(--text-tertiary)] line-through')}>{s.title}</span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.length === 0 && !streamBuffer && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] text-xs text-center gap-2">
            <Bot size={28} className="opacity-30" />
            <span>Start a conversation about your product requirements</span>
          </div>
        )}
        {messages.map(m => (
          <MessageBubble
            key={m.id}
            message={m}
            canRegenerate={m.role === 'user' && !streaming}
            onRegenerate={() => handleRegenerate(m.id, m.content)}
            onEdit={() => handleEdit(m.id, m.content)}
            onDelete={() => handleDelete(m.id)}
          />
        ))}
        {streaming && (
          <MessageBubble
            message={{
              id: '__streaming__',
              role: 'assistant',
              content: streamBuffer || '…',
              model_used: model,
              trace_id: null,
              meta: null,
              created_at: new Date().toISOString(),
            }}
            streaming
          />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-[var(--border)] shrink-0">
        <div className="flex gap-2">
          <textarea
            className="flex-1 border border-[var(--border)] rounded-[var(--radius-md)] px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent)] bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]"
            rows={2}
            placeholder="Describe your requirements…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={streaming}
          />
          <Button
            className="self-end"
            onClick={streaming ? handleStop : handleSend}
            disabled={streaming ? false : (!input.trim() || !model)}
            title={streaming ? '停止生成' : '发送'}
          >
            {streaming ? <Square size={14} /> : <Send size={14} />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({
  message, streaming = false,
  canRegenerate, onRegenerate, onEdit, onDelete,
}: {
  message: ChatMessage
  streaming?: boolean
  canRegenerate?: boolean
  onRegenerate?: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)
  const [showSources, setShowSources] = useState(false)
  const meta = message.meta

  function copy() {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }

  return (
    <div className={clsx('group flex gap-2 items-start', isUser && 'flex-row-reverse')}>
      <div className={clsx(
        'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
        isUser ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]',
      )}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>
      <div className={clsx('max-w-[80%] flex flex-col gap-1', isUser && 'items-end')}>
        <div className={clsx(
          'px-3 py-2 rounded-[var(--radius-md)] text-sm break-words',
          isUser
            ? 'bg-[var(--accent)] text-white rounded-tr-sm whitespace-pre-wrap'
            : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-tl-sm',
          streaming && 'after:content-[\'▋\'] after:animate-pulse after:ml-0.5',
          meta?.stopped && 'opacity-80',
        )}>
          {isUser ? message.content : <MarkdownMessage content={message.content} />}
        </div>

        {/* Footer: usage / sources / actions */}
        {!streaming && (
          <div className={clsx(
            'flex items-center gap-2 text-[10px] text-[var(--text-tertiary)]',
            isUser && 'flex-row-reverse',
          )}>
            {meta?.usage?.total_tokens !== undefined && (
              <span title={`prompt ${meta.usage.prompt_tokens ?? 0} / completion ${meta.usage.completion_tokens ?? 0}`}>
                {meta.usage.total_tokens} tok
              </span>
            )}
            {meta?.stopped && <span className="text-[var(--warning)]">已中断</span>}
            {meta?.edited_at && <span>已编辑</span>}
            {!isUser && message.model_used && (
              <span className="opacity-70">{message.model_used.split('/').pop()}</span>
            )}
            <div className="flex items-center gap-1.5">
              <button onClick={copy} title="复制" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              {isUser && onEdit && (
                <button onClick={onEdit} title="编辑" className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]">
                  <Pencil size={12} />
                </button>
              )}
              {canRegenerate && onRegenerate && (
                <button onClick={onRegenerate} title="重新生成回复" className="text-[var(--text-tertiary)] hover:text-[var(--accent)]">
                  <RotateCcw size={12} />
                </button>
              )}
              {onDelete && (
                <button onClick={onDelete} title="删除" className="text-[var(--text-tertiary)] hover:text-[var(--warning)]">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          </div>
        )}

        {/* RAG source disclosure */}
        {!isUser && meta?.rag_sources && meta.rag_sources.length > 0 && (
          <div className="text-[10px] w-full">
            <button
              onClick={() => setShowSources(v => !v)}
              className="flex items-center gap-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
            >
              {showSources ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
              <Database size={10} /> {meta.rag_sources.length} 个 RAG 引用
            </button>
            {showSources && (
              <div className="mt-1 border border-[var(--border)] rounded-[var(--radius-sm)] bg-[var(--bg-surface)] p-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-[var(--text-secondary)]">
                {meta.rag_sources.map((s, idx) => (
                  <div key={idx} className={clsx(idx > 0 && 'mt-2 pt-2 border-t border-[var(--border)]')}>
                    <div className="text-[var(--text-tertiary)] mb-0.5">mode: {s.mode || '—'}</div>
                    {s.context}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Modals (replace native prompt/confirm which Simple Browser blocks) ──────

function EditMessageModal({
  initial, onCancel, onConfirm,
}: {
  initial: string
  onCancel: () => void
  onConfirm: (next: string) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center" onMouseDown={onCancel}>
      <div
        className="bg-[var(--bg-base)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-xl w-[min(560px,90vw)] p-4 flex flex-col gap-3"
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-[var(--text-primary)]">编辑消息</div>
        <textarea
          autoFocus
          rows={6}
          value={value}
          onChange={e => setValue(e.target.value)}
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

function ConfirmModal({
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
