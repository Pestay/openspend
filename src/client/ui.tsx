import type { ButtonHTMLAttributes, ReactNode } from 'react'

export function Card({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-500">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export const inputClass = 'rounded border border-slate-300 px-2 py-1.5 text-sm'

const variants = {
  primary: 'bg-emerald-700 text-white hover:bg-emerald-800',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variants }) {
  return (
    <button
      className={`rounded px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
      {...props}
    />
  )
}

export function ErrorText({ error }: { error: Error | null }) {
  return error ? <p className="mt-2 text-sm text-rose-600">{error.message}</p> : null
}
