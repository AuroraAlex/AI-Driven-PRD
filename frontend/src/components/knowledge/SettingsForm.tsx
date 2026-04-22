/**
 * SettingsForm — per-project knowledge-base configuration.
 *
 * All fields are optional. Empty input clears the override and falls back to
 * the system-wide default detected from the configured LLM provider.
 */
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, Save, RefreshCcw, CheckCircle2, XCircle, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import { knowledgeApi, type KBSettings, type RAGMode, type RAGProvider } from '../../api/client'
import { RAG_MODES } from '../../constants/ragModes'

interface Props {
  projectId: string
}

type Draft = {
  embedding_model: string
  extraction_model: string
  rerank_model: string
  embedding_provider: RAGProvider | ''
  extraction_provider: RAGProvider | ''
  rerank_provider: RAGProvider | ''
  min_rerank_score: string
  chunk_token_size: string
  chunk_overlap_token_size: string
  top_k: string
  default_rag_mode: RAGMode | ''
  rag_max_instances: string
}

const EMPTY: Draft = {
  embedding_model: '',
  extraction_model: '',
  rerank_model: '',
  embedding_provider: '',
  extraction_provider: '',
  rerank_provider: '',
  min_rerank_score: '',
  chunk_token_size: '',
  chunk_overlap_token_size: '',
  top_k: '',
  default_rag_mode: '',
  rag_max_instances: '',
}

function toDraft(s: KBSettings | undefined): Draft {
  if (!s) return EMPTY
  return {
    embedding_model: s.embedding_model ?? '',
    extraction_model: s.extraction_model ?? '',
    rerank_model: s.rerank_model ?? '',
    embedding_provider: (s.embedding_provider ?? '') as RAGProvider | '',
    extraction_provider: (s.extraction_provider ?? '') as RAGProvider | '',
    rerank_provider: (s.rerank_provider ?? '') as RAGProvider | '',
    min_rerank_score: s.min_rerank_score?.toString() ?? '',
    chunk_token_size: s.chunk_token_size?.toString() ?? '',
    chunk_overlap_token_size: s.chunk_overlap_token_size?.toString() ?? '',
    top_k: s.top_k?.toString() ?? '',
    default_rag_mode: (s.default_rag_mode ?? '') as RAGMode | '',
    rag_max_instances: s.rag_max_instances?.toString() ?? '',
  }
}

function toPayload(d: Draft): Partial<KBSettings> {
  const numOrNull = (v: string) => (v === '' ? null : Number(v))
  return {
    embedding_model: d.embedding_model || null,
    extraction_model: d.extraction_model || null,
    rerank_model: d.rerank_model || null,
    embedding_provider: (d.embedding_provider || null) as RAGProvider | null,
    extraction_provider: (d.extraction_provider || null) as RAGProvider | null,
    rerank_provider: (d.rerank_provider || null) as RAGProvider | null,
    min_rerank_score: numOrNull(d.min_rerank_score),
    chunk_token_size: numOrNull(d.chunk_token_size),
    chunk_overlap_token_size: numOrNull(d.chunk_overlap_token_size),
    top_k: numOrNull(d.top_k),
    default_rag_mode: (d.default_rag_mode || null) as RAGMode | null,
    rag_max_instances: numOrNull(d.rag_max_instances),
  }
}

const PROVIDERS: { value: RAGProvider; label: string }[] = [
  { value: 'dashscope', label: 'DashScope (百炼)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
]

// Model presets — surface the well-known names so users don't typo (e.g. "qwen3.6-plus").
const EXTRACTION_PRESETS = ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen3-235b-a22b', 'gpt-4o-mini', 'gpt-4o']
const EMBEDDING_PRESETS = ['text-embedding-v3', 'text-embedding-v4', 'text-embedding-3-small', 'text-embedding-3-large', 'bge-m3']
const RERANK_PRESETS = ['gte-rerank', 'gte-rerank-v2']

export default function SettingsForm({ projectId }: Props) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['kb-settings', projectId],
    queryFn: () => knowledgeApi.getSettings(projectId),
  })

  const [draft, setDraft] = useState<Draft>(EMPTY)
  useEffect(() => {
    setDraft(toDraft(data))
  }, [data])

  // Per-component verification status. `null` = idle, `true/false` = last result.
  type VStatus = { state: 'idle' | 'running' | 'ok' | 'err'; message?: string }
  const [verify, setVerify] = useState<Record<'llm' | 'embedding' | 'rerank', VStatus>>({
    llm: { state: 'idle' },
    embedding: { state: 'idle' },
    rerank: { state: 'idle' },
  })

  async function runVerify(component: 'llm' | 'embedding' | 'rerank') {
    setVerify((v) => ({ ...v, [component]: { state: 'running' } }))
    const model =
      component === 'llm' ? draft.extraction_model
        : component === 'embedding' ? draft.embedding_model
        : draft.rerank_model
    const provider =
      component === 'llm' ? draft.extraction_provider
        : component === 'embedding' ? draft.embedding_provider
        : draft.rerank_provider
    try {
      const res = await knowledgeApi.verifyComponent(projectId, {
        component,
        model: model || null,
        provider: (provider || null) as RAGProvider | null,
      })
      const msg = res.detail ? `${res.message} — ${res.detail}` : res.message
      setVerify((v) => ({
        ...v,
        [component]: { state: res.valid ? 'ok' : 'err', message: msg },
      }))
      if (res.valid) toast.success(msg, { duration: 3000 })
      else toast.error(msg, { duration: 5000 })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setVerify((v) => ({ ...v, [component]: { state: 'err', message: msg } }))
      toast.error(`验证失败：${msg}`)
    }
  }

  const saveMut = useMutation({
    mutationFn: () => knowledgeApi.updateSettings(projectId, toPayload(draft)),
    onSuccess: (s) => {
      qc.setQueryData(['kb-settings', projectId], s)
      toast.success('已保存。下次提问会重新加载知识库。')
    },
    onError: (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e)
      toast.error(`保存失败：${message}`)
    },
  })

  if (isLoading) {
    return <div className="p-6 text-sm text-[var(--text-tertiary)]">加载中…</div>
  }

  const update = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setDraft({ ...draft, [k]: e.target.value })

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6 pb-24">
      <header>
        <h2 className="text-base font-semibold text-[var(--text-primary)]">知识库参数</h2>
        <p className="text-xs text-[var(--text-tertiary)] mt-1">
          留空表示沿用系统默认（按已配置的 LLM Provider 自动选择）。
          修改后下一次提问 / 重建会生效；分块大小变更建议随后执行<b className="mx-1">重建</b>。
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Embedding 提供商" hint="各组件包括 API 端点不同（如 DashScope embedding 位于 compatible-mode/v1），仅选下拉即可。">
          <ProviderSelect value={draft.embedding_provider} onChange={(v) => setDraft({ ...draft, embedding_provider: v })} />
        </Field>
        <Field label="Embedding 模型" hint="例：text-embedding-v3 / text-embedding-3-small">
          <div className="flex gap-2 items-stretch">
            <div className="flex-1">
              <ModelInput value={draft.embedding_model} presets={EMBEDDING_PRESETS} onChange={(v) => setDraft({ ...draft, embedding_model: v })} />
            </div>
            <VerifyButton status={verify.embedding} onClick={() => runVerify('embedding')} />
          </div>
        </Field>
        <Field label="抽取 LLM 提供商" hint="用于实体/关系抽取与答案汇总">
          <ProviderSelect value={draft.extraction_provider} onChange={(v) => setDraft({ ...draft, extraction_provider: v })} />
        </Field>
        <Field label="抽取 LLM 模型" hint="建议用强模型。DashScope 走 openai-compat 路由">
          <div className="flex gap-2 items-stretch">
            <div className="flex-1">
              <ModelInput value={draft.extraction_model} presets={EXTRACTION_PRESETS} onChange={(v) => setDraft({ ...draft, extraction_model: v })} />
            </div>
            <VerifyButton status={verify.llm} onClick={() => runVerify('llm')} />
          </div>
        </Field>
        <Field label="Rerank 提供商" hint="DashScope rerank 使用 api/v1/services/rerank 独立端点">
          <ProviderSelect value={draft.rerank_provider} onChange={(v) => setDraft({ ...draft, rerank_provider: v })} />
        </Field>
        <Field label="Rerank 模型" hint="可选。开启后检索后会对 chunks 重排">
          <div className="flex gap-2 items-stretch">
            <div className="flex-1">
              <ModelInput value={draft.rerank_model} presets={RERANK_PRESETS} onChange={(v) => setDraft({ ...draft, rerank_model: v })} placeholder="（不启用）" />
            </div>
            <VerifyButton status={verify.rerank} onClick={() => runVerify('rerank')} disabled={!draft.rerank_model} />
          </div>
        </Field>
        <Field label="Rerank 最低得分" hint="0–1。低于该阈值的 chunk 会被丢弃">
          <input className={inputCls} type="number" step="0.01" min={0} max={1} value={draft.min_rerank_score} onChange={update('min_rerank_score')} placeholder="0.0" />
        </Field>
        <Field label="Chunk Tokens" hint="单个文本块的 token 数，128–8192">
          <input className={inputCls} type="number" min={128} max={8192} value={draft.chunk_token_size} onChange={update('chunk_token_size')} placeholder="1200" />
        </Field>
        <Field label="Chunk Overlap" hint="相邻块的重叠 token 数">
          <input className={inputCls} type="number" min={0} max={2048} value={draft.chunk_overlap_token_size} onChange={update('chunk_overlap_token_size')} placeholder="100" />
        </Field>
        <Field label="检索 Top-K" hint="单次查询召回的最大块数">
          <input className={inputCls} type="number" min={1} max={200} value={draft.top_k} onChange={update('top_k')} placeholder="40" />
        </Field>
        <Field label="默认 RAG 模式" hint="新会话默认使用的检索模式">
          <select className={inputCls} value={draft.default_rag_mode} onChange={update('default_rag_mode')}>
            <option value="">（默认 hybrid）</option>
            {RAG_MODES.map(m => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </Field>
        <Field label="LightRAG 实例缓存数" hint="服务端最多同时驻留的项目实例数">
          <input className={inputCls} type="number" min={1} max={100} value={draft.rag_max_instances} onChange={update('rag_max_instances')} placeholder="8" />
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <button
          className="flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
          disabled={saveMut.isPending}
          onClick={() => saveMut.mutate()}
        >
          {saveMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          保存
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => setDraft(toDraft(data))}
        >
          <RefreshCcw size={14} /> 重置
        </button>
      </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-[var(--text-primary)]">{label}</span>
      {children}
      {hint && <span className="text-[10px] text-[var(--text-tertiary)]">{hint}</span>}
    </label>
  )
}

/** Free-text input with a `<datalist>` of preset model names so the user can pick or type. */
function ModelInput({ value, presets, onChange, placeholder = '（默认）' }: {
  value: string
  presets: string[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const listId = `models-${presets.join('-').replace(/[^a-z0-9-]/gi, '')}`
  return (
    <>
      <input
        className={inputCls}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <datalist id={listId}>
        {presets.map(p => <option key={p} value={p} />)}
      </datalist>
    </>
  )
}

/** Provider picker — empty string means "auto-detect from configured API keys". */
function ProviderSelect({ value, onChange }: {
  value: RAGProvider | ''
  onChange: (v: RAGProvider | '') => void
}) {
  return (
    <select
      className={inputCls}
      value={value}
      onChange={(e) => onChange(e.target.value as RAGProvider | '')}
    >
      <option value="">（自动 / 跟随 API Key）</option>
      {PROVIDERS.map(p => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  )
}

/** Inline "验证" button — calls the per-component verify endpoint and shows
 *  a tiny status badge so the user can confirm the model actually works. */
function VerifyButton({ status, onClick, disabled }: {
  status: { state: 'idle' | 'running' | 'ok' | 'err'; message?: string }
  onClick: () => void
  disabled?: boolean
}) {
  const running = status.state === 'running'
  const colorCls =
    status.state === 'ok' ? 'border-[var(--success)] text-[var(--success)]'
      : status.state === 'err' ? 'border-[var(--warning)] text-[var(--warning)]'
      : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
  const Icon = running ? Loader2 : status.state === 'ok' ? CheckCircle2 : status.state === 'err' ? XCircle : Zap
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      title={status.message || '点击验证模型是否可用'}
      className={`flex items-center gap-1 px-3 rounded-[var(--radius-sm)] border bg-[var(--bg-surface)] text-xs whitespace-nowrap disabled:opacity-50 ${colorCls}`}
    >
      <Icon size={13} className={running ? 'animate-spin' : ''} />
      {running ? '验证中' : status.state === 'ok' ? '可用' : status.state === 'err' ? '失败' : '验证'}
    </button>
  )
}
