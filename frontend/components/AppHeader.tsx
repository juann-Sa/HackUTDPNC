'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import MainNav, { type AppSection } from '@/components/MainNav'
import { endSession, getSession } from '@/lib/demo-session'

export default function AppHeader({ current }: { current: AppSection }) {
  const router = useRouter()
  const [user, setUser] = useState<{ email: string; name?: string } | null>(null)
  const [customer, setCustomer] = useState('C006')
  useEffect(() => {
    setUser(getSession())
    try { setCustomer(localStorage.getItem('pnc-navigator-customer-v1') || 'C006') } catch { /* storage unavailable */ }
  }, [])
  const display = user ? user.name || user.email : 'Guest'
  const initials = display.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((s) => s[0]!.toUpperCase()).join('') || 'G'
  return (
    <header className="sticky top-0 z-30 border-b border-white/50 bg-white/60 backdrop-blur-xl">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <Link href="/home" className="flex items-center gap-3" aria-label="PNC home">
          <span className="text-xl font-extrabold tracking-[0.15em] text-brand">PNC</span>
          <span className="hidden items-center gap-3 sm:flex">
            <span className="h-5 w-px bg-slate-300" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-500">360° Financial Advisor</span>
          </span>
        </Link>

        <MainNav current={current} variant="life" />

        <button
          type="button"
          title={user ? 'Sign out' : 'Sign in'}
          onClick={() => { if (user) endSession(); router.push('/signin') }}
          className="group flex items-center gap-3 rounded-full border border-white/60 bg-white/50 py-1.5 pl-4 pr-1.5 transition hover:bg-white/80"
        >
          <span className="hidden text-right leading-tight sm:block">
            <span className="block text-sm font-semibold text-slate-700">{display}</span>
            <span className="block text-xs text-slate-400">Viewing {customer} · {user ? 'Sign out' : 'Sign in'}</span>
          </span>
          <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-sm font-bold text-white shadow-md ring-2 ring-white">
            {initials}
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
          </span>
        </button>
      </div>
    </header>
  )
}
