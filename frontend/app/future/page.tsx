'use client'

import AppHeader from '@/components/AppHeader'
import '../home/dashboard.css'
import './future.css'
import LiveDataProvider, { useLiveData } from '@/components/live-data-provider'
import { futureFor, prettyDate } from '@/lib/live-data'

const glass =
  'future-panel'

const usd = (cents: number) => `${cents < 0 ? '−' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`
const pct = (x: number) => (x > 0 && x < 0.01 ? '<1%' : `${Math.round(100 * x)}%`)

export default function FuturePage() {
  return (
    <LiveDataProvider>
      <FutureInner />
    </LiveDataProvider>
  )
}

function FutureInner() {
  const { data, customerId, error } = useLiveData()
  const f = data ? futureFor(data) : null
  const hasForecast = !!f?.today

  return (
    <div className="future-page">
      <AppHeader current="future" />

      <main className="future-main">
        <h1>Future</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#737373]">
          Where your money is likely to be thinnest, when it recovers, which days carry real risk, and what could knock you
          off course. All from thousands of simulated futures built on your own history.
        </p>

        {error && <p className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Can&rsquo;t load live data: {error}</p>}
        {data && !hasForecast && (
          <p className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No forecast for {customerId} yet. Run <code>run_forecast</code> for this customer.
          </p>
        )}

        {f && hasForecast && (
          <>
            <section className={`${glass} mt-8 grid gap-6 p-5 sm:grid-cols-3 sm:p-6`} aria-label="Key moments">
              <Moment when="Today" title={usd(f.today!.cents)} detail={`Net cash (cash minus high-interest debt) on ${prettyDate(f.today!.date)}.`} />
              {f.low && f.low.cents < f.today!.cents ? (
                <Moment
                  when="The low point"
                  title={`${usd(f.low.cents)} · ${prettyDate(f.low.date)}`}
                  detail={`Your thinnest day in the next 180, in ${f.low.day} days. In a bad case (1 in 20) it could be ${usd(f.low.lowCents)}.`}
                />
              ) : (
                <Moment when="The low point" title="Today" detail="Your money is expected to grow from here; today is the thinnest point." />
              )}
              {f.low && f.low.cents < f.today!.cents ? (
                f.recovery ? (
                  <Moment when="The recovery" title={prettyDate(f.recovery.date)} detail={`Back to today's level ${f.recovery.day - f.low.day} days after the low point.`} />
                ) : (
                  <Moment when="The recovery" title="Not within 180 days" detail="At today's pace you don't get back to today's level. The coach's plan on the dashboard shows what would change that." />
                )
              ) : (
                <Moment when="The recovery" title="Not needed" detail="No dip below today's level is expected." />
              )}
            </section>

            <section className={`${glass} mt-6 p-5 sm:p-6`}>
              <h2 className="text-lg font-medium text-[#171717]">Days to watch</h2>
              <p className="text-sm text-[#737373]">Stretches when your checking account has a real chance of dropping under $100, and the bills that land then.</p>
              {f.riskyDays.length ? (
                <ul className="mt-4 divide-y divide-slate-900/5">
                  {f.riskyDays.map((d) => (
                    <li key={d.start} className="flex flex-wrap items-center justify-between gap-3 py-3">
                      <div>
                        <p className="font-semibold text-[#171717]">{d.days > 1 ? `${prettyDate(d.start)} – ${prettyDate(d.end)}` : prettyDate(d.start)}</p>
                        <p className="text-xs text-[#737373]">{d.days > 1 ? `${d.days} days · ` : ''}{d.reasons ? `Bills then: ${d.reasons}` : 'After earlier bills'}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-xs font-medium ${d.pBelow >= 0.2 ? 'bg-rose-100 text-rose-700' : d.pBelow >= 0.05 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        up to {pct(d.pBelow)} chance
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm font-medium text-emerald-700">No day in the next 180 has even a 1% chance of checking dropping under $100.</p>
              )}
            </section>

            {f.stress.length > 0 && (
              <section className={`${glass} mt-6 p-5 sm:p-6`}>
                <h2 className="text-lg font-medium text-[#171717]">What could knock you off course</h2>
                <p className="text-sm text-[#737373]">The same forecast under a few shocks: chance cash drops under {usd(f.stress[0].thresholdCents)}, and typical cash at the end.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  {f.stress.map((s) => (
                    <div key={s.label} className="rounded-2xl border border-white/70 bg-white/70 p-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#737373]">{s.label}</p>
                      <p className={`mt-2 text-2xl font-medium ${s.pLow >= 0.2 ? 'text-rose-600' : s.pLow >= 0.05 ? 'text-amber-600' : 'text-[#171717]'}`}>{pct(s.pLow)}</p>
                      <p className="text-xs text-[#737373]">chance of running low · ends near {usd(s.endCents)}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
            <p className="mt-4 text-[11px] text-[#737373]">Forecasts are ranges, not promises. Educational tool using synthetic data — not financial advice.</p>
          </>
        )}
      </main>
    </div>
  )
}

function Moment({ when, title, detail }: { when: string; title: string; detail: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#737373]">{when}</p>
      <p className="mt-2 text-xl font-medium text-[#171717]">{title}</p>
      <p className="mt-1 text-sm font-medium leading-relaxed text-slate-600">{detail}</p>
    </div>
  )
}
