import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import clsx from 'clsx'
import { settingsApi, type SettingsIn } from '../../api/client'
import { GlassCard, Button, Spinner } from '../ui'

interface Props {
  onClose: () => void
}

const PROVIDERS = [
  {
    key: 'openai_api_key' as keyof SettingsIn,
    id: 'openai' as const,
    label: 'OpenAI',
    placeholder: 'sk-…',
    docsHint: 'platform.openai.com/api-keys',
  },
  {
    key: 'anthropic_api_key' as keyof SettingsIn,
    id: 'anthropic' as const,
    label: 'Anthropic',
    placeholder: 'sk-ant-…',
    docsHint: 'console.anthropic.com/settings/keys',
  },
  {
    key: 'dashscope_api_key' as keyof SettingsIn,
    id: 'dashscope' as const,
    label: '阿里云百炼',
    placeholder: 'sk-…',
    docsHint: 'bailian.console.aliyun.com → API Key',
  },
]

type VerifyState = 'idle' | 'loading' | 'ok' | 'fail'

export default function SettingsModal({ onClose }: Props) {
  const qc = useQueryClient()
  const [activeProvider, setActiveProvider] = useState(0)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [verifyState, setVerifyState] = useState<VerifyState>('idle')
  const [verifyMsg, setVerifyMsg] = useState('')

  const { data: status, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
  })

  const saveMut = useMutation({
    mutationFn: (payload: SettingsIn) => settingsApi.update(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['available-models'] })
      setKeyInput('')
      setVerifyState('idle')
      setVerifyMsg('')
    },
  })

  const clearMut = useMutation({
    mutationFn: (payload: SettingsIn) => settingsApi.update(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] })
      qc.invalidateQueries({ queryKey: ['available-models'] })
    },
  })

  const current = PROVIDERS[activeProvider]
  const providerStatus = status?.[current.id]

  function handleTabChange(idx: number) {
    setActiveProvider(idx)
    setKeyInput('')
    setShowKey(false)
    setVerifyState('idle')
    setVerifyMsg('')
  }

  async function handleVerify() {
    const key = keyInput.trim()
    if (!key) return
    setVerifyState('loading')
    setVerifyMsg('')
    try {
      const res = await settingsApi.verify(current.id, key)
      setVerifyState(res.valid ? 'ok' : 'fail')
      setVerifyMsg(res.message)
    } catch {
      setVerifyState('fail')
      setVerifyMsg('请求失败，请检查后端服务')
    }
  }

  function handleSave() {
    saveMut.mutate({ [current.key]: keyInput.trim() })
  }

  function handleClear() {
    clearMut.mutate({ [current.key]: '' })
  }

  return (
    <div className="fixed inset-0 bg-[var(--bg-overlay)] z-50 flex items-center justify-center p-4">
      <GlassCard className="w-full max-w-md shadow-[var(--shadow-lg)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">API Key 配置</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Provider tabs */}
        <div className="flex gap-1 p-1 bg-[var(--bg-base)] rounded-[var(--radius-sm)] mb-5">
          {PROVIDERS.map((p, i) => {
            const st = status?.[p.id]
            return (
              <button
                key={p.id}
                onClick={() => handleTabChange(i)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-[var(--radius-sm)] text-xs font-medium transition-all',
                  activeProvider === i
                    ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-[var(--shadow-sm)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                {!isLoading && st?.configured && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] shrink-0" />
                )}
                {p.label}
              </button>
            )
          })}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner size={24} /></div>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Current status */}
            {providerStatus?.configured ? (
              <div className="flex items-center justify-between px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--accent-light)]">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-[var(--success)]" />
                  <span className="text-xs text-[var(--text-primary)]">已配置</span>
                  <span className="text-xs font-mono text-[var(--text-tertiary)]">
                    {providerStatus.preview}
                  </span>
                </div>
                <button
                  onClick={handleClear}
                  disabled={clearMut.isPending}
                  className="flex items-center gap-1 text-xs text-[var(--error)] hover:opacity-80 transition-opacity"
                >
                  {clearMut.isPending ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  移除
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] bg-[var(--bg-base)]">
                <XCircle size={14} className="text-[var(--text-tertiary)]" />
                <span className="text-xs text-[var(--text-secondary)]">未配置</span>
              </div>
            )}

            {/* Key input */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
                {providerStatus?.configured ? '输入新 Key 以替换' : '输入 API Key'}
              </label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  className={clsx(
                    'w-full border rounded-[var(--radius-sm)] px-3 py-2 pr-10 text-sm',
                    'bg-[var(--bg-surface)] text-[var(--text-primary)]',
                    'placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2',
                    verifyState === 'ok'
                      ? 'border-[var(--success)] focus:ring-[var(--success)]'
                      : verifyState === 'fail'
                        ? 'border-[var(--error)] focus:ring-[var(--error)]'
                        : 'border-[var(--border)] focus:ring-[var(--accent)]',
                  )}
                  placeholder={current.placeholder}
                  value={keyInput}
                  onChange={e => {
                    setKeyInput(e.target.value)
                    setVerifyState('idle')
                    setVerifyMsg('')
                  }}
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleVerify()
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowKey(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <p className="text-xs text-[var(--text-tertiary)] mt-1">{current.docsHint}</p>
            </div>

            {/* Verify result */}
            {verifyMsg && (
              <div className={clsx(
                'flex items-center gap-2 text-xs px-3 py-2 rounded-[var(--radius-sm)]',
                verifyState === 'ok'
                  ? 'bg-green-50 text-[var(--success)] dark:bg-green-950/30'
                  : 'bg-red-50 text-[var(--error)] dark:bg-red-950/30',
              )}>
                {verifyState === 'ok'
                  ? <CheckCircle2 size={13} />
                  : <XCircle size={13} />}
                {verifyMsg}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1 border-t border-[var(--border)]">
              <Button
                variant="ghost"
                onClick={handleVerify}
                disabled={!keyInput.trim() || verifyState === 'loading'}
                className="flex-1"
              >
                {verifyState === 'loading'
                  ? <><Loader2 size={13} className="animate-spin" /> 验证中…</>
                  : '验证'}
              </Button>
              <Button
                onClick={handleSave}
                disabled={!keyInput.trim() || verifyState !== 'ok' || saveMut.isPending}
                className="flex-1"
              >
                {saveMut.isPending ? <Spinner size={13} /> : null}
                保存
              </Button>
            </div>
            {saveMut.isSuccess && (
              <p className="text-xs text-[var(--success)] text-center -mt-1">已保存 ✓</p>
            )}
          </div>
        )}
      </GlassCard>
    </div>
  )
}

