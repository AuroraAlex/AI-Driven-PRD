/**
 * DocumentEditor — full-page Markdown editor for a ResourceBlock
 * (kind=document or kind=snippet).
 *
 * Features:
 *   - Title editing
 *   - Live MarkdownEditor (CodeMirror + preview, supports mermaid/latex)
 *   - 2s debounced autosave -> resourcesApi.update
 *   - Toggle membership in the knowledge base
 *   - Back link to workspace
 */
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Database, DatabaseZap, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { resourcesApi, type ResourceBlock } from '../api/client'
import { Button } from '../components/ui'
import MarkdownEditor from '../components/markdown/MarkdownEditor'

export default function DocumentEditor() {
  const { projectId, resourceId } = useParams<{ projectId: string; resourceId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: doc, isLoading } = useQuery<ResourceBlock>({
    queryKey: ['resource', projectId, resourceId],
    queryFn: () => resourcesApi.get(projectId!, resourceId!),
    enabled: !!projectId && !!resourceId,
  })

  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  const initRef = useRef(false)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    if (doc && !initRef.current) {
      setTitle(doc.title)
      setBody(doc.markdown_content || '')
      initRef.current = true
    }
  }, [doc])

  const updateMut = useMutation({
    mutationFn: (payload: { title?: string; markdown_content?: string }) =>
      resourcesApi.update(projectId!, resourceId!, payload),
    onMutate: () => setSaving(true),
    onSuccess: (data) => {
      setSavedAt(new Date())
      qc.setQueryData(['resource', projectId, resourceId], data)
      qc.invalidateQueries({ queryKey: ['resources', projectId] })
    },
    onError: (e) => toast.error(`保存失败：${(e as Error).message}`),
    onSettled: () => setSaving(false),
  })

  const indexMut = useMutation({
    mutationFn: () =>
      doc?.is_in_kb
        ? resourcesApi.unindex(projectId!, resourceId!)
        : resourcesApi.index(projectId!, resourceId!),
    onSuccess: (data) => {
      qc.setQueryData(['resource', projectId, resourceId], data)
      qc.invalidateQueries({ queryKey: ['resources', projectId] })
      toast.success(data.is_in_kb ? '已加入知识库' : '已移出知识库')
    },
  })

  function scheduleSave(next: { title?: string; markdown_content?: string }) {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => updateMut.mutate(next), 1500)
  }

  function onTitleChange(v: string) {
    setTitle(v)
    scheduleSave({ title: v, markdown_content: body })
  }

  function onBodyChange(v: string) {
    setBody(v)
    scheduleSave({ title, markdown_content: v })
  }

  if (isLoading || !doc) {
    return (
      <div className="flex items-center justify-center h-screen text-[var(--text-tertiary)]">
        <Loader2 className="animate-spin" size={20} />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen bg-[var(--bg-primary)]">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-white">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate(`/workspace/${projectId}`)}
        >
          <ArrowLeft size={14} /> 返回
        </Button>
        <input
          className="flex-1 text-base font-semibold bg-transparent outline-none border-b border-transparent focus:border-[var(--accent)] py-1"
          value={title}
          onChange={e => onTitleChange(e.target.value)}
          placeholder="文档标题"
        />
        <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
          {saving ? (
            <span className="flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> 保存中…</span>
          ) : savedAt ? (
            <span>已保存 {savedAt.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => indexMut.mutate()}
          title={doc.is_in_kb ? '从知识库移除' : '加入知识库'}
        >
          {doc.is_in_kb
            ? <><Database size={14} className="text-[var(--success)]" /> 已入库</>
            : <><DatabaseZap size={14} /> 加入知识库</>}
        </Button>
      </header>
      <div className="flex-1 min-h-0">
        <MarkdownEditor
          value={body}
          onChange={onBodyChange}
          className="h-full"
        />
      </div>
    </div>
  )
}
