// Goals: the chance of reaching a money target by a date, and what it would take.
//   save_extra:    cash on the date − cash today ≥ target
//   reach_balance: cash on the date ≥ target
// Simulated with the full engine (normal ups and downs plus surprise bills and job-loss risk).
// "What it would take" = extra cents per month kept (by spending less) so the chance reaches
// a confidence level, found by bisection on the same random draws (common random numbers).
import { DISCRETIONARY } from './calendar';
import { dayNumber } from './dates';
import { type Assumptions, liquidOnDay, makeTapes, quantile } from './forecast';
import type { Schedule } from './schedule';
import type { Tape } from './rng';

export const GOAL_KINDS = new Set(['save_extra', 'reach_balance']);
export const MAX_GOAL_DAYS = 365;
const SEARCH_PAIRS = 200;

export interface GoalInput {
  kind: string;
  targetCents: number;
  targetDate: string;
}

export interface GoalResult {
  dayIndex: number;
  pSuccess: number;
  pSuccessSe: number;
  /** Goal metric on the date (cash, or growth in cash for save_extra): 5th / 50th / 95th percentile. */
  low: number;
  mid: number;
  high: number;
  needed80: number | undefined; // extra cents per month for an 80% chance (undefined: not reachable by saving alone)
  needed95: number | undefined;
  pWith80: number | undefined;
  neededShareOfExtras: number | undefined; // needed80 as a share of monthly dining + shopping + other
}

function successRate(values: Float64Array, ok: (v: number) => boolean) {
  const pairs = values.length / 2;
  let sum = 0;
  let sq = 0;
  for (let i = 0; i < pairs; i++) {
    const m = ((ok(values[2 * i]) ? 1 : 0) + (ok(values[2 * i + 1]) ? 1 : 0)) / 2;
    sum += m;
    sq += m * m;
  }
  const p = sum / pairs;
  const v = Math.max(0, sq / pairs - p * p) * (pairs / Math.max(pairs - 1, 1));
  return { p, se: Math.sqrt(v / pairs) };
}

export function evaluateGoal(s: Schedule, base: Assumptions, seed: number, g: GoalInput, includeExternal: boolean): GoalResult {
  const dayIndex = dayNumber(g.targetDate) - dayNumber(s.asOf);
  const a: Assumptions = { ...base, horizonDays: Math.max(dayIndex, 1) };
  const tapes = makeTapes(seed, a, s.months.length + 1);
  const small: Assumptions = { ...a, pairs: Math.min(SEARCH_PAIRS, a.pairs) };
  const smallTapes: Tape[] = tapes.slice(0, small.pairs);
  const start = s.startLiquid;
  const metric = (v: number) => (g.kind === 'save_extra' ? v - start : v);
  const ok = (v: number) => metric(v) >= g.targetCents;
  const sc = (extra: number) => ({ id: 'goal', label: 'Goal', includeExternal, extraMonthlyCents: extra });

  const vals = liquidOnDay(s, a, sc(0), tapes, dayIndex);
  const { p, se } = successRate(vals, ok);
  const sorted = Float64Array.from(vals, metric).sort();

  const pAt = (extra: number) => successRate(liquidOnDay(s, small, sc(extra), smallTapes, dayIndex), ok).p;
  const monthlySpend = Object.values(s.spend).reduce((t, x) => t + (x.base[0] ?? 0), 0);
  const cap = monthlySpend; // never ask for more than a full month of spending
  const solve = (conf: number): number | undefined => {
    if (pAt(0) >= conf) return 0;
    if (pAt(cap) < conf) return undefined;
    let lo = 0;
    let hi = cap;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      if (pAt(mid) >= conf) hi = mid;
      else lo = mid;
    }
    return Math.ceil(hi / 1000) * 1000; // round up to $10
  };
  const needed80 = solve(0.8);
  const needed95 = solve(0.95);
  const pWith80 = needed80 === undefined ? undefined : successRate(liquidOnDay(s, a, sc(needed80), tapes, dayIndex), ok).p;
  const extras = DISCRETIONARY.reduce((t, c) => t + (s.spend[c].base[0] ?? 0), 0);
  return {
    dayIndex,
    pSuccess: p,
    pSuccessSe: se,
    low: quantile(sorted, 0.05),
    mid: quantile(sorted, 0.5),
    high: quantile(sorted, 0.95),
    needed80,
    needed95,
    pWith80,
    neededShareOfExtras: needed80 !== undefined && extras > 0 ? needed80 / extras : undefined,
  };
}
