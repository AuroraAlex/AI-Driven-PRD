import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, FileText, Settings } from 'lucide-react'
import { projectsApi, type Project } from '../api/client'
import { GlassCard, Button, Spinner } from '../components/ui'
import SettingsModal from '../components/ui/SettingsModal'

export default function Home() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  })

  const createMut = useMutation({
    mutationFn: () => projectsApi.create(name.trim(), desc.trim()),
    onSuccess: p => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      setCreating(false)
      setName('')
      setDesc('')
      navigate(`/workspace/${p.id}`)
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-8">
      {/* Header */}
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold text-[var(--text-primary)]">AI PRD Studio</h1>
            <p className="text-[var(--text-secondary)] mt-1 text-sm">
              Collaborative product requirements powered by AI
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowSettings(true)}>
              <Settings size={16} /> API Keys
            </Button>
            <Button onClick={() => setCreating(true)}>
              <Plus size={16} /> New Project
            </Button>
          </div>
        </div>

        {/* Settings modal */}
        {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}

        {/* Create project modal */}
        {creating && (
          <div className="fixed inset-0 bg-[var(--bg-overlay)] z-50 flex items-center justify-center">
            <GlassCard className="w-full max-w-md shadow-[var(--shadow-lg)]">
              <h2 className="text-lg font-semibold mb-4">New Project</h2>
              <input
                className="w-full border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm mb-3 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                placeholder="Project name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
              <textarea
                className="w-full border border-[var(--border)] rounded-[var(--radius-sm)] px-3 py-2 text-sm mb-4 bg-[var(--bg-surface)] text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] resize-none"
                placeholder="Description (optional)"
                rows={3}
                value={desc}
                onChange={e => setDesc(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
                <Button
                  disabled={!name.trim() || createMut.isPending}
                  onClick={() => createMut.mutate()}
                >
                  {createMut.isPending ? <Spinner size={14} /> : null}
                  Create
                </Button>
              </div>
            </GlassCard>
          </div>
        )}

        {/* Project grid */}
        {isLoading ? (
          <div className="flex justify-center py-20"><Spinner size={32} /></div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 text-[var(--text-secondary)]">
            <FileText size={48} className="mx-auto mb-3 opacity-30" />
            <p>No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map(p => (
              <ProjectCard
                key={p.id}
                project={p}
                onOpen={() => navigate(`/workspace/${p.id}`)}
                onDelete={() => deleteMut.mutate(p.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  onOpen,
  onDelete,
}: {
  project: Project
  onOpen: () => void
  onDelete: () => void
}) {
  return (
    <GlassCard
      className="cursor-pointer group hover:shadow-[var(--shadow-md)] transition-shadow"
      onClick={onOpen}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-[var(--text-primary)] truncate">{project.name}</p>
          {project.description && (
            <p className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">{project.description}</p>
          )}
          <p className="text-xs text-[var(--text-tertiary)] mt-2">
            {new Date(project.created_at).toLocaleDateString()}
          </p>
        </div>
        <Button
          variant="danger"
          size="sm"
          className="opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0"
          onClick={e => { e.stopPropagation(); onDelete() }}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </GlassCard>
  )
}
