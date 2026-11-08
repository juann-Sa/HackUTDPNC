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
import AppHeader from '@/components/AppHeader'
import '../home/dashboard.css'
import './life-cycle.css'

/** Match the Overview card surfaces. */
const glass =
  'health-panel'

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
    <div className="min-w-[190px] rounded-xl border border-[#e8e8e8] bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-[#737373]">
          {whenLabel(point.day)}
        </span>
        {point.day > 0 && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600">
            Projected
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm font-medium text-[#737373]">Total Spending</p>
      <p className="text-xl font-medium text-[#171717]">{formatUSD(point.total)}</p>
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
  const firstDay = data[0]?.day ?? -180
  const lastDay = data[data.length - 1]?.day ?? 180

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
            domain={[firstDay, lastDay]}
            ticks={[firstDay, Math.round(firstDay / 2), 0, Math.round(lastDay / 2), lastDay]}
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
            <h3 className="text-sm font-semibold uppercase tracking-wider text-[#737373]">
              Financial Health Metric
            </h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
                live ? 'bg-brand text-white' : 'bg-brand-tint text-brand-dark'
              }`}
            >
              {context}
            </span>
          </div>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="text-4xl font-medium tabular-nums text-[#171717]">
              {value}%
            </span>
            <span className={`text-sm font-medium ${statusText}`}>{status}</span>
          </p>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-[#737373]">
          A blended score from your spending, income and cash-flow buffers.
          <span className="font-semibold text-[#737373]"> Hover the chart</span> to see
          it change over time.
        </p>
      </div>

      <div className="relative mt-8">
        <div className="h-4 w-full overflow-hidden rounded-full bg-slate-900/5">
          <div
            className="h-full rounded-full bg-[#f58025] transition-[width] duration-300 ease-out"
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
          <span className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium tabular-nums text-white shadow-lg">
            {value}%
          </span>
        </div>
      </div>

      <div className="mt-3 flex justify-between text-[11px] font-semibold text-[#737373]">
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
  const [range, setRange] = useState<"1M" | "3M" | "1Y" | "ALL">("1M")
  const visibleData = useMemo(() => {
    const halfWindow = { "1M": 15, "3M": 45, "1Y": 183, ALL: Infinity }[range]
    return data.filter(point => Math.abs(point.day) <= halfWindow)
  }, [data, range])
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
    <div className="life-cycle-page">
      <AppHeader current="health" appearance="overview" />

      <main className="life-cycle-main">
        {/* Page title + range selector */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <h1>Life cycle</h1>
          <div className="health-range" role="group" aria-label="Spending time range">
            {(["1M", "3M", "1Y", "ALL"] as const).map(item => (
              <button key={item} className={range === item ? 'active' : ''} aria-pressed={range === item} onClick={() => { setRange(item); setActivePoint(null) }}>{item}</button>
            ))}
          </div>
        </div>

        {/* KPI row */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Spent to date" value={formatUSD(currentTotal)} dot="bg-brand" />
          <StatCard
            label="Monthly average"
            value={formatUSD(monthlyAvg)}
            dot="bg-brand"
          />
          <StatCard
            label="Projected +180d"
            value={formatUSD(projectedTotal)}
            dot="bg-brand"
          />
          <StatCard
            label="Health score"
            value={`${shown.health}%`}
            dot="bg-brand"
          />
        </div>

        {/* Chart */}
        <section className={`${glass} mt-6 p-5 sm:p-6`}>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-medium text-[#171717]">Total Spending over time</h2>
              <p className="text-sm text-[#737373]">
                Cumulative spend with a 180-day projection.
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-semibold text-[#737373]">
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
          <SpendingChart data={visibleData} onActiveChange={handleActiveChange} />
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
