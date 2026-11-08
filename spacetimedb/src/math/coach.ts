// Spec §8–§9: stress tests, sensitivities, and the coach engine.
// The coach never invents advice: it searches the simulator for the trade-off and proposes the
// efficient point. An LLM may explain these numbers; it never computes them.
import { CATEGORIES, type Category, DISCRETIONARY } from './calendar';
import { type Assumptions, type ForecastResult, type Scenario, makeTapes, runForecast } from './forecast';
import type { Schedule } from './schedule';
import type { Tape } from './rng';
import { BUFFER_MONTHS } from './book';

/** Highest acceptable chance of liquid cash dipping below the threshold over the horizon. */
export const RISK_CAP = 0.05;
const HIGH_COST_APR = 10;
const SEARCH_PAIRS = 200; // frontier / bisection / sensitivities reuse the first 200 tapes (CRN)
const MAX_TRIM = 0.3;

export interface CoachAction {
  kind: 'move_cash_to_debt' | 'trim_discretionary';
  amountCents: number; // move: one-time cents; trim: cents per month
  fraction: number; // trim: share of discretionary spend; move: share of max movable
  annualSavingCents: number;
  pLowBefore: number;
  pLowAfter: number;
  detail: string;
}

export interface Analysis {
  baseline: ForecastResult;
  coach: ForecastResult;
  stresses: ForecastResult[];
  sensitivities: { lever: string; label: string; deltaPLow: number; deltaEndP50: number }[];
  frontier: { moveCents: number; pLow: number; annualSavingCents: number; recommended: boolean }[];
  actions: CoachAction[];
}

function highCostTargets(s: Schedule) {
  const t: { apr: number; balance: number; id: string }[] = [];
  if (s.card && s.card.aprPct >= HIGH_COST_APR) t.push({ apr: s.card.aprPct, balance: s.card.balance, id: s.card.accountId });
  for (const l of s.loans) if (l.aprPct >= HIGH_COST_APR) t.push({ apr: l.aprPct, balance: l.balance, id: l.accountId });
  return t.sort((a, b) => b.apr - a.apr);
}

/** Annual interest saved by moving `a` cents of cash to high-cost debt (avalanche), net of lost savings yield. */
export function annualSaving(s: Schedule, a: number): number {
  let left = a;
  let save = 0;
  for (const t of highCostTargets(s)) {
    const amt = Math.min(left, t.balance);
    if (amt <= 0) break;
    save += (amt * (t.apr - s.savingsYieldPct)) / 100;
    left -= amt;
  }
  return save;
}

/**
 * @param monthlyOutflowCents essential monthly outflow (book snapshot); the coach never moves cash below
 *        BUFFER_MONTHS × this, the same buffer the carry "fixable leak" uses, so the two always agree.
 */
export function analyze(s: Schedule, a: Assumptions, seed: number, includeExternal: boolean, monthlyOutflowCents: number): Analysis {
  const months = s.months.length + 1;
  const tapes = makeTapes(seed, a, months);
  const small: Assumptions = { ...a, pairs: Math.min(SEARCH_PAIRS, a.pairs) };
  const smallTapes: Tape[] = tapes.slice(0, small.pairs);
  const base: Scenario = { id: 'baseline', label: 'If nothing changes', includeExternal };
  const run = (sc: Scenario, full = false) => runForecast(s, full ? a : small, sc, full ? tapes : smallTapes);

  const baseline = run(base, true);
  const baseSmall = run(base);

  // ---- stress tests (full paths) ----
  const stresses = [
    run({ ...base, id: 'stress_job_loss', label: 'Job loss for 3 months', jobLossMonths: 3 }, true),
    run({ ...base, id: 'stress_bill', label: 'Surprise $3,000 bill in two weeks', oneOff: { dayIndex: 14, cents: 300_000 } }, true),
    run({ ...base, id: 'stress_rates', label: 'Card APR up 2 points', cardAprBumpPct: 2 }, true),
  ];

  // ---- sensitivities: 10% bumps on common random numbers ----
  const sens = (lever: string, label: string, sc: Scenario) => {
    const r = run(sc);
    return { lever, label, deltaPLow: r.pLow - baseSmall.pLow, deltaEndP50: r.endLiquid.p50 - baseSmall.endLiquid.p50 };
  };
  const sensitivities = [
    sens('income', 'Income 10% lower', { ...base, id: 'sens_income', incomeMult: 0.9 }),
    ...CATEGORIES.filter(c => s.spend[c].base.some(v => v > 0)).map(c =>
      sens(`spend:${c}`, `${c.replace('_', ' ')} 10% lower`, { ...base, id: `sens_${c}`, categoryMult: { [c]: 0.9 } })
    ),
  ];
  if (s.card) sensitivities.push(sens('card_apr', 'Card APR 2 points higher', { ...base, id: 'sens_apr', cardAprBumpPct: 2 }));

  // ---- frontier: move cash to high-cost debt ----
  const capacity = highCostTargets(s).reduce((p, t) => p + t.balance, 0);
  const maxMove = Math.max(0, Math.min(s.startLiquid - BUFFER_MONTHS * monthlyOutflowCents, capacity));
  const pAt = (amt: number) => run({ ...base, id: 'frontier', moveToDebtCents: amt }).pLow;
  const frontier: Analysis['frontier'] = [];
  let best = 0;
  if (maxMove > 0) {
    let prevOk = 0;
    let firstBad = -1;
    for (let i = 0; i <= 10; i++) {
      const amt = Math.round((maxMove * i) / 10);
      const p = i === 0 ? baseSmall.pLow : pAt(amt);
      frontier.push({ moveCents: amt, pLow: p, annualSavingCents: annualSaving(s, amt), recommended: false });
      if (p <= RISK_CAP && firstBad < 0) prevOk = amt;
      else if (firstBad < 0) firstBad = amt;
    }
    if (baseSmall.pLow <= RISK_CAP) {
      best = prevOk;
      if (firstBad > 0) {
        let lo = prevOk;
        let hi = firstBad;
        for (let it = 0; it < 6; it++) {
          const mid = Math.round((lo + hi) / 2);
          if (pAt(mid) <= RISK_CAP) lo = mid;
          else hi = mid;
        }
        best = lo;
      }
      best = Math.floor(best / 10_000) * 10_000; // round down to $100
    }
    frontier.push({ moveCents: best, pLow: best ? pAt(best) : baseSmall.pLow, annualSavingCents: annualSaving(s, best), recommended: true });
    frontier.sort((x, y) => x.moveCents - y.moveCents || Number(x.recommended) - Number(y.recommended));
  }

  const actions: CoachAction[] = [];
  if (best > 0) {
    const after = frontier.find(f => f.recommended)!.pLow;
    actions.push({
      kind: 'move_cash_to_debt',
      amountCents: best,
      fraction: best / maxMove,
      annualSavingCents: annualSaving(s, best),
      pLowBefore: baseSmall.pLow,
      pLowAfter: after,
      detail: `Pay down the highest-APR debt first using cash above a ${BUFFER_MONTHS}-month buffer; the chance of running low stays under 5%.`,
    });
  }

  // ---- trim discretionary spending if risk is too high or cash is draining ----
  const trimScenario = (f: number, extra: Partial<Scenario> = {}): Scenario => ({
    ...base,
    ...extra,
    id: 'trim',
    categoryMult: Object.fromEntries(DISCRETIONARY.map(c => [c, 1 - f])) as Partial<Record<Category, number>>,
  });
  const discretionaryMonthly = DISCRETIONARY.reduce((p, c) => p + (s.spend[c].base[0] ?? 0), 0);
  if (baseSmall.pLow > RISK_CAP || baseline.deterministicChange < 0) {
    let f = 0.1;
    if (baseSmall.pLow > RISK_CAP) {
      let lo = 0;
      let hi = MAX_TRIM;
      if (run(trimScenario(hi)).pLow > RISK_CAP) f = hi;
      else {
        for (let it = 0; it < 6; it++) {
          const mid = (lo + hi) / 2;
          if (run(trimScenario(mid)).pLow <= RISK_CAP) hi = mid;
          else lo = mid;
        }
        f = Math.ceil(hi * 100) / 100;
      }
    }
    const after = run(trimScenario(f)).pLow;
    actions.push({
      kind: 'trim_discretionary',
      amountCents: Math.round(discretionaryMonthly * f),
      fraction: f,
      annualSavingCents: Math.round(discretionaryMonthly * f * 12),
      pLowBefore: baseSmall.pLow,
      pLowAfter: after,
      detail:
        baseSmall.pLow > RISK_CAP
          ? `Trim dining, shopping and other discretionary spending by ${Math.round(f * 100)}% to bring the chance of running low ${after <= RISK_CAP ? 'under' : 'closer to'} 5%.`
          : `Your cash is drifting down each month; trimming discretionary spending by ${Math.round(f * 100)}% slows the drain.`,
    });
  }

  // ---- the "following the coach" path ----
  const trim = actions.find(x => x.kind === 'trim_discretionary');
  const coachScenario: Scenario = {
    ...(trim ? trimScenario(trim.fraction) : base),
    id: 'coach',
    label: 'Following the coach',
    moveToDebtCents: best,
  };
  const coach = run(coachScenario, true);
  return { baseline, coach, stresses, sensitivities, frontier, actions };
}
