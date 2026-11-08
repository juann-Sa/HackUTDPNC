'use client'

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from 'react'
import {
  Area,
  ComposedChart,
  Line,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import AppHeader from '@/components/AppHeader'
import '../home/dashboard.css'
import '../life-cycle/life-cycle.css'
import LiveDataProvider, { useLiveData } from '@/components/live-data-provider'
import { timelineFor, type TimelinePoint } from '@/lib/live-data'

/** Shared glassmorphism panel styling. */
const glass =
  'health-panel'

function formatUSD(n: number): string {
  return `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`
}

function whenLabel(day: number): string {
  return day === 0 ? 'Today' : day < 0 ? `${Math.abs(day)} days ago` : `In ${day} days`
}

const COLORS = { actual: '#f5821f', cont: '#f5a623', coach: '#16a34a', whatif: '#737373' }

/* ---- Custom tooltip ------------------------------------------------------ */
interface TimelineTooltipProps {
  active?: boolean
  payload?: Array<{ payload: TimelinePoint }>
  whatifLabel: string | null
}

function TimelineTooltip({ active, payload, whatifLabel }: TimelineTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const p = payload[0].payload
  const row = (label: string, color: string, v: number | null, band?: [number, number] | null) =>
    v == null ? null : (
      <div className="mt-1.5 flex items-baseline justify-between gap-4">
        <span className="flex items-center gap-2 text-xs font-medium text-[#737373]">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
        <span className="text-right">
          <span className="text-sm font-medium text-[#171717]">{formatUSD(v)}</span>
          {band && <span className="block text-[10px] text-[#737373]">{formatUSD(band[0])} – {formatUSD(band[1])}</span>}
        </span>
      </div>
    )
  return (
    <div className="min-w-[230px] rounded-2xl border border-white/70 bg-white/90 px-4 py-3 shadow-xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#737373]">{whenLabel(p.day)}</span>
        <span className="text-[11px] text-[#737373]">{new Date(`${p.date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
      {row('Actual', COLORS.actual, p.actual)}
      {p.day > 0 && row('If nothing changes', COLORS.cont, p.continueMid, p.continueBand)}
      {p.day > 0 && row('Following the coach', COLORS.coach, p.coachMid, p.coachBand)}
      {p.day > 0 && whatifLabel && row(whatifLabel, COLORS.whatif, p.whatifMid)}
    </div>
  )
}

/* ---- KPI stat card ------------------------------------------------------- */
interface StatCardProps {
  label: string
  value: string
  hint?: string
  dot?: string
}

function StatCard({ label, value, hint, dot }: StatCardProps) {
  return (
    <div className={`${glass} p-4 sm:p-5`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#737373]">
          {label}
        </p>
        {dot && <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />}
      </div>
      <p className="mt-2 text-2xl font-medium text-[#171717]">{value}</p>
      {hint && <p className="mt-1 text-xs font-medium text-[#737373]">{hint}</p>}
    </div>
  )
}

/* ---- 360° chart --------------------------------------------------------- */
interface TimelineChartProps {
  data: TimelinePoint[]
  span: number
  whatifLabel: string | null
  onActiveChange: (point: TimelinePoint | null) => void
}

const TimelineChart = memo(function TimelineChart({ data, span, whatifLabel, onActiveChange }: TimelineChartProps) {
  const shown = useMemo(() => data.filter((d) => Math.abs(d.day) <= span), [data, span])
  const current = shown.find((d) => d.day === 0)
  const ticks = [-span, -span / 2, 0, span / 2, span]

  return (
    <div className="h-[340px] w-full sm:h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={shown}
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          onMouseMove={(state) => {
            // Recharts 3 reports activeTooltipIndex as a string | number, so coerce it.
            const raw = state.activeTooltipIndex
            const idx = raw == null ? NaN : Number(raw)
            onActiveChange(Number.isInteger(idx) && idx >= 0 && idx < shown.length ? shown[idx] : null)
          }}
          onMouseLeave={() => onActiveChange(null)}
        >
          <defs>
            <linearGradient id="fillActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.actual} stopOpacity={0.3} />
              <stop offset="90%" stopColor={COLORS.actual} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.06)" strokeDasharray="4 6" />
          <XAxis
            dataKey="day"
            type="number"
            domain={[-span, span]}
            ticks={ticks}
            tickFormatter={(d: number) => (d === 0 ? 'Today' : d < 0 ? `${d} days` : `+${d} days`)}
            tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
            tickMargin={12}
          />
          <YAxis
            tickFormatter={(v: number) => `$${Math.round(v / 1000)}k`}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={52}
            domain={['auto', 'auto']}
          />
          <Tooltip
            cursor={{ stroke: COLORS.actual, strokeWidth: 1.5, strokeDasharray: '4 4' }}
            content={(<TimelineTooltip whatifLabel={whatifLabel} />) as ReactElement}
          />

          {/* likely ranges (5th–95th percentile of the simulated futures) */}
          <Area type="monotone" dataKey="continueBand" stroke="none" fill={COLORS.cont} fillOpacity={0.15} isAnimationActive={false} activeDot={false} />
          <Area type="monotone" dataKey="coachBand" stroke="none" fill={COLORS.coach} fillOpacity={0.12} isAnimationActive={false} activeDot={false} />
          <Area
            type="monotone"
            dataKey="actual"
            stroke={COLORS.actual}
            strokeWidth={3}
            fill="url(#fillActual)"
            dot={false}
            activeDot={{ r: 5, fill: COLORS.actual, stroke: '#ffffff', strokeWidth: 2 }}
          />
          <Line type="monotone" dataKey="continueMid" stroke={COLORS.cont} strokeWidth={2.5} strokeDasharray="7 6" dot={false} activeDot={{ r: 4 }} />
          <Line type="monotone" dataKey="coachMid" stroke={COLORS.coach} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
          {whatifLabel && <Line type="monotone" dataKey="whatifMid" stroke={COLORS.whatif} strokeWidth={2} strokeDasharray="3 4" dot={false} activeDot={{ r: 4 }} />}

          <ReferenceLine x={0} stroke={COLORS.actual} strokeWidth={1.5} strokeDasharray="5 5" />
          {current?.actual != null && (
            <ReferenceDot x={0} y={current.actual} r={7} fill={COLORS.actual} stroke="#ffffff" strokeWidth={3} />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
})

/* ---- Cash cushion meter (reacts to chart hover) ------------------------- */
interface CushionBarProps {
  months: number | null
  context: string
  live: boolean
}

const CUSHION_FULL = 6 // months of bills that fill the bar

function CushionBar({ months, context, live }: CushionBarProps) {
  const value = months == null ? 0 : Math.max(0, Math.min(100, Math.round((100 * months) / CUSHION_FULL)))
  const [width, setWidth] = useState(0)
  useEffect(() => { setWidth(value) }, [value])

  const m = months ?? 0
  const status = m >= 6 ? 'Strong' : m >= 3 ? 'Healthy' : m >= 1 ? 'Thin' : 'Critical'
  const statusText = m >= 3 ? 'text-emerald-600' : m >= 1 ? 'text-amber-600' : 'text-rose-600'

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[#737373]">Cash cushion</h3>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${live ? 'bg-brand text-white' : 'bg-brand-tint text-brand-dark'}`}>
              {context}
            </span>
          </div>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-medium tabular-nums text-[#171717]">{months == null ? '—' : months.toFixed(1)}</span>
            <span className="text-sm font-semibold text-[#737373]">months of bills</span>
            <span className={`text-sm font-medium ${statusText}`}>{status}</span>
          </p>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-[#737373]">
          Cash minus high-interest debt, divided by your monthly bills. Three months is the usual guideline.
          <span className="font-semibold text-[#737373]"> Hover the chart</span> to see it on any day.
        </p>
      </div>

      <div className="relative mt-8">
        <div className="h-4 w-full overflow-hidden rounded-full bg-slate-900/5">
          <div
            className="h-full rounded-full bg-[#f58025] transition-[width] duration-300 ease-out"
            style={{ width: `${width}%` }}
          />
        </div>
        <div className="pointer-events-none absolute top-2 transition-[left] duration-300 ease-out" style={{ left: `${width}%`, transform: 'translate(-50%, -50%)' }}>
          <span className="block h-6 w-6 rounded-full border-4 border-white bg-brand shadow-md" />
        </div>
        <div className="pointer-events-none absolute -top-8 transition-[left] duration-300 ease-out" style={{ left: `${width}%`, transform: 'translateX(-50%)' }}>
          <span className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium tabular-nums text-white shadow-lg">
            {months == null ? '—' : `${months.toFixed(1)} mo`}
          </span>
        </div>
      </div>

      <div className="mt-3 flex justify-between text-[11px] font-semibold text-[#737373]">
        <span>0</span><span>1.5</span><span>3 (guideline)</span><span>4.5</span><span>6+ months</span>
      </div>
    </div>
  )
}

/* ---- Page ---------------------------------------------------------------- */
const SPANS = [{ label: '1M', span: 15 }, { label: '3M', span: 45 }, { label: '1Y', span: 180 }, { label: 'ALL', span: 180 }]

export default function LifeCycle() {
  return (
    <LiveDataProvider>
      <LifeCycleInner />
    </LiveDataProvider>
  )
}

function LifeCycleInner() {
  const { data, customerId, error, loading } = useLiveData()
  const tl = useMemo(() => (data ? timelineFor(data) : null), [data])
  const points = tl?.points ?? []
  const [range, setRange] = useState('1M')
  const span = SPANS.find(item => item.label === range)!.span
  const [activePoint, setActivePoint] = useState<TimelinePoint | null>(null)
  const handleActiveChange = useCallback((point: TimelinePoint | null) => setActivePoint(point), [])

  const today = points.find((d) => d.day === 0) ?? null
  const start = points.find((d) => d.day === -180) ?? null
  const end = points.find((d) => d.day === 180) ?? null
  const shown = activePoint ?? today
  const change = today?.actual != null && start?.actual != null ? today.actual - start.actual : null
  const gain = end?.coachMid != null && end?.continueMid != null ? end.coachMid - end.continueMid : null

  return (
    <div className="life-cycle-page">
      <AppHeader current="past" />

      <main className="life-cycle-main">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1>Past</h1>
          </div>
          <div className="health-range" role="group" aria-label="Time window">
            {SPANS.map((s) => (
              <button
                key={s.label}
                type="button"
                aria-pressed={range === s.label}
                onClick={() => { setRange(s.label); setActivePoint(null) }}
                className={range === s.label ? 'active' : ''}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">Can&rsquo;t load live data: {error}</p>}
        {!error && data && points.length === 0 && (
          <p className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No forecast for {customerId} yet. Run <code>run_forecast</code> for this customer (the load script does it for C006, C002 and C027).
          </p>
        )}

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Net cash today" value={today?.actual != null ? formatUSD(today.actual) : loading ? '…' : '—'} hint="Cash minus high-interest debt" dot="bg-brand" />
          <StatCard label="Past 180 days" value={change != null ? `${change >= 0 ? '+' : ''}${formatUSD(change)}` : '—'} hint="Change in net cash" dot="bg-amber-400" />
          <StatCard
            label="In 180 days, as is"
            value={end?.continueMid != null ? formatUSD(end.continueMid) : '—'}
            hint={end?.continueBand ? `Likely ${formatUSD(end.continueBand[0])} – ${formatUSD(end.continueBand[1])}` : undefined}
            dot="bg-sky-400"
          />
          <StatCard
            label="With the coach"
            value={end?.coachMid != null ? formatUSD(end.coachMid) : '—'}
            hint={gain != null ? `${gain >= 0 ? '+' : ''}${formatUSD(gain)} vs. as is` : undefined}
            dot="bg-emerald-500"
          />
        </div>

        {/* Chart */}
        <section className={`${glass} mt-6 p-5 sm:p-6`}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[#171717]">Net cash over time</h2>
              <p className="text-sm text-[#737373]">Actual history, then thousands of simulated futures. Shaded areas are the likely range.</p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-[#737373]">
              <span className="flex items-center gap-2"><span className="h-1 w-6 rounded-full" style={{ background: COLORS.actual }} />Actual</span>
              <span className="flex items-center gap-2"><span className="h-0 w-6 border-t-2 border-dashed" style={{ borderColor: COLORS.cont }} />If nothing changes</span>
              <span className="flex items-center gap-2"><span className="h-1 w-6 rounded-full" style={{ background: COLORS.coach }} />Following the coach</span>
              {tl?.whatifLabel && <span className="flex items-center gap-2"><span className="h-0 w-6 border-t-2 border-dotted" style={{ borderColor: COLORS.whatif }} />{tl.whatifLabel}</span>}
            </div>
          </div>
          <TimelineChart data={points} span={span} whatifLabel={tl?.whatifLabel ?? null} onActiveChange={handleActiveChange} />
          <p className="mt-3 text-[11px] text-[#737373]">Forecasts are ranges, not promises. Educational tool using synthetic data — not financial advice.</p>
        </section>

        {/* Cushion meter — reacts to chart hover */}
        <section className={`${glass} mt-6 p-5 sm:p-7`}>
          <CushionBar months={shown?.cushion ?? null} context={shown ? whenLabel(shown.day) : 'Today'} live={activePoint !== null} />
        </section>
      </main>
    </div>
  )
}
