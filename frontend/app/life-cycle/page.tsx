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
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { generateSpendingData, type SpendingPoint } from './mockData'

/** Shared glassmorphism panel styling. */
const glass =
  'rounded-3xl border border-white/60 bg-white/60 shadow-[0_24px_70px_-28px_rgba(245,130,31,0.45)] backdrop-blur-xl'

function formatUSD(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

function whenLabel(day: number): string {
  return day === 0 ? 'Today' : day < 0 ? `${Math.abs(day)} days ago` : `In ${day} days`
}

/* ---- Custom tooltip (spending only) -------------------------------------- */
interface SpendingTooltipProps {
  active?: boolean
  payload?: Array<{ payload: SpendingPoint }>
}

function SpendingTooltip({ active, payload }: SpendingTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0].payload

  return (
    <div className="min-w-[190px] rounded-2xl border border-white/70 bg-white/85 px-4 py-3 shadow-xl backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          {whenLabel(point.day)}
        </span>
        {point.day > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600">
            Projected
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-medium text-slate-500">Total Spending</p>
      <p className="text-xl font-extrabold text-slate-800">{formatUSD(point.total)}</p>
    </div>
  )
}

/* ---- Header -------------------------------------------------------------- */
function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-white/50 bg-white/60 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span className="text-xl font-extrabold tracking-[0.15em] text-brand">
            PNC
          </span>
          <span className="hidden items-center gap-3 sm:flex">
            <span className="h-5 w-px bg-slate-300" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-500">
              360° Financial Advisor
            </span>
          </span>
        </div>

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
        <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          {label}
        </p>
        {dot && <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />}
      </div>
      <p className="mt-2 text-2xl font-extrabold text-slate-800">{value}</p>
      {hint && <p className="mt-1 text-xs font-medium text-slate-400">{hint}</p>}
    </div>
  )
}

/* ---- Spending chart ------------------------------------------------------ */
interface SpendingChartProps {
  data: SpendingPoint[]
  onActiveChange: (point: SpendingPoint | null) => void
}

const SpendingChart = memo(function SpendingChart({
  data,
  onActiveChange,
}: SpendingChartProps) {
  const current = data.find((d) => d.day === 0)

  return (
    <div className="h-[340px] w-full sm:h-[380px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          onMouseMove={(state) => {
            // Recharts 3 reports activeTooltipIndex as a string | number, so coerce it.
            const raw = state.activeTooltipIndex
            const idx = raw == null ? NaN : Number(raw)
            onActiveChange(
              Number.isInteger(idx) && idx >= 0 && idx < data.length
                ? data[idx]
                : null,
            )
          }}
          onMouseLeave={() => onActiveChange(null)}
        >
          <defs>
            <linearGradient id="fillActual" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5821f" stopOpacity={0.35} />
              <stop offset="90%" stopColor="#f5821f" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="fillProjected" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f5a623" stopOpacity={0.16} />
              <stop offset="90%" stopColor="#f5a623" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid vertical={false} stroke="rgba(15,23,42,0.06)" strokeDasharray="4 6" />
          <XAxis
            dataKey="day"
            type="number"
            domain={[-180, 180]}
            ticks={[-180, -90, 0, 90, 180]}
            tickFormatter={(d: number) =>
              d === 0 ? 'Current' : d < 0 ? `${d} Days` : `+${d} Days`
            }
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
          />
          <Tooltip
            cursor={{ stroke: '#f5821f', strokeWidth: 1.5, strokeDasharray: '4 4' }}
            content={(<SpendingTooltip />) as ReactElement}
          />

          <Area
            type="monotone"
            dataKey="actual"
            stroke="#f5821f"
            strokeWidth={3}
            fill="url(#fillActual)"
            dot={false}
            activeDot={{ r: 5, fill: '#f5821f', stroke: '#ffffff', strokeWidth: 2 }}
          />
          <Area
            type="monotone"
            dataKey="projected"
            stroke="#f5a623"
            strokeWidth={2.5}
            strokeDasharray="7 6"
            fill="url(#fillProjected)"
            dot={false}
            activeDot={{ r: 5, fill: '#f5a623', stroke: '#ffffff', strokeWidth: 2 }}
          />

          <ReferenceLine x={0} stroke="#f5821f" strokeWidth={1.5} strokeDasharray="5 5" />
          {current && (
            <ReferenceDot
              x={0}
              y={current.total}
              r={7}
              fill="#f5821f"
              stroke="#ffffff"
              strokeWidth={3}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
})

/* ---- Health metric bar (reacts to chart hover) --------------------------- */
interface HealthMetricBarProps {
  value: number
  context: string
  live: boolean
}

function HealthMetricBar({ value, context, live }: HealthMetricBarProps) {
  const [width, setWidth] = useState(0)

  useEffect(() => {
    setWidth(value)
  }, [value])

  const status =
    value >= 80
      ? 'Excellent'
      : value >= 65
        ? 'Healthy'
        : value >= 50
          ? 'Fair'
          : value >= 35
            ? 'At risk'
            : 'Critical'

  const statusText =
    value >= 65 ? 'text-emerald-600' : value >= 50 ? 'text-amber-600' : 'text-rose-600'

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
              Financial Health Metric
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold transition-colors ${
                live ? 'bg-brand text-white' : 'bg-brand-tint text-brand-dark'
              }`}
            >
              {context}
            </span>
          </div>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-extrabold tabular-nums text-slate-800">
              {value}%
            </span>
            <span className={`text-sm font-bold ${statusText}`}>{status}</span>
          </p>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-slate-400">
          A blended score from your spending, income and cash-flow buffers.
          <span className="font-semibold text-slate-500"> Hover the chart</span> to see
          it change over time.
        </p>
      </div>

      <div className="relative mt-8">
        <div className="h-4 w-full overflow-hidden rounded-full bg-slate-900/5">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 shadow-[0_4px_14px_rgba(245,130,31,0.45)] transition-[width] duration-300 ease-out"
            style={{ width: `${width}%` }}
          />
        </div>

        {/* Knob */}
        <div
          className="pointer-events-none absolute top-2 transition-[left] duration-300 ease-out"
          style={{ left: `${width}%`, transform: 'translate(-50%, -50%)' }}
        >
          <span className="block h-6 w-6 rounded-full border-4 border-white bg-brand shadow-md" />
        </div>

        {/* Floating value bubble */}
        <div
          className="pointer-events-none absolute -top-8 transition-[left] duration-300 ease-out"
          style={{ left: `${width}%`, transform: 'translateX(-50%)' }}
        >
          <span className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-bold tabular-nums text-white shadow-lg">
            {value}%
          </span>
        </div>
      </div>

      <div className="mt-3 flex justify-between text-[11px] font-semibold text-slate-400">
        <span>0</span>
        <span>25</span>
        <span>50</span>
        <span>75</span>
        <span>100</span>
      </div>
    </div>
  )
}

/* ---- Page ---------------------------------------------------------------- */
export default function LifeCycle() {
  const data = useMemo(() => generateSpendingData(), [])
  const currentPoint = useMemo(
    () => data.find((d) => d.day === 0) ?? data[Math.floor(data.length / 2)],
    [data],
  )

  const [activePoint, setActivePoint] = useState<SpendingPoint | null>(null)
  const handleActiveChange = useCallback(
    (point: SpendingPoint | null) => setActivePoint(point),
    [],
  )

  const shown = activePoint ?? currentPoint
  const currentTotal = currentPoint.total
  const projectedTotal = data[data.length - 1].total
  const monthlyAvg = Math.round(currentTotal / 6)

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#fff8f1] text-slate-800">
      {/* Ambient background blobs */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-28 -top-28 h-96 w-96 rounded-full bg-brand/25 blur-3xl" />
        <div className="absolute left-[-120px] top-1/3 h-80 w-80 rounded-full bg-amber-300/30 blur-3xl" />
        <div className="absolute bottom-[-80px] right-1/4 h-72 w-72 rounded-full bg-orange-200/50 blur-3xl" />
      </div>

      <Header />

      <main className="relative z-10 mx-auto max-w-6xl px-5 pb-16 pt-8">
        {/* Page title + range selector */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-brand-dark">
              Life Cycle
            </p>
            <h1 className="mt-1.5 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
              Your spending, past &amp; future
            </h1>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-white/60 bg-white/60 p-1 text-sm shadow-sm backdrop-blur-xl">
            <span className="rounded-full bg-brand px-3 py-1 font-semibold text-white shadow-sm">
              360 days
            </span>
            <span className="px-3 py-1 font-medium text-slate-400">90 days</span>
            <span className="px-3 py-1 font-medium text-slate-400">30 days</span>
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Spent to date" value={formatUSD(currentTotal)} dot="bg-brand" />
          <StatCard
            label="Monthly average"
            value={formatUSD(monthlyAvg)}
            dot="bg-amber-400"
          />
          <StatCard
            label="Projected +180d"
            value={formatUSD(projectedTotal)}
            dot="bg-sky-400"
          />
          <StatCard
            label="Health score"
            value={`${shown.health}%`}
            dot="bg-emerald-500"
          />
        </div>

        {/* Chart */}
        <section className={`${glass} mt-6 p-5 sm:p-6`}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Total Spending over time</h2>
              <p className="text-sm text-slate-500">
                Cumulative spend with a 180-day projection.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold text-slate-500">
              <span className="flex items-center gap-2">
                <span className="h-1 w-6 rounded-full bg-brand" />
                Actual
              </span>
              <span className="flex items-center gap-2">
                <span className="h-0 w-6 border-t-2 border-dashed border-amber-400" />
                Projected
              </span>
            </div>
          </div>
          <SpendingChart data={data} onActiveChange={handleActiveChange} />
        </section>

        {/* Health metric — reacts to chart hover */}
        <section className={`${glass} mt-6 p-5 sm:p-7`}>
          <HealthMetricBar
            value={shown.health}
            context={whenLabel(shown.day)}
            live={activePoint !== null}
          />
        </section>
      </main>
    </div>
  )
}
