'use client'

import { useMemo } from 'react'
import AppHeader from '@/components/AppHeader'
import CashflowEqualizer from '@/components/CashflowEqualizer'
import LiveDataProvider, { useLiveData } from '@/components/live-data-provider'
import { equalizerFor } from '@/lib/what-if'

export default function WhatIfPage() {
  return (
    <LiveDataProvider>
      <WhatIfInner />
    </LiveDataProvider>
  )
}

function WhatIfInner() {
  const { data, error, loading } = useLiveData()
  const plan = useMemo(() => (data ? equalizerFor(data) : null), [data])

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fff8f1] text-slate-800">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute left-[-120px] top-1/3 h-80 w-80 rounded-full bg-amber-300/30 blur-3xl" />
        <div className="absolute bottom-[-80px] right-1/4 h-72 w-72 rounded-full bg-orange-200/50 blur-3xl" />
      </div>

      <AppHeader current="whatif" />

      <main className="relative z-10 mx-auto max-w-5xl px-6 pb-16 pt-10">
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">What the next month does to you</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500">
          These bars are this customer&apos;s latest month. Slide one, then simulate the next 30 days of checking.
        </p>

        {error && <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Can&rsquo;t load live data: {error}</p>}
        {loading && !data && <p className="mt-8 text-sm text-slate-400">Loading this customer&apos;s month…</p>}
        {data && !plan && <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No transactions yet for this customer.</p>}
        {plan && <CashflowEqualizer plan={plan} />}
      </main>
    </div>
  )
}
