import AppHeader from '@/components/AppHeader'
import '../home/dashboard.css'
import './future.css'

const glass =
  'future-panel'

const moments = [
  { when: 'Today', detail: 'A choice leaves your account, like the $500 bag.' },
  { when: 'The low point', detail: 'The day your balance is thinnest against the safety buffer.' },
  { when: 'The recovery', detail: 'The date you climb back above that buffer.' },
]

export default function FuturePage() {
  return (
    <div className="future-page">
      <AppHeader current="future" appearance="overview" />

      <main className="future-main">
        <h1>Future</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#737373]">
          Home is the live overview. Health is the life-cycle of your spending. Future is where a
          single choice shows up across the days ahead.
        </p>

        <section className={`${glass} mt-6 grid gap-6 p-5 sm:grid-cols-3 sm:p-6`}>
          {moments.map((moment) => (
            <div key={moment.when}>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#737373]">
                {moment.when}
              </p>
              <p className="mt-2 text-sm font-medium leading-relaxed text-[#171717]">
                {moment.detail}
              </p>
            </div>
          ))}
        </section>
      </main>
    </div>
  )
}
