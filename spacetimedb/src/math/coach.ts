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

export type ActionKind =
  | 'move_cash_to_debt'
  | 'trim_discretionary'
  | 'trim_category'
  | 'protect_income'
  | 'reserve_for_surprises'
  | 'close_monthly_gap';

export interface CoachAction {
  kind: ActionKind;
  driver: string; // the risk source this action targets ('' if none)
  amountCents: number; // move/reserve: one-time cents; trims/gap: cents per month
  fraction: number; // trims: share of the spending cut; move: share of max movable
  annualSavingCents: number;
  pLowBefore: number;
  pLowAfter: number;
  esBefore: number; // average loss of cash in the worst 5% of futures, before → after
  esAfter: number;
  detail: string;
}

export interface Driver {
  source: string;
  label: string;
  esContribution: number;
  share: number; // of the uncertain part of the worst case
}

export interface Analysis {
  baseline: ForecastResult;
  coach: ForecastResult;
  stresses: ForecastResult[];
  sensitivities: { lever: string; label: string; deltaPLow: number; deltaEndP50: number }[];
  frontier: { moveCents: number; pLow: number; annualSavingCents: number; recommended: boolean }[];
  actions: CoachAction[];
  drivers: Driver[];
}

export function sourceLabel(source: string): string {
  if (source === 'income') return 'a drop in income';
  if (source === 'unexpected_bills') return 'surprise bills';
  if (source === 'card_and_other') return 'card interest and timing';
  if (source === 'planned_cash_flow') return 'regular outflows above income';
  if (source.startsWith('spend:')) return `${source.slice(6).replace('_', ' ')} spending`;
  return source;
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

const usdText = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

/**
 * @param monthlyOutflowCents essential monthly outflow (book snapshot). The coach never moves cash below
 *        BUFFER_MONTHS × this (same buffer as the carry "fixable leak"), and keeps the chance of running
 *        low ≤ RISK_CAP.
 */
export function analyze(s: Schedule, a: Assumptions, seed: number, includeExternal: boolean, monthlyOutflowCents: number): Analysis {
  const months = s.months.length + 1;
  const tapes = makeTapes(seed, a, months);
  const small: Assumptions = { ...a, pairs: Math.min(SEARCH_PAIRS, a.pairs) };
  const smallTapes: Tape[] = tapes.slice(0, small.pairs);
  const base: Scenario = { id: 'baseline', label: 'If nothing changes', includeExternal };
  const run = (sc: Scenario, full = false) => runForecast(s, full ? a : small, sc, full ? tapes : smallTapes);
  const feasible = (r: ForecastResult) => r.pLow <= RISK_CAP;

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

  // ---- what drives the worst case (expected-shortfall attribution, uncertain part only) ----
  const uncertain = baseline.sources.filter(x => x.source !== 'planned_cash_flow' && x.esContribution > 0);
  const uncertainTotal = uncertain.reduce((p, x) => p + x.esContribution, 0);
  const drivers: Driver[] = uncertain
    .map(x => ({ source: x.source, label: sourceLabel(x.source), esContribution: x.esContribution, share: uncertainTotal ? x.esContribution / uncertainTotal : 0 }))
    .sort((x, y) => y.esContribution - x.esContribution);
  const top = drivers[0];

  // ---- frontier: move cash to high-cost debt ----
  const capacity = highCostTargets(s).reduce((p, t) => p + t.balance, 0);
  const maxMove = Math.max(0, Math.min(s.startLiquid - BUFFER_MONTHS * monthlyOutflowCents, capacity));
  const at = (amt: number) => (amt === 0 ? baseSmall : run({ ...base, id: 'frontier', moveToDebtCents: amt }));
  const frontier: Analysis['frontier'] = [];
  let best = 0;
  if (maxMove > 0) {
    let prevOk = 0;
    let firstBad = -1;
    for (let i = 0; i <= 10; i++) {
      const amt = Math.round((maxMove * i) / 10);
      const r = at(amt);
      frontier.push({ moveCents: amt, pLow: r.pLow, annualSavingCents: annualSaving(s, amt), recommended: false });
      if (feasible(r) && firstBad < 0) prevOk = amt;
      else if (firstBad < 0) firstBad = amt;
    }
    if (feasible(baseSmall)) {
      best = prevOk;
      if (firstBad > 0) {
        let lo = prevOk;
        let hi = firstBad;
        for (let it = 0; it < 6; it++) {
          const mid = Math.round((lo + hi) / 2);
          if (feasible(at(mid))) lo = mid;
          else hi = mid;
        }
        best = lo;
      }
      best = Math.floor(best / 10_000) * 10_000; // round down to $100
    }
    const r = at(best);
    frontier.push({ moveCents: best, pLow: r.pLow, annualSavingCents: annualSaving(s, best), recommended: true });
    frontier.sort((x, y) => x.moveCents - y.moveCents || Number(x.recommended) - Number(y.recommended));
  }

  const actions: CoachAction[] = [];
  // Action effects use the full path set so their numbers match the baseline shown elsewhere.
  const full = (sc: Partial<Scenario>) => run({ ...base, id: 'action', ...sc }, true);
  const afterMove = best > 0 ? full({ moveToDebtCents: best }) : baseline;
  if (best > 0) {
    actions.push({
      kind: 'move_cash_to_debt',
      driver: '',
      amountCents: best,
      fraction: best / maxMove,
      annualSavingCents: annualSaving(s, best),
      pLowBefore: baseline.pLow,
      pLowAfter: afterMove.pLow,
      esBefore: baseline.es95,
      esAfter: afterMove.es95,
      detail: `Pay down the highest-APR debt first with ${usdText(best)} of spare cash. You still keep a ${BUFFER_MONTHS}-month buffer and the chance of running low stays under 5%.`,
    });
  }

  // ---- spending scenarios used by the driver and gap actions ----
  const discretionaryMonthly = DISCRETIONARY.reduce((p, c) => p + (s.spend[c].base[0] ?? 0), 0);
  const trimDisc = (f: number): Scenario => ({
    ...base,
    id: 'trim',
    categoryMult: Object.fromEntries(DISCRETIONARY.map(c => [c, 1 - f])) as Partial<Record<Category, number>>,
  });
  let discFraction = 0; // discretionary trim carried into the coach path
  let categoryTrim: { cat: Category; f: number } | null = null;

  // ---- structural gap: regular outflows above income ----
  const monthsInHorizon = a.horizonDays / 30.4;
  const gap = -baseline.deterministicChange / monthsInHorizon; // cents per month draining
  if (gap > 0 && discretionaryMonthly > 0) {
    const f = Math.min(MAX_TRIM, Math.ceil((gap / discretionaryMonthly) * 100) / 100);
    const r = run(trimDisc(f), true);
    discFraction = Math.max(discFraction, f);
    const covered = Math.min(1, (discretionaryMonthly * f) / gap);
    actions.push({
      kind: 'close_monthly_gap', driver: 'planned_cash_flow', amountCents: Math.round(discretionaryMonthly * f), fraction: f,
      annualSavingCents: Math.round(discretionaryMonthly * f * 12), pLowBefore: baseline.pLow, pLowAfter: r.pLow,
      esBefore: baseline.es95, esAfter: r.es95,
      detail:
        `Your regular outflows run about ${usdText(gap)} a month above your income. ` +
        (covered >= 0.99
          ? `Trimming extras by ${Math.round(f * 100)}% closes that gap.`
          : `Trimming extras by ${Math.round(f * 100)}% covers about ${Math.round(covered * 100)}% of it; the rest needs a change in fixed costs or income.`),
    });
  } else if (!feasible(baseSmall)) {
    // risk is above the limits even without a drain: find the trim that brings it back
    let lo = 0;
    let hi = MAX_TRIM;
    let f = hi;
    if (feasible(run(trimDisc(hi)))) {
      for (let it = 0; it < 6; it++) {
        const mid = (lo + hi) / 2;
        if (feasible(run(trimDisc(mid)))) hi = mid;
        else lo = mid;
      }
      f = Math.ceil(hi * 100) / 100;
    }
    const r = run(trimDisc(f), true);
    discFraction = Math.max(discFraction, f);
    actions.push({
      kind: 'trim_discretionary', driver: '', amountCents: Math.round(discretionaryMonthly * f), fraction: f,
      annualSavingCents: Math.round(discretionaryMonthly * f * 12), pLowBefore: baseline.pLow, pLowAfter: r.pLow,
      esBefore: baseline.es95, esAfter: r.es95,
      detail: `Trim dining, shopping and other extras by ${Math.round(f * 100)}% to bring your risk ${feasible(r) ? 'back within' : 'closer to'} safe limits.`,
    });
  }

  // ---- action aimed at the biggest driver of a bad outcome ----
  if (top) {
    const pct = Math.round(top.share * 100);
    if (top.source.startsWith('spend:')) {
      const cat = top.source.slice(6) as Category;
      const f = 0.1;
      const r = full({ categoryMult: { [cat]: 1 - f } });
      categoryTrim = { cat, f };
      const monthly = (s.spend[cat].base[0] ?? 0) * f;
      actions.push({
        kind: 'trim_category', driver: top.source, amountCents: Math.round(monthly), fraction: f,
        annualSavingCents: Math.round(monthly * 12), pLowBefore: baseline.pLow, pLowAfter: r.pLow,
        esBefore: baseline.es95, esAfter: r.es95,
        detail: `${top.label[0].toUpperCase()}${top.label.slice(1)} is the biggest swing factor in your bad outcomes (${pct}% of the uncertain part). Trimming it by 10% targets that risk directly.`,
      });
    } else if (top.source === 'income') {
      // Income risk is answered by the cash buffer the coach always keeps; add a trim only if none is planned yet.
      const f = discFraction > 0 ? 0 : 0.1;
      const r = f ? run(trimDisc(f), true) : baseline;
      discFraction = Math.max(discFraction, f);
      actions.push({
        kind: 'protect_income', driver: top.source, amountCents: Math.round(discretionaryMonthly * f), fraction: f,
        annualSavingCents: Math.round(discretionaryMonthly * f * 12), pLowBefore: baseline.pLow, pLowAfter: r.pLow,
        esBefore: baseline.es95, esAfter: r.es95,
        detail:
          `A drop in income drives ${pct}% of the uncertain part of your worst outcomes, which is why the coach always leaves a ${BUFFER_MONTHS}-month cash buffer` +
          (f ? ` and suggests trimming extras by 10% to grow it.` : `.`),
      });
    } else if (top.source === 'unexpected_bills') {
      const reserve = Math.round(a.jumpMedianCents * Math.exp(1.645 * a.jumpSigma)); // a 1-in-20 surprise bill
      const withLessMove = full({ moveToDebtCents: Math.max(0, best - reserve) });
      actions.push({
        kind: 'reserve_for_surprises', driver: top.source, amountCents: reserve, fraction: 0,
        annualSavingCents: 0, pLowBefore: afterMove.pLow, pLowAfter: withLessMove.pLow,
        esBefore: afterMove.es95, esAfter: withLessMove.es95,
        detail: `Surprise bills drive ${pct}% of the uncertain part of your worst outcomes. Keep about ${usdText(reserve)} set aside for them in your Reserve account.`,
      });
    }
  }

  // ---- the "following the coach" path: every recommended change together ----
  const mult: Partial<Record<Category, number>> = {};
  if (discFraction > 0) for (const c of DISCRETIONARY) mult[c] = 1 - discFraction;
  if (categoryTrim) mult[categoryTrim.cat] = Math.min(mult[categoryTrim.cat] ?? 1, 1 - categoryTrim.f);
  const coach = run({ ...base, id: 'coach', label: 'Following the coach', moveToDebtCents: best, categoryMult: mult }, true);
  return { baseline, coach, stresses, sensitivities, frontier, actions, drivers };
}
