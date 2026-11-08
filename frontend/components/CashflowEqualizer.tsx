'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BARS,
  amountsFrom,
  dayLabel,
  monthLabel,
  projectCash,
  type Amounts,
  type BarKey,
  type EqualizerPlan,
} from '@/lib/what-if'

const STEP = 1_000
const glass =
  'rounded-3xl border border-white/60 bg-white/60 shadow-[0_24px_70px_-28px_rgba(245,130,31,0.45)] backdrop-blur-xl'

function formatUSD(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  return `${sign}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`
}

function lowestDay(series: number[]): number {
  return series.reduce((best, value, index) => (value < series[best] ? index : best), 0)
}

function recoveryAfter(series: number[], lowDay: number, buffer: number): number | null {
  if (series[lowDay] >= buffer) return null
  for (let day = lowDay + 1; day < series.length; day++) {
    if (series[day] >= buffer) return day
  }
  return null
}

function describe(plan: EqualizerPlan, amounts: Amounts, series: number[], lowDay: number, recovery: number | null): string {
  const changes = plan.bars
    .map((bar) => ({ label: bar.label, delta: amounts[bar.key] - bar.cents }))
    .filter((change) => change.delta !== 0)
  const low = series[lowDay]
  const when = dayLabel(plan.asOf, lowDay)
  const buffer = plan.bufferCents
  const move = changes
    .map((change) => `${change.delta > 0 ? 'raising' : 'lowering'} ${change.label} by ${formatUSD(Math.abs(change.delta))}`)
    .join(' and ')

  if (!changes.length) {
    if (buffer == null) return `This is ${monthLabel(plan.month)} replayed. The thinnest day is ${when}, with ${formatUSD(low)} left in checking.`
    return low >= buffer
      ? `This is ${monthLabel(plan.month)} replayed. The thinnest day is ${when}, with ${formatUSD(low)} left, still above the ${formatUSD(buffer)} line.`
      : `This is ${monthLabel(plan.month)} replayed. On ${when} checking would be ${formatUSD(low)}, ${formatUSD(buffer - low)} under the ${formatUSD(buffer)} line.`
  }

  const lead = move.charAt(0).toUpperCase() + move.slice(1)
  if (buffer == null) return `${lead}. The thinnest day is ${when}, with ${formatUSD(low)} left in checking.`
  if (low >= buffer) return `${lead} still keeps checking above the ${formatUSD(buffer)} line. The thinnest day is ${when}, with ${formatUSD(low)} left.`
  if (recovery == null) return `${lead} leaves checking under the ${formatUSD(buffer)} line through the end of the month. The low point is ${when}, at ${formatUSD(low)}.`
  return `${lead} pulls checking under the ${formatUSD(buffer)} line. On ${when} you would have ${formatUSD(low)} left, ${formatUSD(buffer - low)} under the line, and you clear it again on ${dayLabel(plan.asOf, recovery)}.`
}

function valueFromPointer(clientY: number, rect: DOMRect, max: number): number {
  const ratio = (rect.bottom - clientY) / rect.height
  const raw = Math.min(max, Math.max(0, ratio * max))
  return Math.round(raw / STEP) * STEP
}

function SpendingBar({
  label,
  value,
  plan,
  coach,
  max,
  showChange,
  coachRun,
  onChange,
}: {
  label: string
  value: number
  plan: number
  coach: number
  max: number
  showChange: boolean
  coachRun: number
  onChange: (next: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const delta = value - plan
  const overCoach = value > coach + 500
  const heightOf = (cents: number) => (cents <= 0 || max <= 0 ? '0px' : `max(12px, calc(${(cents / max) * 100}% - 8px))`)

  function applyPointer(clientY: number) {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return
    onChange(valueFromPointer(clientY, rect, max))
  }

  return (
    <div className="flex w-16 flex-col items-center sm:w-20">
      <p className="mb-3 text-sm font-bold tabular-nums text-slate-800 sm:text-base">{formatUSD(value)}</p>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={Math.round(max / 100)}
        aria-valuenow={Math.round(value / 100)}
        aria-valuetext={formatUSD(value)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          applyPointer(event.clientY)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) applyPointer(event.clientY)
        }}
        onKeyDown={(event) => {
          const jump = event.shiftKey ? STEP * 10 : STEP
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            event.preventDefault()
            onChange(Math.min(max, value + jump))
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            event.preventDefault()
            onChange(Math.max(0, value - jump))
          }
        }}
        className="relative h-72 w-full cursor-ns-resize touch-none rounded-[26px] border border-slate-200 bg-white shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-brand sm:h-80"
      >
        {showChange && plan > 0 && (
          <span
            className="absolute right-1.5 left-1.5 z-10 border-t-2 border-dashed border-slate-500"
            style={{ bottom: `calc(4px + ${heightOf(plan)})` }}
          />
        )}
        <span
          className={`absolute right-1 bottom-1 left-1 rounded-[16px] ${overCoach ? 'bg-rose-500' : 'bg-brand'}`}
          style={{ height: heightOf(value) }}
        />
        {coachRun > 0 && (
          <span
            key={coachRun}
            className="absolute right-1 bottom-1 left-1 rounded-[16px] bg-emerald-500"
            style={{
              ['--coach-from' as string]: heightOf(value),
              ['--coach-to' as string]: heightOf(coach),
              animation: 'coach-settle 1.15s cubic-bezier(0.22, 0.8, 0.24, 1) both',
            }}
          />
        )}
      </div>
      <p className="mt-3 text-sm font-semibold text-slate-600">{label}</p>
      <p className={`mt-0.5 h-4 text-[11px] font-bold tabular-nums ${delta > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
        {showChange && delta !== 0 ? `${delta > 0 ? '+' : '−'}${formatUSD(Math.abs(delta))}` : ''}
      </p>
    </div>
  )
}

function Tape({ asOf, series, lowDay, buffer }: { asOf: string; series: number[]; lowDay: number; buffer: number | null }) {
  const width = 640
  const height = 110
  const pad = 12
  const top = Math.max(...series, buffer ?? 0)
  const bottom = Math.min(0, ...series, buffer ?? 0)
  const span = Math.max(1, top - bottom)
  const x = (index: number) => pad + (index / (series.length - 1)) * (width - pad * 2)
  const y = (value: number) => pad + (height - pad * 2) * (1 - (value - bottom) / span)
  const path = series.map((value, index) => `${index === 0 ? 'M' : 'L'} ${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ')
  const under = buffer != null && series[lowDay] < buffer

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-4 h-28 w-full" role="img" aria-label="Checking balance over the next 30 days">
      {buffer != null && (
        <line x1={pad} x2={width - pad} y1={y(buffer)} y2={y(buffer)} stroke="#e7b8a4" strokeDasharray="4 4" strokeWidth="1.5" />
      )}
      <path d={path} fill="none" stroke="#f5821f" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(0)} cy={y(series[0])} r="3.5" fill="#dd6f12" />
      <circle cx={x(lowDay)} cy={y(series[lowDay])} r="4.5" fill={under ? '#e11d48' : '#dd6f12'} />
    </svg>
  )
}

function Moment({ label, when, value, note, warn = false }: { label: string; when: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl bg-white/70 px-4 py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-1 text-xs font-semibold text-slate-500">{when}</p>
      <p className={`mt-1 text-lg font-extrabold tabular-nums ${warn ? 'text-rose-600' : 'text-slate-900'}`}>{value}</p>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{note}</p>
    </div>
  )
}

export default function CashflowEqualizer({ plan }: { plan: EqualizerPlan }) {
  const [amounts, setAmounts] = useState<Amounts>(() => amountsFrom(plan))
  const [impact, setImpact] = useState<{ amounts: Amounts; series: number[]; sentence: string } | null>(null)
  const [coachRun, setCoachRun] = useState(0)
  const signature = `${plan.asOf}:${plan.bars.map((bar) => bar.cents).join(',')}`

  useEffect(() => {
    setAmounts(amountsFrom(plan))
    setImpact(null)
    setCoachRun(0)
  }, [signature, plan])

  const max = useMemo(
    () => Math.max(plan.incomeCents, ...plan.bars.map((bar) => bar.cents), ...BARS.map((bar) => amounts[bar.key])),
    [plan, amounts],
  )
  const total = BARS.reduce((sum, bar) => sum + amounts[bar.key], 0)
  const overIncome = plan.incomeCents > 0 && total > plan.incomeCents
  const stale = impact != null && BARS.some((bar) => impact.amounts[bar.key] !== amounts[bar.key])
  const lowDay = impact ? lowestDay(impact.series) : 0
  const recovery = impact && plan.bufferCents != null ? recoveryAfter(impact.series, lowDay, plan.bufferCents) : null
  const low = impact ? impact.series[lowDay] : 0

  function simulate() {
    const snapshot = { ...amounts }
    const series = projectCash(plan, snapshot)
    const day = lowestDay(series)
    const back = plan.bufferCents != null ? recoveryAfter(series, day, plan.bufferCents) : null
    setImpact({ amounts: snapshot, series, sentence: describe(plan, snapshot, series, day, back) })
    setCoachRun((run) => run + 1)
  }

  return (
    <section className={`${glass} mt-8 w-full px-6 py-8 sm:px-12 sm:py-10`}>
      <div className="flex items-end justify-between gap-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{monthLabel(plan.month)}</p>
          <p className={`mt-2 text-3xl font-extrabold tabular-nums ${overIncome ? 'text-rose-600' : 'text-slate-900'}`}>
            {formatUSD(total)}
            <span className="ml-2 text-base font-semibold text-slate-400">of {formatUSD(plan.incomeCents)}</span>
          </p>
        </div>
        <p className="pb-1 text-right text-sm text-slate-400">
          {plan.bufferCents != null ? `Safety line ${formatUSD(plan.bufferCents)}` : 'No safety line on file'}
          <br />
          Checking {formatUSD(plan.startCents)}
        </p>
      </div>

      <div className="mt-12 flex items-end justify-between gap-3 sm:justify-center sm:gap-14">
        {plan.bars.map((bar) => (
          <SpendingBar
            key={bar.key}
            label={bar.label}
            value={amounts[bar.key]}
            plan={bar.cents}
            coach={bar.coachCents}
            max={max}
            showChange={impact != null}
            coachRun={coachRun}
            onChange={(next) => setAmounts((current) => ({ ...current, [bar.key]: next }))}
          />
        ))}
      </div>
      <style>{'@keyframes coach-settle { from { height: var(--coach-from); } to { height: var(--coach-to); } }'}</style>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-slate-400">
        {impact
          ? 'Green slides to what the coach would keep. Red is spending above that. The dashed line is where the bar started.'
          : 'Slide a bar. If it passes the coach, it turns red. Simulate impact and green moves to the coach’s level.'}
      </p>

      <div className="mt-10 flex flex-col items-center">
        <button
          type="button"
          onClick={simulate}
          className="rounded-full border border-slate-200 bg-white px-10 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:border-brand hover:bg-brand hover:text-white"
        >
          Simulate impact
        </button>
        {stale && <p className="mt-2 text-xs text-amber-700">Bars moved. Simulate again to refresh the month below.</p>}
      </div>

      {impact == null ? (
        <p className="mt-10 py-8 text-center text-sm text-slate-400">The next 30 days show up here after you simulate.</p>
      ) : (
        <div className="mt-10 border-t border-slate-200/80 pt-6">
          <p className="text-sm leading-relaxed font-medium text-slate-700">{impact.sentence}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Moment label="Today" when={dayLabel(plan.asOf, 0)} value={formatUSD(impact.series[0])} note="Checking after today's pay and bills." />
            <Moment
              label="Low point"
              when={dayLabel(plan.asOf, lowDay)}
              value={formatUSD(low)}
              warn={plan.bufferCents != null && low < plan.bufferCents}
              note={
                plan.bufferCents == null
                  ? 'Thinnest checking balance in the next 30 days.'
                  : low >= plan.bufferCents
                    ? `${formatUSD(low - plan.bufferCents)} above the line`
                    : `${formatUSD(plan.bufferCents - low)} under the line`
              }
            />
            <Moment
              label="Recovery"
              when={plan.bufferCents == null ? 'Checking' : recovery == null ? (low >= plan.bufferCents ? 'Clear' : 'Not this month') : dayLabel(plan.asOf, recovery)}
              value={plan.bufferCents == null ? formatUSD(impact.series[29]) : recovery == null ? (low >= plan.bufferCents ? 'Stays above' : 'Still under') : 'Back above'}
              note={recovery == null ? `Where checking stands on ${dayLabel(plan.asOf, 29)}.` : 'The next deposit clears the line.'}
            />
          </div>
          <Tape asOf={plan.asOf} series={impact.series} lowDay={lowDay} buffer={plan.bufferCents} />
          <div className="mt-1 flex justify-between text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            <span>Today</span>
            <span>{plan.bufferCents != null ? `Line ${formatUSD(plan.bufferCents)}` : monthLabel(plan.month)}</span>
            <span>{dayLabel(plan.asOf, 29)}</span>
          </div>
        </div>
      )}
    </section>
  )
}
