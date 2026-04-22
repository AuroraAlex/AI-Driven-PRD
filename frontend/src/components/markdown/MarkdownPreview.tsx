/**
 * MarkdownPreview — central Markdown rendering pipeline.
 *
 * Used by both the chat message bubbles (MarkdownMessage) and the standalone
 * Markdown editor preview pane. Supports:
 *   - GitHub-flavoured Markdown (tables, task lists)
 *   - LaTeX math via remark-math + rehype-katex
 *   - Mermaid diagrams in ```mermaid fences
 *   - Code blocks, blockquotes, themed tables
 *
 * Each top-level rendered node also gets `data-md-start` / `data-md-end`
 * attributes (offsets into the source markdown) so callers can map a DOM
 * Range back to the original markdown substring.
 */
import { useEffect, useRef, useState, memo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import mermaid from 'mermaid'
import 'katex/dist/katex.min.css'

let mermaidInitialized = false
function ensureMermaid() {
  if (mermaidInitialized) return
  mermaidInitialized = true
  const isDark =
    typeof document !== 'undefined' &&
    document.documentElement.classList.contains('dark')
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: isDark ? 'dark' : 'default',
    fontFamily: 'inherit',
  })
}

function MermaidBlock({ code }: { code: string }) {
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ensureMermaid()
    const trimmed = code.trim()
    if (!trimmed) {
      setSvg('')
      setError(null)
      return
    }
    const id = `mmd-${Math.random().toString(36).slice(2, 10)}`
    ;(async () => {
      try {
        // Validate first; suppresses the global error overlay mermaid would
        // otherwise inject (and which lingers across remounts).
        const parsed = await mermaid.parse(trimmed, { suppressErrors: true })
        if (parsed === false) {
          if (!cancelled) setError('Syntax error in text')
          return
        }
        const { svg } = await mermaid.render(id, trimmed)
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err))
      } finally {
        // mermaid leaves an orphan container with this id in document.body
        // when render fails; clean it up so it doesn't accumulate.
        const orphan = document.getElementById(id)
        if (orphan && orphan.parentNode === document.body) {
          orphan.parentNode.removeChild(orphan)
        }
        const dOrphan = document.getElementById(`d${id}`)
        if (dOrphan && dOrphan.parentNode === document.body) {
          dOrphan.parentNode.removeChild(dOrphan)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [code])

  if (error) {
    return (
      <pre className="text-xs text-[var(--error)] bg-[var(--bg-base)] border border-[var(--border)] rounded p-2 overflow-auto">
        Mermaid error: {error}
        {'\n\n'}
        {code}
      </pre>
    )
  }
  return (
    <div
      className="my-2 flex justify-center [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

interface Props {
  content: string
  /** Add data-md-start/data-md-end on top-level nodes for selection mapping. */
  trackOffsets?: boolean
  className?: string
}

/** Pull node.position offsets and surface them as data attributes. */
function offsetProps(node: any, enabled: boolean): Record<string, number> {
  if (!enabled || !node?.position) return {}
  const { start, end } = node.position
  if (typeof start?.offset !== 'number' || typeof end?.offset !== 'number') return {}
  return { 'data-md-start': start.offset, 'data-md-end': end.offset } as Record<string, number>
}

function MarkdownPreviewImpl({ content, trackOffsets = false, className }: Props) {
  return (
    <div className={`markdown-body text-sm leading-relaxed break-words ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          code(props) {
            const { children, className, node, ...rest } = props as any
            const match = /language-(\w+)/.exec(className || '')
            const lang = match?.[1]
            const text = String(children ?? '').replace(/\n$/, '')
            const isInline = !node?.position || !className
            if (!isInline && lang === 'mermaid') {
              return (
                <div {...offsetProps(node, trackOffsets)}>
                  <MermaidBlock code={text} />
                </div>
              )
            }
            if (isInline) {
              return (
                <code
                  className="px-1 py-0.5 rounded bg-[var(--bg-base)] border border-[var(--border)] text-[0.85em]"
                  {...rest}
                >
                  {children}
                </code>
              )
            }
            return (
              <pre
                className="my-2 p-3 rounded bg-[var(--bg-base)] border border-[var(--border)] overflow-auto text-xs"
                {...offsetProps(node, trackOffsets)}
              >
                <code className={className} {...rest}>
                  {children}
                </code>
              </pre>
            )
          },
          a({ children, ...rest }) {
            return (
              <a
                {...rest}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--accent)] underline underline-offset-2"
              >
                {children}
              </a>
            )
          },
          table({ node, children }: any) {
            return (
              <div className="overflow-x-auto my-2" {...offsetProps(node, trackOffsets)}>
                <table className="border-collapse border border-[var(--border)] text-xs">
                  {children}
                </table>
              </div>
            )
          },
          th({ children }: { children?: ReactNode }) {
            return (
              <th className="border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-left">
                {children}
              </th>
            )
          },
          td({ children }: { children?: ReactNode }) {
            return (
              <td className="border border-[var(--border)] px-2 py-1">
                {children}
              </td>
            )
          },
          ul({ node, children }: any) {
            return (
              <ul className="list-disc pl-5 my-1.5 space-y-0.5" {...offsetProps(node, trackOffsets)}>
                {children}
              </ul>
            )
          },
          ol({ node, children }: any) {
            return (
              <ol className="list-decimal pl-5 my-1.5 space-y-0.5" {...offsetProps(node, trackOffsets)}>
                {children}
              </ol>
            )
          },
          h1({ node, children }: any) {
            return (
              <h1 className="text-base font-semibold mt-2 mb-1.5" {...offsetProps(node, trackOffsets)}>
                {children}
              </h1>
            )
          },
          h2({ node, children }: any) {
            return (
              <h2 className="text-[15px] font-semibold mt-2 mb-1.5" {...offsetProps(node, trackOffsets)}>
                {children}
              </h2>
            )
          },
          h3({ node, children }: any) {
            return (
              <h3 className="text-sm font-semibold mt-1.5 mb-1" {...offsetProps(node, trackOffsets)}>
                {children}
              </h3>
            )
          },
          p({ node, children }: any) {
            return (
              <p
                className="my-1.5 first:mt-0 last:mb-0 whitespace-pre-wrap"
                {...offsetProps(node, trackOffsets)}
              >
                {children}
              </p>
            )
          },
          blockquote({ node, children }: any) {
            return (
              <blockquote
                className="border-l-2 border-[var(--border)] pl-3 my-2 text-[var(--text-secondary)]"
                {...offsetProps(node, trackOffsets)}
              >
                {children}
              </blockquote>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownPreviewImpl)
