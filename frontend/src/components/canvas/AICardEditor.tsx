/**
 * AICardEditor.tsx — Modal for viewing and editing the rich content stored
 * inside an `ai_card` group on the canvas. Supports re-generation via the
 * AI cards SSE endpoint.
 */
import { useEffect, useMemo, useState } from 'react'
import { Bot, RefreshCw, X } from 'lucide-react'
import clsx from 'clsx'
import { aiCardsApi, type AICardContent } from '../../api/client'
import { useCanvasStore } from '../../store/canvasStore'
import { useChatStore } from '../../store/chatStore'
import { useKBProgress } from '../knowledge/KBStatusBar'
import MarkdownMessage from '../chat/MarkdownMessage'
import { Button, Spinner } from '../ui'

interface Props {
  projectId: string
  canvasSessionId: string | null
}

interface CardElements {
  rootEl: Record<string, unknown>
  bodyEl: Record<string, unknown> | null
  groupId: string
}

function findAICard(api: ReturnType<typeof useCanvasStore.getState>['api'], groupId: string): CardElements | null {
  if (!api) return null
  const elements = api.getSceneElements()
  let rootEl: Record<string, unknown> | null = null
  let bodyEl: Record<string, unknown> | null = null
  for (const el of elements as unknown as Array<Record<string, unknown>>) {
    const cd = (el.customData as Record<string, unknown>) || {}
    const gids = (el.groupIds as string[] | undefined) || []
    const inGroup = gids[0] === groupId || el.id === groupId
    if (!inGroup) continue
    if (cd.nodeType === 'ai_card') rootEl = el
    if (cd.nodeType === 'ai_card_body') bodyEl = el
  }
  if (!rootEl) return null
  return { rootEl, bodyEl, groupId }
}

const blank: AICardContent = {
  schemaVersion: 1, markdown: '', summary: '', sources: [],
  prompt: '', model: '', generated_at: 0, version: 1,
}

export default function AICardEditor({ projectId, canvasSessionId }: Props) {
  const api = useCanvasStore(s => s.api)
  const openAICardId = useCanvasStore(s => s.openAICardId)
  const setOpenAICardId = useCanvasStore(s => s.setOpenAICardId)
  const model = useChatStore(s => s.model)
  const { data: kbProgress } = useKBProgress(projectId)
  const kbReady = !!kbProgress?.kb_ready

  const card = useMemo(() => (openAICardId ? findAICard(api, openAICardId) : null), [api, openAICardId])
  const initial: AICardContent = useMemo(() => {
    if (!card) return blank
    const cd = (card.rootEl.customData as Record<string, unknown>) || {}
    return { ...blank, ...((cd.aiContent as AICardContent) || {}) }
  }, [card])

  const [draft, setDraft] = useState<AICardContent>(initial)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setDraft(initial) }, [initial])

  if (!openAICardId) return null
  if (!card) {
    // Card was deleted; close the modal silently
    setOpenAICardId(null)
    return null
  }

  function persist(next: AICardContent) {
    if (!api || !card) return
    const elements = api.getSceneElements()
    const previewText = (next.summary || next.markdown || '在这里记录 AI 的分析结果...').slice(0, 200)
    const updated = (elements as unknown as Array<Record<string, unknown>>).map(el => {
      if (el === card.rootEl) {
        const cd = { ...((el.customData as Record<string, unknown>) || {}), aiContent: next }
        return { ...el, customData: cd, version: ((el.version as number) ?? 1) + 1 }
      }
      if (el === card.bodyEl) {
        return { ...el, text: previewText, originalText: previewText, version: ((el.version as number) ?? 1) + 1 }
      }
      return el
    })
    api.updateScene({ elements: updated as never[] })
  }

  async function handleSave() {
    persist(draft)
    setOpenAICardId(null)
  }

  async function handleRegenerate() {
    if (!model) { setError('请先在对话面板选择模型'); return }
    if (!draft.prompt.trim()) { setError('请填写提示词后再生成'); return }
    setError(null)
    setGenerating(true)
    try {
      const res = await aiCardsApi.generate(projectId, {
        prompt: draft.prompt,
        model,
        ragEnabled: kbReady,
        canvasSessionIds: canvasSessionId ? [canvasSessionId] : [],
      })
      if (!res.body) throw new Error('No body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let acc = ''
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
              acc += evt.data
              setDraft(d => ({ ...d, markdown: acc }))
            } else if (evt.type === 'card') {
              const next = { ...draft, ...(evt.data as AICardContent), prompt: draft.prompt }
              setDraft(next)
              persist(next)
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setError(String((err as Error).message ?? err))
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpenAICardId(null)}>
      <div className="bg-[var(--bg-base)] rounded-[var(--radius-md)] shadow-xl border border-[var(--border)] w-full max-w-3xl max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <header className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Bot size={14} className="text-[var(--accent)]" /> AI 卡片
            {draft.model && <span className="text-[10px] font-normal text-[var(--text-tertiary)]">{draft.model}</span>}
          </div>
          <button className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={() => setOpenAICardId(null)}>
            <X size={14} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">提示词</label>
            <textarea
              className="w-full text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
              rows={2}
              value={draft.prompt}
              onChange={e => setDraft(d => ({ ...d, prompt: e.target.value }))}
              placeholder="例如：根据当前画布的用户故事，生成验收标准"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">摘要（卡片预览）</label>
            <input
              className="w-full text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
              value={draft.summary}
              onChange={e => setDraft(d => ({ ...d, summary: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">内容（Markdown）</label>
            <textarea
              className="w-full text-xs font-mono border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-y"
              rows={10}
              value={draft.markdown}
              onChange={e => setDraft(d => ({ ...d, markdown: e.target.value }))}
            />
          </div>

          {draft.markdown && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">预览</label>
              <div className="border border-[var(--border)] rounded-[var(--radius-sm)] p-3 bg-[var(--bg-surface)] text-sm text-[var(--text-primary)] max-h-72 overflow-y-auto">
                <MarkdownMessage content={draft.markdown} />
              </div>
            </div>
          )}

          {draft.sources.length > 0 && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-secondary)] mb-1">来源</label>
              <ul className="flex flex-col gap-1">
                {draft.sources.map((s, i) => (
                  <li key={`${s.type}-${s.id}-${i}`} className="text-[11px] text-[var(--text-tertiary)] flex items-center gap-1">
                    <span className={clsx('inline-block px-1 rounded bg-[var(--accent-light)] text-[var(--accent)]')}>{s.type}</span>
                    <span className="truncate">{s.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <div className="text-[11px] text-[var(--warning)]">{error}</div>}
        </div>

        <footer className="flex items-center justify-between px-4 py-2 border-t border-[var(--border)] gap-2">
          <Button onClick={handleRegenerate} disabled={generating} className="!bg-transparent !text-[var(--accent)] !border !border-[var(--accent)]">
            {generating ? <Spinner size={12} /> : <RefreshCw size={12} />}
            <span className="ml-1">{generating ? '生成中…' : '重新生成'}</span>
          </Button>
          <div className="flex items-center gap-2">
            <button className="text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]" onClick={() => setOpenAICardId(null)}>取消</button>
            <Button onClick={handleSave} disabled={generating}>保存</Button>
          </div>
        </footer>
      </div>
    </div>
  )
}
