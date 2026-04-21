import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, Bot, User, Settings, Database } from 'lucide-react'
import clsx from 'clsx'
import { chatApi, settingsApi } from '../../api/client'
import { useChatStore } from '../../store/chatStore'
import { Button, Spinner } from '../ui'
import SettingsModal from '../ui/SettingsModal'
import CustomModelModal from './CustomModelModal'
import MarkdownMessage from './MarkdownMessage'

const RAG_MODES = ['hybrid', 'local', 'global', 'naive']
const CUSTOM_VALUE = '__custom__'

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  dashscope: '阿里云百炼',
}

interface Props {
  projectId: string
}

export default function ChatPanel({ projectId }: Props) {
  const {
    messages, streaming, streamBuffer,
    provider, model, customModels, ragEnabled, ragMode,
    setMessages, addMessage, setStreaming, appendToken, clearBuffer,
    setProvider, setModel, setCustomModel, setRagEnabled, setRagMode,
  } = useChatStore()
  const [input, setInput] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [showCustomModal, setShowCustomModal] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

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

  // Load history on mount
  useQuery({
    queryKey: ['chat-history', projectId],
    queryFn: () => chatApi.history(projectId),
    onSuccess: setMessages,
  } as any)

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

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming || !model) return
    setInput('')

    const userMsg = {
      id: crypto.randomUUID(),
      role: 'user' as const,
      content: text,
      model_used: model,
      trace_id: null,
      created_at: new Date().toISOString(),
    }
    addMessage(userMsg)
    setStreaming(true)
    clearBuffer()

    try {
      const res = await chatApi.stream(projectId, text, model, ragMode, ragEnabled)
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
            if (evt.type === 'token') appendToken(evt.data)
          } catch (_) { /* skip */ }
        }
      }
    } catch (err) {
      console.error('Chat stream error', err)
    } finally {
      // Flush buffer into messages
      useChatStore.getState().setMessages([
        ...useChatStore.getState().messages,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: useChatStore.getState().streamBuffer,
          model_used: model,
          trace_id: null,
          created_at: new Date().toISOString(),
        },
      ])
      clearBuffer()
      setStreaming(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
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

      {/* Toolbar */}
      <div className="border-b border-[var(--border)] shrink-0">
        {/* Row 1: provider + model + settings */}
        <div className="flex items-center gap-2 px-4 pt-2 pb-1.5">
          {modelsLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-[var(--text-tertiary)]">
              <Spinner size={12} /> 加载模型…
            </div>
          ) : availableProviders.length === 0 ? (
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-1.5 text-xs text-[var(--warning)] hover:opacity-80 transition-opacity"
            >
              <Settings size={12} /> 请先配置 API Key
            </button>
          ) : (
            <>
              {/* Provider select */}
              <select
                className="text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
                value={provider}
                onChange={e => handleProviderChange(e.target.value)}
                title="平台"
              >
                {availableProviders.map(p => (
                  <option key={p} value={p}>{PROVIDER_LABELS[p] || p}</option>
                ))}
              </select>

              {/* Model select (filtered by provider) */}
              <select
                className="text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none max-w-[220px]"
                value={model}
                onChange={e => handleModelChange(e.target.value)}
                title="模型"
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
            </>
          )}

          <button
            onClick={() => setShowSettings(true)}
            className="ml-auto text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            title="配置 API Key"
          >
            <Settings size={14} />
          </button>
        </div>

        {/* Row 2: RAG toggle + mode */}
        <div className="flex items-center gap-2 px-4 pt-1 pb-2">
          <label className="flex items-center gap-1 text-xs text-[var(--text-secondary)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={ragEnabled}
              onChange={e => setRagEnabled(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            <Database size={11} /> RAG
          </label>
          {ragEnabled && (
            <select
              className="text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
              value={ragMode}
              onChange={e => setRagMode(e.target.value)}
              title="RAG 检索模式"
            >
              {RAG_MODES.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {!ragEnabled && (
            <span className="text-[11px] text-[var(--text-tertiary)]">已关闭检索，仅使用对话上下文</span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
        {messages.length === 0 && !streamBuffer && (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] text-xs text-center gap-2">
            <Bot size={28} className="opacity-30" />
            <span>Start a conversation about your product requirements</span>
          </div>
        )}
        {messages.map(m => <MessageBubble key={m.id} role={m.role} content={m.content} />)}
        {streamBuffer && <MessageBubble role="assistant" content={streamBuffer} streaming />}
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
            onClick={handleSend}
            disabled={!input.trim() || streaming || !model}
          >
            {streaming ? <Spinner size={14} /> : <Send size={14} />}
          </Button>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ role, content, streaming = false }: {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}) {
  const isUser = role === 'user'
  return (
    <div className={clsx('flex gap-2 items-start', isUser && 'flex-row-reverse')}>
      <div className={clsx(
        'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
        isUser ? 'bg-[var(--accent)] text-white' : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-secondary)]',
      )}>
        {isUser ? <User size={12} /> : <Bot size={12} />}
      </div>
      <div className={clsx(
        'max-w-[80%] px-3 py-2 rounded-[var(--radius-md)] text-sm break-words',
        isUser
          ? 'bg-[var(--accent)] text-white rounded-tr-sm whitespace-pre-wrap'
          : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-tl-sm',
        streaming && 'after:content-[\'▋\'] after:animate-pulse after:ml-0.5',
      )}>
        {isUser ? content : <MarkdownMessage content={content} />}
      </div>
    </div>
  )
}
