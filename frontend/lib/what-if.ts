// Turns one customer's ledger into the what-if equalizer: five real spending bars
// and a 30-day checking replay. Nothing here is a sample budget.
import type { CoachActionRow, CustomerData, LedgerRow } from './live-data'
import { asOfDate } from './live-data'

/** Same extras the coach trims together in spacetimedb/src/math/coach.ts. */
const DISCRETIONARY = new Set(['dining', 'shopping', 'other_spending'])

export const BARS = [
  { key: 'housing', label: 'Housing' },
  { key: 'car', label: 'Car' },
  { key: 'food', label: 'Food' },
  { key: 'save', label: 'Save' },
  { key: 'invest', label: 'Invest' },
] as const

export type BarKey = (typeof BARS)[number]['key']
export type Amounts = Record<BarKey, number>

export interface CashEvent {
  dayOfMonth: number
  cents: number
  bucket: BarKey | 'fixed' | 'income'
}

export interface EqualizerPlan {
  month: string
  asOf: string
  incomeCents: number
  startCents: number
  bufferCents: number | null
  bars: { key: BarKey; label: string; cents: number; coachCents: number }[]
  events: CashEvent[]
  /** Calendar days (1–31) where that category actually posted, used to place a slider change. */
  touches: Record<BarKey, number[]>
}

const emptyTouches = (): Record<BarKey, number[]> => ({
  housing: [],
  car: [],
  food: [],
  save: [],
  invest: [],
})

function barOf(entry: LedgerRow): BarKey | null {
  if (entry.category === 'housing') return 'housing'
  if (entry.category === 'transport') return 'car'
  if (entry.category === 'debt_payment' && entry.account_type === 'checking' && /auto/i.test(entry.description)) return 'car'
  if (entry.category === 'groceries' || entry.category === 'dining') return 'food'
  if (entry.category === 'savings_contribution' && entry.account_type === 'checking') return 'save'
  if (entry.category === 'investment_contribution' && entry.account_type === 'checking') return 'invest'
  return null
}

function cashBucket(entry: LedgerRow): CashEvent['bucket'] | null {
  if (entry.account_type !== 'checking' || entry.amount_cents <= 0) return null
  if (entry.flow_class === 'income') return 'income'
  return barOf(entry) ?? (entry.flow_class === 'non_cash' ? null : 'fixed')
}

/** Coach target for one ledger category, using the actions already stored for this customer. */
function coachMultiplier(category: string, actions: CoachActionRow[]): number {
  const discretionaryCut = actions
    .filter((action) => action.kind === 'close_monthly_gap' || action.kind === 'trim_discretionary' || action.kind === 'protect_income')
    .reduce((cut, action) => Math.max(cut, action.fraction), 0)
  let keep = DISCRETIONARY.has(category) ? 1 - discretionaryCut : 1
  const categoryTrim = actions.find((action) => action.kind === 'trim_category' && action.driver === `spend:${category}`)
  if (categoryTrim) keep = Math.min(keep, 1 - categoryTrim.fraction)
  return Math.max(0, keep)
}

function shift(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Latest month of this customer's own activity, or null when there is no ledger. */
export function equalizerFor(data: CustomerData): EqualizerPlan | null {
  if (!data.ledger_entry.length) return null
  const month = data.ledger_entry.reduce((latest, entry) => (entry.posted_date.slice(0, 7) > latest ? entry.posted_date.slice(0, 7) : latest), '')
  const monthEntries = data.ledger_entry.filter((entry) => entry.posted_date.startsWith(month))
  const totals: Amounts = { housing: 0, car: 0, food: 0, save: 0, invest: 0 }
  const parts: Record<BarKey, { category: string; cents: number }[]> = { housing: [], car: [], food: [], save: [], invest: [] }
  const touches = emptyTouches()
  const events: CashEvent[] = []
  let incomeCents = 0

  for (const entry of monthEntries) {
    const bar = barOf(entry)
    if (bar) {
      const category = bar === 'car' && entry.category === 'debt_payment' ? 'auto_loan' : entry.category
      totals[bar] += entry.amount_cents
      const piece = parts[bar].find((part) => part.category === category)
      if (piece) piece.cents += entry.amount_cents
      else parts[bar].push({ category, cents: entry.amount_cents })
      const day = Number(entry.posted_date.slice(8, 10))
      if (!touches[bar].includes(day)) touches[bar].push(day)
    }
    const bucket = cashBucket(entry)
    if (!bucket) continue
    if (bucket === 'income') incomeCents += entry.amount_cents
    events.push({ dayOfMonth: Number(entry.posted_date.slice(8, 10)), cents: entry.amount_cents, bucket })
  }

  if (incomeCents <= 0) incomeCents = data.customer[0]?.monthly_income_cents ?? 0
  const startCents = data.account.filter((account) => account.account_type === 'checking').reduce((sum, account) => sum + account.balance_cents, 0)
  const baseline = (data.forecast_run ?? []).find((run) => run.scenario === 'baseline') ?? data.forecast_run?.[0]
  const bufferCents = baseline?.threshold_cents || data.danger_day.find((day) => day.threshold_cents)?.threshold_cents || null
  const actions = data.coach_action ?? []

  return {
    month,
    asOf: asOfDate(data),
    incomeCents,
    startCents,
    bufferCents,
    bars: BARS.map((bar) => ({
      ...bar,
      cents: Math.round(totals[bar.key]),
      coachCents: Math.round(parts[bar.key].reduce((sum, part) => sum + part.cents * coachMultiplier(part.category, actions), 0)),
    })),
    events,
    touches,
  }
}

export function amountsFrom(plan: EqualizerPlan): Amounts {
  return Object.fromEntries(plan.bars.map((bar) => [bar.key, bar.cents])) as Amounts
}

/** Replay the next 30 days of checking. Slider changes move cash by exactly that many cents. */
export function projectCash(plan: EqualizerPlan, amounts: Amounts): number[] {
  const planAmounts = amountsFrom(plan)
  const series: number[] = []
  let cash = plan.startCents
  for (let offset = 0; offset < 30; offset++) {
    const day = Number(shift(plan.asOf, offset).slice(8, 10))
    for (const event of plan.events) {
      if (event.dayOfMonth !== day) continue
      cash += event.bucket === 'income' ? event.cents : -event.cents
    }
    for (const bar of BARS) {
      const delta = amounts[bar.key] - planAmounts[bar.key]
      if (!delta) continue
      const days = plan.touches[bar.key]
      const hits = days.length ? days : [Number(plan.asOf.slice(8, 10))]
      if (hits.includes(day)) cash -= delta / hits.length
    }
    series.push(Math.round(cash))
  }
  return series
}

export function monthLabel(month: string): string {
  return new Date(`${month}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function dayLabel(asOf: string, offset: number): string {
  return new Date(`${shift(asOf, offset)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
