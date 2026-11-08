import AppHeader from '@/components/AppHeader'

const glass =
  'rounded-3xl border border-white/60 bg-white/60 shadow-[0_24px_70px_-28px_rgba(245,130,31,0.45)] backdrop-blur-xl'

const moments = [
  { when: 'Today', detail: 'A choice leaves your account, like the $500 bag.' },
  { when: 'The low point', detail: 'The day your balance is thinnest against the safety buffer.' },
  { when: 'The recovery', detail: 'The date you climb back above that buffer.' },
]

export default function FuturePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fff8f1] text-slate-800">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute left-[-120px] top-1/3 h-80 w-80 rounded-full bg-amber-300/30 blur-3xl" />
        <div className="absolute bottom-[-80px] right-1/4 h-72 w-72 rounded-full bg-orange-200/50 blur-3xl" />
      </div>

      <AppHeader current="future" />

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-8">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark">Future</p>
        <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
          What the next month does to you
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-500">
          Home is the live overview. Health is the life-cycle of your spending. Future is where a
          single choice shows up across the days ahead.
        </p>

        <section className={`${glass} mt-8 grid gap-4 p-5 sm:grid-cols-3 sm:p-6`}>
          {moments.map((moment) => (
            <div key={moment.when}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {moment.when}
              </p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-700">
                {moment.detail}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
