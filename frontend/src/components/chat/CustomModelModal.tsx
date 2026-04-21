import { useState, useEffect } from 'react'
import { X, CheckCircle2, XCircle } from 'lucide-react'
import { Button, Spinner } from '../ui'
import { settingsApi } from '../../api/client'

interface Props {
  provider: string
  providerLabel: string
  initialValue?: string
  onClose: () => void
  onConfirm: (modelId: string) => void
}

type VerifyState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; message: string }
  | { kind: 'fail'; message: string }

/**
 * Modal that lets the user specify a custom model id for a given provider
 * and verify it via a minimal completion call before confirming.
 */
export default function CustomModelModal({
  provider,
  providerLabel,
  initialValue = '',
  onClose,
  onConfirm,
}: Props) {
  const initTail = initialValue.startsWith(`${provider}/`)
    ? initialValue.slice(provider.length + 1)
    : initialValue
  const [value, setValue] = useState(initTail)
  const [verify, setVerify] = useState<VerifyState>({ kind: 'idle' })

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Reset verification whenever the user edits the input
  useEffect(() => {
    setVerify({ kind: 'idle' })
  }, [value])

  const trimmed = value.trim()
  const fullId = trimmed ? `${provider}/${trimmed}` : ''

  async function handleVerify() {
    if (!fullId) return
    setVerify({ kind: 'loading' })
    try {
      const res = await settingsApi.verifyModel(fullId)
      setVerify(
        res.valid
          ? { kind: 'ok', message: res.message }
          : { kind: 'fail', message: res.message },
      )
    } catch (e: any) {
      setVerify({ kind: 'fail', message: e?.message ?? '验证请求失败' })
    }
  }

  function submit() {
    if (!fullId) return
    onConfirm(fullId)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-[460px] bg-[var(--bg-surface)] border border-[var(--border)] rounded-[var(--radius-md)] shadow-xl text-[var(--text-primary)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
          <h3 className="text-sm font-medium">自定义模型</h3>
          <button
            onClick={onClose}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="text-xs text-[var(--text-secondary)]">
            平台：<span className="text-[var(--text-primary)] font-medium">{providerLabel}</span>
          </div>

          <div className="space-y-1">
            <label className="text-xs text-[var(--text-secondary)]">模型 ID</label>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 flex items-stretch border border-[var(--border)] rounded-[var(--radius-sm)] overflow-hidden focus-within:ring-1 focus-within:ring-[var(--accent)]">
                <span className="px-2 flex items-center text-xs text-[var(--text-tertiary)] bg-[var(--bg-base)] border-r border-[var(--border)] select-none">
                  {provider}/
                </span>
                <input
                  type="text"
                  autoFocus
                  spellCheck={false}
                  placeholder="e.g. qwen3-72b-instruct"
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      if (verify.kind === 'ok') submit()
                      else handleVerify()
                    }
                  }}
                  className="flex-1 px-2 py-1.5 text-sm bg-[var(--bg-surface)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
                />
              </div>
              <Button
                variant="ghost"
                onClick={handleVerify}
                disabled={!trimmed || verify.kind === 'loading'}
              >
                {verify.kind === 'loading' ? <Spinner size={12} /> : '验证'}
              </Button>
            </div>

            {verify.kind === 'ok' && (
              <div className="flex items-start gap-1.5 text-xs text-[var(--success)]">
                <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                <span>{verify.message}</span>
              </div>
            )}
            {verify.kind === 'fail' && (
              <div className="flex items-start gap-1.5 text-xs text-[var(--error)]">
                <XCircle size={13} className="mt-0.5 shrink-0" />
                <span className="break-all">{verify.message}</span>
              </div>
            )}
            {verify.kind === 'idle' && (
              <p className="text-[11px] text-[var(--text-tertiary)] leading-relaxed">
                输入平台控制台上的模型 ID（不含 provider 前缀）。建议先「验证」再确认。
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-between items-center px-4 py-3 border-t border-[var(--border)]">
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {verify.kind === 'ok'
              ? '已验证，可确认'
              : verify.kind === 'fail'
                ? '可直接确认以跳过验证'
                : ''}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>取消</Button>
            <Button onClick={submit} disabled={!trimmed}>确认</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
