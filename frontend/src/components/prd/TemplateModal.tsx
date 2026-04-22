import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileDown, Presentation, FileText, Sparkles } from 'lucide-react'
import { documentsApi, exportApi, type PRDDocument } from '../../api/client'
import { usePRDStore } from '../../store/prdStore'
import { Button, Spinner } from '../ui'

const TEMPLATES = [
  { value: 'agile', label: 'Agile / User Stories' },
  { value: 'aspice', label: 'ASPICE' },
  { value: 'ieee_srs', label: 'IEEE 830 SRS' },
  { value: 'custom', label: 'Custom' },
]

interface Props {
  projectId: string
  onOpen: (prd: PRDDocument) => void
}

export default function TemplateModal({ projectId, onOpen }: Props) {
  const { documents, generating, setDocuments, upsert, setGenerating } = usePRDStore()
  const [selectedTemplate, setSelectedTemplate] = useState('agile')
  const [model, setModel] = useState('openai/gpt-4o')
  const [showPicker, setShowPicker] = useState(false)

  const { data: docList } = useQuery({
    queryKey: ['prd-list', projectId],
    queryFn: () => documentsApi.list(projectId),
  })
  useEffect(() => {
    if (docList) setDocuments(docList)
  }, [docList, setDocuments])

  async function generate() {
    setGenerating(true)
    setShowPicker(false)
    let prdId = ''
    let buffer = ''

    try {
      const res = await documentsApi.generate(projectId, selectedTemplate, model)
      prdId = res.headers.get('X-PRD-ID') ?? ''
      if (!res.body) throw new Error('No body')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let chunk = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunk += decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')
        chunk = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'token') buffer += evt.data
          } catch (_) { /* skip */ }
        }
      }

      if (prdId) {
        const prd = await documentsApi.get(projectId, prdId)
        upsert(prd)
        onOpen(prd)
      }
    } catch (err) {
      console.error('PRD generation failed', err)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 p-3">
      <Button onClick={() => setShowPicker(true)} disabled={generating}>
        {generating ? <Spinner size={14} /> : <Sparkles size={14} />}
        Generate PRD
      </Button>

      {showPicker && (
        <div className="fixed inset-0 bg-[var(--bg-overlay)] z-50 flex items-center justify-center">
          <div className="glass rounded-[var(--radius-lg)] p-5 w-80 shadow-[var(--shadow-lg)]">
            <h3 className="font-semibold mb-3 text-sm">Choose Template</h3>
            <div className="flex flex-col gap-1.5 mb-4">
              {TEMPLATES.map(t => (
                <label key={t.value} className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="radio"
                    name="template"
                    value={t.value}
                    checked={selectedTemplate === t.value}
                    onChange={() => setSelectedTemplate(t.value)}
                  />
                  {t.label}
                </label>
              ))}
            </div>
            <select
              className="w-full text-xs border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1.5 mb-4 bg-white focus:outline-none"
              value={model}
              onChange={e => setModel(e.target.value)}
            >
              <option value="openai/gpt-4o">GPT-4o</option>
              <option value="openai/gpt-4o-mini">GPT-4o mini</option>
              <option value="anthropic/claude-sonnet-4-5">Claude 3.5 Sonnet</option>
            </select>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowPicker(false)}>Cancel</Button>
              <Button size="sm" onClick={generate}>Generate</Button>
            </div>
          </div>
        </div>
      )}

      {/* PRD list */}
      {documents.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          <p className="text-xs text-[var(--text-secondary)] font-medium px-1">Saved PRDs</p>
          {documents.map(d => (
            <button
              key={d.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--accent-light)] text-left transition-colors"
              onClick={() => onOpen(d)}
            >
              <FileText size={13} className="text-[var(--accent)]" />
              <span className="text-xs flex-1 truncate text-[var(--text-primary)]">{d.title}</span>
              <ExportMenu prdId={d.id} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ExportMenu({ prdId }: { prdId: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        className="text-[var(--text-tertiary)] hover:text-[var(--accent)] p-0.5"
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        title="Export"
      >
        <FileDown size={13} />
      </button>
      {open && (
        <div className="absolute right-0 top-5 glass rounded-[var(--radius-sm)] shadow-[var(--shadow-md)] py-1 z-10 w-28">
          <a
            href={exportApi.docx(prdId)}
            download
            className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--accent-light)] text-[var(--text-primary)]"
            onClick={() => setOpen(false)}
          >
            <FileText size={12} /> DOCX
          </a>
          <a
            href={exportApi.pdf(prdId)}
            download
            className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--accent-light)] text-[var(--text-primary)]"
            onClick={() => setOpen(false)}
          >
            <FileDown size={12} /> PDF
          </a>
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--accent-light)] text-[var(--text-primary)]"
            onClick={async () => {
              setOpen(false)
              const blob = await exportApi.pptx(prdId)
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = 'presentation.pptx'
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            <Presentation size={12} /> PPTX
          </button>
        </div>
      )}
    </div>
  )
}
