import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, FileText, Image, File } from 'lucide-react'
import { filesApi, type Attachment } from '../../api/client'
import { Button, Badge, Spinner } from '../ui'

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  indexing: 'warning',
  indexed: 'success',
  failed: 'error',
}

function fileIcon(type: string) {
  if (type === 'image') return <Image size={14} />
  if (type === 'pdf' || type === 'docx') return <FileText size={14} />
  return <File size={14} />
}

interface Props {
  projectId: string
}

export default function FilePanel({ projectId }: Props) {
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const { data: files = [] } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => filesApi.list(projectId),
    refetchInterval: (query) => {
      const data = query.state.data as Attachment[] | undefined
      return data?.some(f => f.rag_status === 'indexing') ? 2000 : false
    },
  })

  const deleteMut = useMutation({
    mutationFn: (fileId: string) => filesApi.delete(projectId, fileId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['files', projectId] }),
  })

  async function uploadFile(file: File) {
    setUploading(true)
    try {
      await filesApi.upload(projectId, file)
      qc.invalidateQueries({ queryKey: ['files', projectId] })
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    Array.from(e.dataTransfer.files).forEach(uploadFile)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <span className="text-sm font-semibold text-[var(--text-primary)]">Files</span>
        <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? <Spinner size={14} /> : <Upload size={14} />}
          Upload
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          multiple
          accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.jpeg,.webp"
          onChange={e => Array.from(e.target.files ?? []).forEach(uploadFile)}
        />
      </div>

      {/* Drop zone */}
      <div
        className={`flex-1 overflow-y-auto ${dragOver ? 'bg-[var(--accent-light)]' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)] text-xs p-4 text-center gap-2">
            <Upload size={28} className="opacity-40" />
            <span>Drop files here or click Upload</span>
            <span className="opacity-60">PDF, DOCX, TXT, images — max 100 MB</span>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {files.map(f => (
              <li key={f.id} className="flex items-center gap-2 px-4 py-2.5 group hover:bg-[var(--accent-light)] transition-colors">
                <span className="text-[var(--text-secondary)]">{fileIcon(f.file_type)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate text-[var(--text-primary)]">{f.original_name}</p>
                  <p className="text-[10px] text-[var(--text-tertiary)]">{(f.file_size / 1024).toFixed(0)} KB</p>
                </div>
                <Badge label={f.rag_status} color={STATUS_COLOR[f.rag_status] ?? 'default'} />
                <Button
                  variant="danger"
                  size="sm"
                  className="opacity-0 group-hover:opacity-100 p-1"
                  onClick={() => deleteMut.mutate(f.id)}
                >
                  <Trash2 size={12} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
