import React from 'react'
import clsx from 'clsx'

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode
}

export function GlassCard({ children, className, ...rest }: GlassCardProps) {
  return (
    <div
      className={clsx('glass rounded-[var(--radius-lg)] p-4', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-all select-none',
        {
          'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] shadow-sm':
            variant === 'primary',
          'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--accent-light)] hover:text-[var(--accent)]':
            variant === 'ghost',
          'bg-transparent text-[var(--error)] hover:bg-red-50': variant === 'danger',
        },
        {
          'px-2.5 py-1 text-sm': size === 'sm',
          'px-4 py-2 text-sm': size === 'md',
        },
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="animate-spin text-current"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
    </svg>
  )
}

export function Badge({ label, color = 'default' }: { label: string; color?: 'default' | 'success' | 'warning' | 'error' }) {
  return (
    <span
      className={clsx('inline-block px-2 py-0.5 rounded-full text-xs font-medium', {
        'bg-gray-100 text-gray-600': color === 'default',
        'bg-green-100 text-green-700': color === 'success',
        'bg-orange-100 text-orange-700': color === 'warning',
        'bg-red-100 text-red-700': color === 'error',
      })}
    >
      {label}
    </span>
  )
}
