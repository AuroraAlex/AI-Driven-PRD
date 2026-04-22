/**
 * ProjectOverview — dedicated project hub reached via the top-bar "PRD" button.
 *
 * Shows:
 *   - Project header + back to workspace
 *   - PRD list (documents originating from a PRD template) with quick open
 *   - Resource & session statistics
 *   - Quick actions (generate new PRD, enter workspace)
 *
 * Generation logic itself is unchanged — we keep the existing TemplateModal
 * component for triggering PRD generation. This page is intentionally
 * read-and-navigate only.
 */
import { useMemo } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft, FileText, Files, MessageSquare, LayoutPanelLeft,
  Loader2, ChevronRight,
} from 'lucide-react'
import {
  projectsApi, resourcesApi, canvasSessionsApi, chatSessionsApi,
  type ResourceBlock,
} from '../api/client'
import { Button, GlassCard } from '../components/ui'
import TemplateModal from '../components/prd/TemplateModal'

export default function ProjectOverview() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  })
  const { data: resources = [], isLoading: resLoading } = useQuery({
    queryKey: ['resources', projectId],
    queryFn: () => resourcesApi.list(projectId!),
    enabled: !!projectId,
  })
  const { data: canvasSessions = [] } = useQuery({
    queryKey: ['canvas-sessions', projectId],
    queryFn: () => canvasSessionsApi.list(projectId!),
    enabled: !!projectId,
  })
  const { data: chatSessions = [] } = useQuery({
    queryKey: ['chat-sessions', projectId],
    queryFn: () => chatSessionsApi.list(projectId!),
    enabled: !!projectId,
  })

  const { prds, fileCount, snippetCount, docCount } = useMemo(() => {
    const prds: ResourceBlock[] = []
    let fileCount = 0, snippetCount = 0, docCount = 0
    for (const r of resources) {
      if (r.kind === 'file') fileCount++
      else if (r.kind === 'snippet') snippetCount++
      else if (r.kind === 'document') {
        docCount++
        if (r.origin_type === 'prd_template') prds.push(r)
      }
    }
    prds.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return { prds, fileCount, snippetCount, docCount }
  }, [resources])

  if (!projectId) return null

  return (
    <div className="min-h-screen bg-[var(--bg-base)] p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(`/workspace/${projectId}`)}
            className="text-[var(--text-secondary)] hover:text-[var(--accent)] transition-colors"
            title="返回工作区"
          >
            <ArrowLeft size={18} />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold text-[var(--text-primary)] truncate">
              {project?.name ?? '…'}
            </h1>
            {project?.description && (
              <p className="text-[var(--text-secondary)] mt-0.5 text-sm truncate">
                {project.description}
              </p>
            )}
          </div>
          <Button onClick={() => navigate(`/workspace/${projectId}`)}>
            <LayoutPanelLeft size={14} /> 进入工作区
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <Stat label="PRD" value={prds.length} icon={<FileText size={16} />} />
          <Stat label="资源文件" value={fileCount + snippetCount + docCount} icon={<Files size={16} />}
            sub={`${fileCount} 文件 · ${snippetCount} 片段 · ${docCount} 文档`} />
          <Stat label="画布" value={canvasSessions.length} icon={<LayoutPanelLeft size={16} />} />
          <Stat label="对话" value={chatSessions.length} icon={<MessageSquare size={16} />} />
        </div>

        {/* PRD list + Generation */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <GlassCard className="p-0 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">PRD 文档</h2>
                <span className="text-xs text-[var(--text-tertiary)]">{prds.length} 个</span>
              </div>
              <div className="max-h-[60vh] overflow-y-auto">
                {resLoading ? (
                  <div className="flex items-center justify-center py-10 text-[var(--text-tertiary)]">
                    <Loader2 size={16} className="animate-spin" />
                  </div>
                ) : prds.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center text-[var(--text-tertiary)] text-sm gap-2">
                    <FileText size={36} className="opacity-30" />
                    <p>尚未生成 PRD</p>
                    <p className="text-xs opacity-70">使用右侧「生成 PRD」从模板创建</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-[var(--border)]">
                    {prds.map(p => (
                      <li
                        key={p.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--accent-light)] transition-colors cursor-pointer"
                        onClick={() => navigate(`/projects/${projectId}/docs/${p.id}`)}
                      >
                        <FileText size={16} className="text-[var(--accent)] shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                            {p.title || '未命名 PRD'}
                          </p>
                          <p className="text-[11px] text-[var(--text-tertiary)] mt-0.5">
                            {p.template_type ?? 'PRD'} · 更新于 {formatDate(p.updated_at)}
                          </p>
                        </div>
                        <ChevronRight size={14} className="text-[var(--text-tertiary)]" />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </GlassCard>
          </div>

          <div>
            <GlassCard className="p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--border)]">
                <h2 className="text-sm font-semibold text-[var(--text-primary)]">生成 PRD</h2>
              </div>
              <TemplateModal
                projectId={projectId}
                onOpen={prd => navigate(`/projects/${projectId}/docs/${prd.id}`)}
              />
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  )
}

function Stat({
  label, value, icon, sub,
}: { label: string; value: number; icon: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-md)] px-4 py-3">
      <div className="flex items-center gap-2 text-[var(--text-secondary)] text-xs">
        <span className="text-[var(--accent)]">{icon}</span>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
      {sub && <div className="mt-0.5 text-[10px] text-[var(--text-tertiary)]">{sub}</div>}
    </div>
  )
}

function formatDate(s: string): string {
  try {
    return new Date(s).toLocaleString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch { return s }
}
