import { useEffect, useRef, useState, memo } from 'react'
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
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svg, setSvg] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    ensureMermaid()
    const id = `mmd-${Math.random().toString(36).slice(2, 10)}`
    mermaid
      .render(id, code)
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg)
          setError(null)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(String(err?.message ?? err))
      })
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
      ref={ref}
      className="my-2 flex justify-center [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}

interface Props {
  content: string
}

function MarkdownMessageImpl({ content }: Props) {
  return (
    <div className="markdown-body text-sm leading-relaxed break-words">
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
              return <MermaidBlock code={text} />
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
              <pre className="my-2 p-3 rounded bg-[var(--bg-base)] border border-[var(--border)] overflow-auto text-xs">
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
          table({ children }) {
            return (
              <div className="overflow-x-auto my-2">
                <table className="border-collapse border border-[var(--border)] text-xs">
                  {children}
                </table>
              </div>
            )
          },
          th({ children }) {
            return (
              <th className="border border-[var(--border)] bg-[var(--bg-base)] px-2 py-1 text-left">
                {children}
              </th>
            )
          },
          td({ children }) {
            return (
              <td className="border border-[var(--border)] px-2 py-1">
                {children}
              </td>
            )
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>
          },
          h1({ children }) {
            return <h1 className="text-base font-semibold mt-2 mb-1.5">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="text-[15px] font-semibold mt-2 mb-1.5">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="text-sm font-semibold mt-1.5 mb-1">{children}</h3>
          },
          p({ children }) {
            return <p className="my-1.5 first:mt-0 last:mb-0 whitespace-pre-wrap">{children}</p>
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-[var(--border)] pl-3 my-2 text-[var(--text-secondary)]">
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

export default memo(MarkdownMessageImpl)
