/**
 * KnowledgeModal — wraps KnowledgePanel inside a full-screen modal so the
 * top-bar 知识库 button stays inside the workspace context.
 */
import { X } from 'lucide-react'
import KnowledgePanel from './KnowledgePanel'

interface Props {
  projectId: string
  onClose: () => void
}

export default function KnowledgeModal({ projectId, onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 bg-[var(--bg-overlay)] flex items-center justify-center p-6"
      onClick={onClose}
    >
      <div
        className="w-full h-full max-w-6xl max-h-[88vh] bg-[var(--bg-surface)] rounded-[var(--radius-lg)] border border-[var(--border)] shadow-[var(--shadow-lg)] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 rounded-full text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--text-primary)]"
          title="关闭"
        >
          <X size={16} />
        </button>
        <div className="flex-1 min-h-0 relative">
          <KnowledgePanel projectId={projectId} />
        </div>
      </div>
    </div>
  )
}
