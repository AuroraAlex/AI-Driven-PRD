import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Send, Bot, User } from 'lucide-react'
import clsx from 'clsx'
import { chatApi } from '../../api/client'
import { useChatStore } from '../../store/chatStore'
import { Button, Spinner } from '../ui'

const MODELS = [
  { label: 'GPT-4o', value: 'openai/gpt-4o' },
  { label: 'GPT-4o mini', value: 'openai/gpt-4o-mini' },
  { label: 'Claude 3.5 Sonnet', value: 'anthropic/claude-sonnet-4-5' },
  { label: 'Claude 3.5 Haiku', value: 'anthropic/claude-haiku-3-5' },
  { label: 'Qwen-Max (百炼)', value: 'dashscope/qwen-max' },
  { label: 'Qwen-Plus (百炼)', value: 'dashscope/qwen-plus' },
  { label: 'Qwen-Turbo (百炼)', value: 'dashscope/qwen-turbo' },
]

const RAG_MODES = ['hybrid', 'local', 'global', 'naive']

interface Props {
  projectId: string
}

export default function ChatPanel({ projectId }: Props) {
  const { messages, streaming, streamBuffer, model, ragMode,
    setMessages, addMessage, setStreaming, appendToken, clearBuffer,
    setModel, setRagMode } = useChatStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load history on mount
  useQuery({
    queryKey: ['chat-history', projectId],
    queryFn: () => chatApi.history(projectId),
    onSuccess: setMessages,
  } as any)

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamBuffer])

  async function handleSend() {
    const text = input.trim()
    if (!text || streaming) return
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
      const res = await chatApi.stream(projectId, text, model, ragMode)
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
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] shrink-0">
        <select
          className="text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
          value={model}
          onChange={e => setModel(e.target.value)}
        >
          {MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select
          className="text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none"
          value={ragMode}
          onChange={e => setRagMode(e.target.value)}
        >
          {RAG_MODES.map(m => <option key={m} value={m}>RAG: {m}</option>)}
        </select>
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
            disabled={!input.trim() || streaming}
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
        'max-w-[80%] px-3 py-2 rounded-[var(--radius-md)] text-sm whitespace-pre-wrap break-words',
        isUser
          ? 'bg-[var(--accent)] text-white rounded-tr-sm'
          : 'bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] rounded-tl-sm',
        streaming && 'after:content-[\'▋\'] after:animate-pulse after:ml-0.5',
      )}>
        {content}
      </div>
    </div>
  )
}
