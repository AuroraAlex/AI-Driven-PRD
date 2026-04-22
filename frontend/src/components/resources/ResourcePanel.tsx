/**
 * ResourcePanel — unified panel for files / snippets / documents.
 *
 * Replaces the old FilePanel. Lets the user:
 *   - filter by kind (all / file / snippet / document)
 *   - upload files (drag-drop or button)
 *   - create blank documents/snippets
 *   - open documents/snippets in the standalone Markdown editor (route)
 *   - toggle membership in the knowledge base (manual indexing)
 *   - delete resources
 */
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Trash2, FileText, Image as ImageIcon, File, FilePlus, StickyNote,
  Database, DatabaseZap, Pencil,
} from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import {
  resourcesApi,
  type ResourceBlock,
  type ResourceKind,
  type ResourceRagStatus,
} from '../../api/client'
import { Button, Spinner } from '../ui'

type Filter = 'all' | ResourceKind

function fileIcon(kind: ResourceKind, fileType: string | null) {
  if (kind === 'snippet') return <StickyNote size={14} />
  if (kind === 'document') return <FileText size={14} />
  if (fileType === 'image') return <ImageIcon size={14} />
  if (fileType === 'pdf' || fileType === 'docx') return <FileText size={14} />
  return <File size={14} />
}

const STATUS_LABEL: Record<ResourceRagStatus, string> = {
  unindexed: '未入库',
  pending: '排队',
  indexing: '索引中',
  indexed: '已入库',
  failed: '失败',
}

const STATUS_CLASS: Record<ResourceRagStatus, string> = {
  unindexed: 'text-[var(--text-tertiary)]',
  pending: 'text-[var(--text-tertiary)]',
  indexing: 'text-[var(--accent)]',
  indexed: 'text-[var(--success)]',
  failed: 'text-[var(--warning)]',
}

interface Props {
  projectId: string
}

export default function ResourcePanel({ projectId }: Props) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')

  const { data: items = [] } = useQuery({
    queryKey: ['resources', projectId],
    queryFn: () => resourcesApi.list(projectId),
    refetchInterval: (q) => {
      const data = q.state.data as ResourceBlock[] | undefined
      return data?.some(r => r.rag_status === 'indexing' || r.rag_status === 'pending') ? 2000 : false
    },
  })

  const filtered = items.filter(r => filter === 'all' || r.kind === filter)

  const deleteMut = useMutation({
    mutationFn: (id: string) => resourcesApi.delete(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const indexMut = useMutation({
    mutationFn: (id: string) => resourcesApi.index(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  const unindexMut = useMutation({
    mutationFn: (id: string) => resourcesApi.unindex(projectId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resources', projectId] }),
  })

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      await resourcesApi.upload(projectId, file)
      qc.invalidateQueries({ queryKey: ['resources', projectId] })
      toast.success(`已添加文件：${file.name}`)
    } catch (err) {
      toast.error(`上传失败：${(err as Error).message}`)
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    Array.from(e.dataTransfer.files).forEach(uploadFile)
  }

  async function createBlankDocument() {
    const r = await resourcesApi.create(projectId, {
      kind: 'document',
      title: '未命名文档',
      markdown_content: '# 未命名文档\n\n',
    })
    qc.invalidateQueries({ queryKey: ['resources', projectId] })
    navigate(`/projects/${projectId}/docs/${r.id}`)
  }

  async function openItem(r: ResourceBlock) {
    if (r.kind === 'file') {
      // For files, just open document editor in read-only-ish mode (preview of extracted text)
      navigate(`/projects/${projectId}/docs/${r.id}`)
    } else {
      navigate(`/projects/${projectId}/docs/${r.id}`)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-1 px-3 py-2 border-b border-[var(--border)]">
        <span className="text-sm font-semibold text-[var(--text-primary)]">资源</span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" title="新建文档" onClick={createBlankDocument}>
            <FilePlus size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title="上传文件"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? <Spinner size={14} /> : <Upload size={14} />}
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"
          onChange={e => Array.from(e.target.files ?? []).forEach(uploadFile)}
        />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--border)]">
        {([
          { id: 'all', label: '全部' },
          { id: 'file', label: '文件' },
          { id: 'snippet', label: '片段' },
          { id: 'document', label: '文档' },
        ] as const).map(t => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={clsx(
              'text-[11px] px-1.5 py-0.5 rounded',
              filter === t.id
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-secondary)] hover:bg-[var(--accent-light)]',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div
        className={`flex-1 overflow-y-auto ${dragOver ? 'bg-[var(--accent-light)]' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] text-xs p-4 text-center gap-2">
            <Upload size={28} className="opacity-40" />
            <span>拖拽文件到此处，或点击「新建文档」</span>
            <span className="opacity-60">支持 PDF / DOCX / TXT / 图片，最大 100 MB</span>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {filtered.map(r => (
              <li
                key={r.id}
                className="flex items-center gap-2 px-3 py-2 group hover:bg-[var(--accent-light)] transition-colors"
              >
                <span className="text-[var(--text-secondary)]">
                  {fileIcon(r.kind, r.file_type)}
                </span>
                <button
                  className="flex-1 min-w-0 text-left"
                  onClick={() => openItem(r)}
                  title="打开"
                >
                  <p className="text-xs font-medium truncate text-[var(--text-primary)]">
                    {r.title || r.original_filename || '未命名'}
                  </p>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className={STATUS_CLASS[r.rag_status]}>{STATUS_LABEL[r.rag_status]}</span>
                    {r.kind === 'file' && r.file_size > 0 && (
                      <span className="text-[var(--text-tertiary)]">
                        {(r.file_size / 1024).toFixed(0)} KB
                      </span>
                    )}
                  </div>
                </button>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100">
                  {r.kind !== 'file' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="编辑"
                      onClick={() => openItem(r)}
                      className="!p-1"
                    >
                      <Pencil size={12} />
                    </Button>
                  )}
                  {r.is_in_kb ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="移出知识库"
                      onClick={() => unindexMut.mutate(r.id)}
                      className="!p-1"
                    >
                      <Database size={12} className="text-[var(--success)]" />
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      title="加入知识库"
                      onClick={() => indexMut.mutate(r.id)}
                      className="!p-1"
                    >
                      <DatabaseZap size={12} />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="danger"
                    title="删除"
                    className="!p-1"
                    onClick={() => {
                      if (confirm(`删除「${r.title}」？`)) deleteMut.mutate(r.id)
                    }}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
