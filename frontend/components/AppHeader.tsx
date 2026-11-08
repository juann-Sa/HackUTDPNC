'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ChevronDown, UserRound } from 'lucide-react'
import MainNav, { type AppSection } from '@/components/MainNav'

export default function AppHeader({ current, appearance }: { current: AppSection; appearance?: 'overview' }) {
  const [accountOpen, setAccountOpen] = useState(false)
  if (appearance === 'overview') return (
    <div className="pnc-dash health-header">
      <header className="topbar"><div className="nav-inner">
        <Link className="brand" href="/home" aria-label="PNC home">PNC</Link>
        <MainNav current={current} variant="dash" />
        <div className="account-wrap" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }} onKeyDown={event => { if (event.key === 'Escape') setAccountOpen(false) }}>
          <button className="account-button" aria-expanded={accountOpen} onClick={() => setAccountOpen(!accountOpen)}><span className="avatar"><UserRound size={17} /></span><span>My account</span><ChevronDown size={14} /></button>
          {accountOpen && <div className="dropdown account-menu"><Link href="/signin">Sign in</Link><button onClick={() => setAccountOpen(false)}>Close menu</button></div>}
        </div>
      </div></header>
    </div>
  )
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
          className="group flex items-center gap-3 rounded-full border border-white/60 bg-white/50 py-1.5 pl-4 pr-1.5 transition hover:bg-white/80"
        >
          <span className="hidden text-right leading-tight sm:block">
            <span className="block text-sm font-semibold text-slate-700">Alex Johnson</span>
            <span className="block text-xs text-slate-400">Premium member</span>
          </span>
          <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-brand to-brand-light text-sm font-bold text-white shadow-md ring-2 ring-white">
            AJ
            <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
          </span>
        </button>
      </div>
    </header>
  )
}
