/**
 * ModeCompare — runs the same query in all 4 RAG modes side-by-side and
 * lets the user inspect which mode returned the best evidence. This is the
 * primary "how do I verify this mode?" tool.
 */
import { useState } from 'react'
import { Search, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { knowledgeApi, type RAGMode } from '../../api/client'
import { RAG_MODE_MAP, RAG_MODES } from '../../constants/ragModes'
import MarkdownPreview from '../markdown/MarkdownPreview'

interface Props {
  projectId: string
}

interface ModeResult {
  mode: RAGMode
  ok: boolean
  ms: number
  data?: { results: unknown[] }
  error?: string
}

/** Convert one rag_hit payload to a markdown string. */
function hitToMarkdown(hit: unknown): string {
  if (typeof hit === 'string') return hit
  if (hit && typeof hit === 'object') {
    const h = hit as Record<string, unknown>
    // RAGAgent emits { context: string, mode } — the canonical case.
    if (typeof h.context === 'string') return h.context
    // Naive mode chunk dicts may include content / text / score.
    const text = (typeof h.content === 'string' && h.content)
      || (typeof h.text === 'string' && h.text)
      || (typeof h.chunk === 'string' && h.chunk)
    if (text) {
      const score = typeof h.score === 'number' ? `（score: ${h.score.toFixed(3)}）` : ''
      return `${score}\n\n${text}`
    }
  }
  // Fallback: show the raw JSON inside a fenced block.
  return '```json\n' + JSON.stringify(hit, null, 2) + '\n```'
}

function resultsToMarkdown(results: unknown[]): string {
  if (!results || results.length === 0) return '_（未返回任何结果）_'
  if (results.length === 1) return hitToMarkdown(results[0])
  return results
    .map((r, i) => `### 结果 ${i + 1}\n\n${hitToMarkdown(r)}`)
    .join('\n\n---\n\n')
}

export default function ModeCompare({ projectId }: Props) {
  const [query, setQuery] = useState('')
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ModeResult[]>([])

  async function run() {
    const q = query.trim()
    if (!q) {
      toast.error('请输入查询语句')
      return
    }
    setRunning(true)
    try {
      const res = await knowledgeApi.batchQuery(projectId, q)
      setResults(res as ModeResult[])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error(`查询失败：${msg}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-6 py-4 border-b border-[var(--border)] space-y-3">
        <div>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">模式对比</h2>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">
            同一个问题并发跑 4 种检索模式，比较返回的证据数量、用时与内容差异。
          </p>
        </div>
        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg-surface)] text-sm focus:outline-none focus:border-[var(--accent)]"
            placeholder="例如：用户登录失败的常见原因有哪些？"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') run() }}
            disabled={running}
          />
          <button
            className="flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-50"
            onClick={run}
            disabled={running}
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
            对比检索
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {results.length === 0 ? (
          <div className="text-xs text-[var(--text-tertiary)] py-12 text-center">
            尚无结果。输入问题后点击"对比检索"。
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {RAG_MODES.map(m => {
              const r = results.find(x => x.mode === m.key)
              return (
                <article key={m.key} className="border border-[var(--border)] rounded-[var(--radius-md)] bg-[var(--bg-surface)] flex flex-col overflow-hidden">
                  <header className="px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-base)]">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{m.label}</span>
                      {r && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${r.ok ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--warning)]/10 text-[var(--warning)]'}`}>
                          {r.ok ? `${(r.data?.results.length ?? 0)} 条 / ${r.ms}ms` : `失败 ${r.ms}ms`}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--text-tertiary)] mt-1">{m.description}</p>
                  </header>
                  <div className="p-3 max-h-72 overflow-y-auto text-xs text-[var(--text-secondary)] break-words">
                    {!r ? '—' : r.ok
                      ? <MarkdownPreview content={resultsToMarkdown(r.data?.results ?? [])} className="text-xs" />
                      : <span className="text-[var(--warning)]">{r.error}</span>}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>

      <footer className="px-6 py-3 border-t border-[var(--border)] text-[11px] text-[var(--text-tertiary)]">
        提示：
        若 <b className="mx-0.5">naive</b> 已经命中正确答案，说明问题偏事实型，无需图谱；
        若只有 <b className="mx-0.5">{RAG_MODE_MAP.local.label}</b> 命中，说明答案藏在某个具体实体的邻域；
        若 <b className="mx-0.5">{RAG_MODE_MAP.global.label}</b> 答得最好，说明问题偏抽象 / 归纳。
      </footer>
    </div>
  )
}
