import { useCanvasStore } from '../../store/canvasStore'
import { userJourneyMapElements } from './templates/userJourneyMap'
import { featureBreakdownElements } from './templates/featureBreakdown'
import { mindMapStarterElements } from './templates/mindMapStarter'

const TEMPLATES = [
  {
    id: 'user_journey',
    title: '用户旅程图',
    desc: '5 个阶段泳道 + 便签占位',
    emoji: '🗺️',
    fn: userJourneyMapElements,
  },
  {
    id: 'feature_breakdown',
    title: '功能分解图',
    desc: 'Epic → Feature → User Story 三层结构',
    emoji: '🌳',
    fn: featureBreakdownElements,
  },
  {
    id: 'mind_map',
    title: '思维导图起点',
    desc: '中心主题 + 5 分支 + 10 子节点',
    emoji: '🧠',
    fn: mindMapStarterElements,
  },
]

export default function CanvasTemplateModal() {
  const { api, showTemplatePicker, setShowTemplatePicker } = useCanvasStore()

  if (!showTemplatePicker) return null

  function applyTemplate(fn: () => ReturnType<typeof userJourneyMapElements>) {
    if (!api) return
    const elements = fn()
    api.updateScene({
      elements: elements as never[],
      appState: { scrollX: 0, scrollY: 0 },
    })
    setShowTemplatePicker(false)
    // Scroll to content after a tick so elements are rendered
    setTimeout(() => api.scrollToContent(), 80)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)' }}
      onClick={() => setShowTemplatePicker(false)}
    >
      <div
        className="bg-[var(--bg-surface)] rounded-[var(--radius)] shadow-2xl p-6 w-[560px]"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-[var(--text-primary)] mb-1">选择画布模板</h2>
        <p className="text-xs text-[var(--text-tertiary)] mb-5">
          选择后将替换当前画布内容，不可撤销——建议先保存版本。
        </p>

        <div className="grid grid-cols-3 gap-3">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              className="flex flex-col items-center gap-2 p-4 rounded-[var(--radius-sm)] border border-[var(--border)]
                         hover:border-[var(--accent)] hover:bg-[var(--accent-light)] transition-colors text-left"
              onClick={() => applyTemplate(t.fn)}
            >
              <span className="text-3xl">{t.emoji}</span>
              <span className="text-xs font-semibold text-[var(--text-primary)]">{t.title}</span>
              <span className="text-[11px] text-[var(--text-tertiary)] text-center">{t.desc}</span>
            </button>
          ))}
        </div>

        <button
          className="mt-5 w-full text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors py-1"
          onClick={() => setShowTemplatePicker(false)}
        >
          取消
        </button>
      </div>
    </div>
  )
}
