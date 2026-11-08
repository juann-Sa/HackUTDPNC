// Spec §4–§7: daily Monte Carlo of liquid cash (checking + savings) over the horizon.
//   income: two-state employment regime (Markov, monthly) × small lognormal noise
//   spending: baseline × exp(e), e = φ·e₋₁ + σ_shared·t_shared + σ_idio·t_k   (Student-t, ν = 5)
//   rare large bills: compound Poisson (λ per year, lognormal size)
//   card: purchases accrue, interest at APR/12, paid on the usual day
//   loans: scheduled payments until paid off; CD/IRA: contributions, CD at its yield, IRA by GBM
// Variance reduction: antithetic pairs over a shared tape of uniforms; every scenario reads the
// same tapes in the same order (common random numbers).
import { CATEGORIES, type Category, eventsFor, lastDayOfMonth } from './calendar';
import { dayNumber, isoFromDayNumber } from './dates';
import { Draws, Tape, seedOf } from './rng';
import type { Schedule } from './schedule';

export interface Assumptions {
  horizonDays: number;
  pairs: number; // antithetic pairs → paths = 2 × pairs
  thresholdCents: number; // "running low" line for liquid cash
  nu: number; // Student-t degrees of freedom
  jumpsPerYear: number;
  jumpMedianCents: number;
  jumpSigma: number;
  pEmployedToJobLoss: number; // monthly
  pJobLossToEmployed: number; // monthly
  incomeWhileUnemployed: number; // fraction of paycheck
  iraMu: number;
  iraSigma: number;
  /** Checking ("Spend") balance below which a day counts as a danger day (PNC Low Cash Mode style). */
  dangerThresholdCents: number;
}

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  horizonDays: 180,
  pairs: 500,
  thresholdCents: 50_000,
  nu: 5,
  jumpsPerYear: 1.5,
  jumpMedianCents: 80_000,
  jumpSigma: 0.8,
  pEmployedToJobLoss: 0.005,
  pJobLossToEmployed: 0.25,
  incomeWhileUnemployed: 0,
  iraMu: 0.07,
  iraSigma: 0.15,
  dangerThresholdCents: 10_000,
};

/**
 * "Habit" view: only normal month-to-month variation in income and spending, no rare bills and no
 * job loss. Answers "if you keep spending like this"; life events are shown separately as stress tests.
 */
export function habitAssumptions(a: Assumptions): Assumptions {
  return { ...a, jumpsPerYear: 0, pEmployedToJobLoss: 0 };
}

export interface Scenario {
  id: string;
  label: string;
  includeExternal: boolean;
  incomeMult?: number;
  categoryMult?: Partial<Record<Category, number>>;
  oneOff?: { dayIndex: number; cents: number };
  /** Cash moved to high-cost debt at t0 (avalanche: highest APR first). */
  moveToDebtCents?: number;
  jobLossMonths?: number;
  cardAprBumpPct?: number;
  /** Money kept each month by spending less (added to cash at each month start). */
  extraMonthlyCents?: number;
  /** A financed purchase (car, home...): down payment leaves cash on dayIndex, then a fixed
   *  amortized payment every month on that day of the month until the loan is paid off. */
  newLoan?: NewLoan;
}

export interface NewLoan {
  dayIndex: number;
  downCents: number;
  principalCents: number;
  aprPct: number;
  paymentCents: number;
  label: string;
}

/** Fixed monthly payment that pays off `principal` over `months` at `aprPct` (standard amortization). */
export function amortizedPayment(principalCents: number, aprPct: number, months: number): number {
  if (principalCents <= 0 || months <= 0) return 0;
  const r = aprPct / 1200;
  return r === 0 ? principalCents / months : (principalCents * r) / (1 - Math.pow(1 + r, -months));
}

export const SOURCES = ['income', ...CATEGORIES.map(c => `spend:${c}`), 'unexpected_bills', 'card_and_other'] as const;

/** Tape layout per antithetic pair (fixed, so CRN holds across scenarios). */
const PER_MONTH_FLIP = 1 + CATEGORIES.length + 3; // shared t, idio t ×K, income z, regime u, market z
const PER_DAY_FLIP = 2; // jump u, jump size z
const PER_PATH_FLIP = 1; // spending-level estimation error (drawn once, first)

export function makeTapes(customerSeed: number, a: Assumptions, months: number): Tape[] {
  const nFlip = PER_PATH_FLIP + months * PER_MONTH_FLIP + (a.horizonDays + 1) * PER_DAY_FLIP;
  const nKeep = months * (1 + CATEGORIES.length) * a.nu;
  return Array.from({ length: a.pairs }, (_, i) => new Tape(seedOf(customerSeed, i), nFlip, nKeep));
}

interface Calendar {
  iso: string[];
  monthIdx: number[];
  dom: number[];
  monthStart: boolean[];
  monthEnd: boolean[];
  /** per month: category → list of [day, share]; remainder goes to the usual day */
  events: { day: number; share: number; category: Category }[][];
}

function buildCalendar(s: Schedule, horizonDays: number): Calendar {
  const start = dayNumber(s.asOf) + 1;
  const cal: Calendar = { iso: [], monthIdx: [], dom: [], monthStart: [], monthEnd: [], events: [] };
  let mi = -1;
  let curM = -1;
  for (let k = 0; k < horizonDays; k++) {
    const iso = isoFromDayNumber(start + k);
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    const d = Number(iso.slice(8, 10));
    if (m !== curM) {
      mi++;
      curM = m;
      const evs = eventsFor(y, m);
      for (const e of evs) eventLabel.set(`${y}-${String(m).padStart(2, '0')}-${String(e.day).padStart(2, '0')}|${e.category}`, e.name);
      cal.events.push(evs.map(e => ({ day: e.day, share: e.share, category: e.category })));
    }
    cal.iso.push(iso);
    cal.monthIdx.push(mi);
    cal.dom.push(d);
    cal.monthStart.push(k === 0 || d === 1);
    cal.monthEnd.push(d === lastDayOfMonth(y, m));
  }
  return cal;
}

/** Share of a category's monthly amount posted on day `dom` (events + usual day remainder). */
function dayShare(events: Calendar['events'][number], cat: Category, usualDay: number, dom: number, lastDom: number): number {
  let ev = 0;
  let onDay = 0;
  for (const e of events) {
    if (e.category !== cat) continue;
    ev += e.share;
    if (e.day === dom) onDay += e.share;
  }
  const usual = Math.min(usualDay, lastDom);
  return onDay + (usual === dom ? 1 - ev : 0);
}

export interface PathResult {
  liquid: Float64Array; // day 0..H
  /** liquid − high-cost debt (APR ≥ 10%): neutral to moving cash onto that debt */
  netCash: Float64Array;
  endNetWorth: number;
  dev: Float64Array; // per SOURCES
}

/**
 * Simulate one path. `draws === null` gives the deterministic (noise-free, employed) path.
 */
function simulatePath(s: Schedule, a: Assumptions, sc: Scenario, cal: Calendar, draws: Draws | null): PathResult {
  const H = a.horizonDays;
  const K = CATEGORIES.length;
  const liquid = new Float64Array(H + 1);
  const netCash = new Float64Array(H + 1);
  const dev = new Float64Array(SOURCES.length);
  const incomeMult = sc.incomeMult ?? 1;
  const catMult = CATEGORIES.map(c => sc.categoryMult?.[c] ?? 1);

  let x = s.startLiquid;
  let cardBal = s.card?.balance ?? 0;
  const cardApr = (s.card?.aprPct ?? 0) + (sc.cardAprBumpPct ?? 0);
  const loanBal = s.loans.map(l => l.balance);
  const lockedBal = s.locked.map(l => l.balance);
  const nl = sc.newLoan;
  let nlBal = 0;
  let nlPayDom = 0;
  const highCostDebt = () =>
    ((s.card && s.card.aprPct >= 10) ? cardBal : 0) +
    s.loans.reduce((p, l, i) => p + (l.aprPct >= 10 ? Math.max(loanBal[i], 0) : 0), 0) +
    (nl && nl.aprPct >= 10 ? nlBal : 0);

  // t0 move: cash to high-cost debt, highest APR first
  let move = Math.min(sc.moveToDebtCents ?? 0, Math.max(x, 0));
  if (move > 0) {
    const targets: { apr: number; apply: (amt: number) => number }[] = [];
    if (s.card && s.card.aprPct >= 10)
      targets.push({ apr: s.card.aprPct, apply: amt => { const p = Math.min(amt, cardBal); cardBal -= p; return p; } });
    s.loans.forEach((l, i) => {
      if (l.aprPct >= 10) targets.push({ apr: l.aprPct, apply: amt => { const p = Math.min(amt, loanBal[i]); loanBal[i] -= p; return p; } });
    });
    targets.sort((p, q) => q.apr - p.apr);
    let used = 0;
    for (const tg of targets) used += tg.apply(move - used);
    move = used;
    x -= move;
  }
  liquid[0] = x;
  netCash[0] = x - highCostDebt();

  // parameter uncertainty: how wrong our spending-level estimate is on this path (same for all months)
  const levelMult = draws ? Math.exp(s.sigmaLevel * draws.normal()) : 1;
  let employed = true;
  const e = new Float64Array(K); // AR spending log-shocks
  const monthSpend = new Float64Array(K);
  const monthSpendDet = new Float64Array(K);
  let incNoise = 1;
  let marketZ = 0;
  let unpaid = 0; // card purchases since last payment
  const unpaidDev = new Float64Array(K);

  for (let k = 0; k < H; k++) {
    const mi = cal.monthIdx[k];
    const dom = cal.dom[k];
    const iso = cal.iso[k];
    const lastDom = lastDayOfMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));

    if (cal.monthStart[k]) {
      // fixed draw order per month (CRN): shared t, idio t ×K, income z, regime u, market z
      const tShared = draws ? draws.studentT(a.nu) : 0;
      for (let c = 0; c < K; c++) {
        const tIdio = draws ? draws.studentT(a.nu) : 0;
        e[c] = s.phi * e[c] + s.sigmaShared * tShared + s.sigmaIdio * tIdio;
        const base = (s.spend[CATEGORIES[c]].base[mi] ?? 0) * catMult[c];
        monthSpend[c] = base * (draws ? levelMult * Math.exp(e[c]) : 1);
        monthSpendDet[c] = base;
      }
      const zInc = draws ? draws.normal() : 0;
      incNoise = Math.exp(s.incomeSigma * zInc - (draws ? 0.5 * s.incomeSigma ** 2 : 0));
      const uReg = draws ? draws.uniform() : 0.999999;
      if (mi < (sc.jobLossMonths ?? 0)) employed = false;
      else if (employed) employed = uReg >= a.pEmployedToJobLoss;
      else employed = uReg < a.pJobLossToEmployed;
      marketZ = draws ? draws.normal() : 0;
    }

    // income
    for (const inc of s.income) {
      if (inc.day !== dom && !(inc.day > lastDom && dom === lastDom)) continue;
      const det = inc.cents * incomeMult;
      const amt = det * (employed ? incNoise : a.incomeWhileUnemployed);
      x += amt;
      dev[0] += amt - det;
    }
    // external transfers (linked outside accounts)
    if (sc.includeExternal) {
      if (dom === Math.min(s.external.inDay, lastDom)) x += s.external.inPerMonth;
      if (dom === Math.min(s.external.outDay, lastDom)) x -= s.external.outPerMonth;
    }
    // spending: cash portion leaves now; card portion accrues on the card
    for (let c = 0; c < K; c++) {
      const sp = s.spend[CATEGORIES[c]];
      const cashSh = dayShare(cal.events[mi], CATEGORIES[c], sp.cashDay, dom, lastDom);
      const cardSh = dayShare(cal.events[mi], CATEGORIES[c], sp.cardDay, dom, lastDom);
      if (cashSh) {
        const amt = monthSpend[c] * (1 - sp.cardShare) * cashSh;
        const det = monthSpendDet[c] * (1 - sp.cardShare) * cashSh;
        x -= amt;
        dev[1 + c] -= amt - det;
      }
      if (cardSh && s.card) {
        const amt = monthSpend[c] * sp.cardShare * cardSh;
        cardBal += amt;
        unpaid += amt;
        unpaidDev[c] += amt - monthSpendDet[c] * sp.cardShare * cardSh;
      }
    }
    // card statement: interest + fees + purchases since last payment + usual paydown
    if (s.card && dom === Math.min(s.card.payDay, lastDom)) {
      const interest = (cardBal * cardApr) / 1200;
      cardBal += interest + s.card.feesPerMonth;
      const due = unpaid + interest + s.card.feesPerMonth + s.card.paydown;
      const pay = Math.max(0, Math.min(cardBal, due));
      cardBal -= pay;
      x -= pay;
      for (let c = 0; c < K; c++) dev[1 + c] -= unpaidDev[c];
      unpaid = 0;
      unpaidDev.fill(0);
    }
    // loans
    s.loans.forEach((l, i) => {
      if (dom !== Math.min(l.day, lastDom) || loanBal[i] <= 0) return;
      const interest = (loanBal[i] * l.aprPct) / 1200;
      const pay = Math.min(l.payment, loanBal[i] + interest + l.feePerMonth);
      loanBal[i] += interest + l.feePerMonth - pay;
      x -= pay;
    });
    // contributions to CD / IRA
    s.locked.forEach((l, i) => {
      if (dom !== Math.min(l.day, lastDom) || l.contribution <= 0) return;
      x -= l.contribution;
      lockedBal[i] += l.contribution;
    });
    // rare large bills (always draw both numbers to keep the tape aligned)
    const uJ = draws ? draws.uniform() : 1;
    const zJ = draws ? draws.normal() : 0;
    if (uJ < a.jumpsPerYear / 365) {
      const bill = a.jumpMedianCents * Math.exp(a.jumpSigma * zJ);
      x -= bill;
      dev[1 + K] -= bill;
    }
    if (sc.oneOff && sc.oneOff.dayIndex === k) x -= sc.oneOff.cents;
    // financed purchase: down payment on the day, then the monthly payment from the next month on
    if (nl) {
      if (k === nl.dayIndex) {
        x -= nl.downCents;
        nlBal = nl.principalCents;
        nlPayDom = Math.min(dom, 28);
      } else if (k > nl.dayIndex && nlBal > 0 && dom === Math.min(nlPayDom, lastDom)) {
        const interest = (nlBal * nl.aprPct) / 1200;
        const pay = Math.min(nl.paymentCents, nlBal + interest);
        nlBal += interest - pay;
        x -= pay;
      }
    }
    if (sc.extraMonthlyCents && cal.monthStart[k]) x += sc.extraMonthlyCents;
    // month end: savings interest, CD accrual, IRA market move
    if (cal.monthEnd[k]) {
      x += (s.savingsBalance * s.savingsYieldPct) / 1200;
      s.locked.forEach((l, i) => {
        if (l.type === 'ira') {
          lockedBal[i] *= Math.exp((a.iraMu - 0.5 * a.iraSigma ** 2) / 12 + (a.iraSigma / Math.sqrt(12)) * marketZ);
        } else lockedBal[i] *= 1 + l.yieldPct / 1200;
      });
    }
    liquid[k + 1] = x;
    netCash[k + 1] = x - highCostDebt();
  }
  // (the purchased item itself is not counted as an asset: the forecast tracks money, not cars)
  const endNetWorth = x + lockedBal.reduce((p, v) => p + v, 0) - cardBal - loanBal.reduce((p, v) => p + Math.max(v, 0), 0) - nlBal;
  return { liquid, netCash, endNetWorth, dev };
}

/** The biggest scheduled outflows on a forecast day (expected amounts), as a short readable list. */
function dayReasons(s: Schedule, cal: Calendar, k: number, sc?: Scenario): string {
  const mi = cal.monthIdx[k];
  const dom = cal.dom[k];
  const iso = cal.iso[k];
  const last = lastDayOfMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
  const items: { label: string; cents: number }[] = [];
  const evs = cal.events[mi];
  for (const c of CATEGORIES) {
    const sp = s.spend[c];
    const share = dayShare(evs, c, sp.cashDay, dom, last);
    if (!share) continue;
    const ev = evs.find(e => e.category === c && e.day === dom);
    const name = ev ? (eventLabel.get(`${iso}|${c}`) ?? c.replace('_', ' ')) : c === 'housing' ? 'rent/housing' : c.replace('_', ' ');
    items.push({ label: name, cents: (sp.base[mi] ?? 0) * (1 - sp.cardShare) * share });
  }
  if (s.card && dom === Math.min(s.card.payDay, last)) {
    const purchases = CATEGORIES.reduce((p, c) => p + (s.spend[c].base[mi] ?? 0) * s.spend[c].cardShare, 0);
    items.push({ label: 'card payment', cents: purchases + (s.card.balance * s.card.aprPct) / 1200 });
  }
  for (const l of s.loans) if (dom === Math.min(l.day, last)) items.push({ label: `${l.type.replace('_', ' ')} payment`, cents: l.payment });
  const nl = sc?.newLoan;
  if (nl) {
    if (k === nl.dayIndex) items.push({ label: `${nl.label} down payment`, cents: nl.downCents });
    else if (k > nl.dayIndex && dom === Math.min(Math.min(cal.dom[nl.dayIndex], 28), last)) items.push({ label: `${nl.label} payment`, cents: nl.paymentCents });
  }
  for (const l of s.locked) if (dom === Math.min(l.day, last) && l.contribution > 0) items.push({ label: `${l.type.toUpperCase()} contribution`, cents: l.contribution });
  return items
    .filter(i => i.cents >= 2_000)
    .sort((x, y) => y.cents - x.cents)
    .slice(0, 3)
    .map(i => i.label)
    .join(', ');
}

const eventLabel = new Map<string, string>();

export function quantile(sorted: Float64Array | number[], p: number): number {
  const n = sorted.length;
  if (!n) return 0;
  const r = (n - 1) * p;
  const lo = Math.floor(r);
  const hi = Math.min(lo + 1, n - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}

export interface ForecastResult {
  scenario: Scenario;
  dates: string[];
  bands: { p5: number; p25: number; p50: number; p75: number; p95: number }[]; // day 0..H
  /** bands of liquid − high-cost debt (used for the continue-vs-coach comparison) */
  netCashBands: { p5: number; p50: number; p95: number }[];
  pLow: number;
  pLowSe: number;
  var95: number;
  es95: number;
  /** Average ending cash across the worst 5% of futures (same tail as ES95). */
  tailEndLiquid: number;
  mddP50: number;
  mddP95: number;
  endLiquid: { p5: number; p50: number; p95: number };
  endNetWorth: { p5: number; p50: number; p95: number };
  deterministicChange: number;
  /** Per future day: chance checking dips below the danger threshold / below zero, 10th percentile, why. */
  danger: { date: string; pBelow: number; pNegative: number; checkingP10: number; reasons: string }[];
  /** variance share and expected-shortfall contribution per source */
  sources: { source: string; varShare: number; esContribution: number }[];
}

export function runForecast(s: Schedule, a: Assumptions, sc: Scenario, tapes: Tape[]): ForecastResult {
  const cal = buildCalendar(s, a.horizonDays);
  const H = a.horizonDays;
  const det = simulatePath(s, a, sc, cal, null);
  const paths: PathResult[] = [];
  for (let i = 0; i < a.pairs; i++) {
    paths.push(simulatePath(s, a, sc, cal, new Draws(tapes[i], false)));
    paths.push(simulatePath(s, a, sc, cal, new Draws(tapes[i], true)));
  }
  const N = paths.length;
  const bands: ForecastResult['bands'] = [];
  const col = new Float64Array(N);
  for (let d = 0; d <= H; d++) {
    for (let i = 0; i < N; i++) col[i] = paths[i].liquid[d];
    col.sort();
    bands.push({ p5: quantile(col, 0.05), p25: quantile(col, 0.25), p50: quantile(col, 0.5), p75: quantile(col, 0.75), p95: quantile(col, 0.95) });
  }
  const netCashBands: ForecastResult['netCashBands'] = [];
  for (let d = 0; d <= H; d++) {
    for (let i = 0; i < N; i++) col[i] = paths[i].netCash[d];
    col.sort();
    netCashBands.push({ p5: quantile(col, 0.05), p50: quantile(col, 0.5), p95: quantile(col, 0.95) });
  }
  const low = paths.map(p => (p.liquid.some(v => v < a.thresholdCents) ? 1 : 0));
  const pairMeans: number[] = [];
  for (let i = 0; i < a.pairs; i++) pairMeans.push((low[2 * i] + low[2 * i + 1]) / 2);
  const pLow = pairMeans.reduce((s2, v) => s2 + v, 0) / a.pairs;
  const pmVar = pairMeans.reduce((s2, v) => s2 + (v - pLow) ** 2, 0) / Math.max(a.pairs - 1, 1);
  const pLowSe = Math.sqrt(pmVar / a.pairs);

  const change = paths.map(p => p.liquid[H] - p.liquid[0]);
  const sortedChange = Float64Array.from(change).sort();
  const q05 = quantile(sortedChange, 0.05);
  const tail = change.map((v, i) => [v, i] as const).filter(([v]) => v <= q05);
  const es95 = -tail.reduce((s2, [v]) => s2 + v, 0) / tail.length;
  const tailEndLiquid = tail.reduce((s2, [, i]) => s2 + paths[i].liquid[H], 0) / tail.length;
  const mdd = Float64Array.from(
    paths.map(p => {
      let peak = -Infinity;
      let worst = 0;
      for (const v of p.liquid) {
        peak = Math.max(peak, v);
        worst = Math.max(worst, peak - v);
      }
      return worst;
    })
  ).sort();
  const endL = Float64Array.from(paths.map(p => p.liquid[H])).sort();
  const endNW = Float64Array.from(paths.map(p => p.endNetWorth)).sort();

  // risk decomposition: ΔX − ΔX_det = Σ dev_k (residual folded into card_and_other)
  const detChange = det.liquid[H] - det.liquid[0];
  const lastIdx = SOURCES.length - 1;
  for (let i = 0; i < N; i++) {
    let sum = 0;
    for (let k = 0; k < lastIdx; k++) sum += paths[i].dev[k];
    paths[i].dev[lastIdx] = change[i] - detChange - sum;
  }
  const meanChange = change.reduce((s2, v) => s2 + v, 0) / N;
  const varChange = change.reduce((s2, v) => s2 + (v - meanChange) ** 2, 0) / N;
  const sources = SOURCES.map((source, k) => {
    const dk = paths.map(p => p.dev[k]);
    const mk = dk.reduce((s2, v) => s2 + v, 0) / N;
    const cov = dk.reduce((s2, v, i) => s2 + (v - mk) * (change[i] - meanChange), 0) / N;
    const esC = -tail.reduce((s2, [, i]) => s2 + paths[i].dev[k], 0) / tail.length;
    return { source, varShare: varChange > 0 ? cov / varChange : 0, esContribution: esC };
  });
  // The certain part of the worst case: scheduled outflows minus income with no surprises.
  // With it, Σ esContribution = ES95 exactly.
  sources.unshift({ source: 'planned_cash_flow', varShare: 0, esContribution: -detChange });
  // ---- danger days: checking = liquid − (scheduled savings balance + linked outside cash) ----
  const savPath = new Float64Array(H + 1);
  let sav = s.savingsBalance + s.externalLiquid;
  savPath[0] = sav;
  for (let k = 0; k < H; k++) {
    const iso = cal.iso[k];
    const last = lastDayOfMonth(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)));
    for (const f of s.savingsFlows) if (f.day === cal.dom[k] || (f.day > last && cal.dom[k] === last)) sav += f.cents;
    savPath[k + 1] = sav;
  }
  const danger: ForecastResult['danger'] = [];
  const chk = new Float64Array(N);
  for (let d = 1; d <= H; d++) {
    let below = 0;
    let neg = 0;
    for (let i = 0; i < N; i++) {
      const c = paths[i].liquid[d] - savPath[d];
      chk[i] = c;
      if (c < a.dangerThresholdCents) below++;
      if (c < 0) neg++;
    }
    chk.sort();
    danger.push({ date: cal.iso[d - 1], pBelow: below / N, pNegative: neg / N, checkingP10: quantile(chk, 0.1), reasons: dayReasons(s, cal, d - 1, sc) });
  }

  return {
    scenario: sc,
    danger,
    dates: [isoFromDayNumber(dayNumber(s.asOf)), ...cal.iso],
    bands,
    netCashBands,
    pLow,
    pLowSe,
    var95: -q05,
    es95,
    tailEndLiquid,
    mddP50: quantile(mdd, 0.5),
    mddP95: quantile(mdd, 0.95),
    endLiquid: { p5: quantile(endL, 0.05), p50: quantile(endL, 0.5), p95: quantile(endL, 0.95) },
    endNetWorth: { p5: quantile(endNW, 0.05), p50: quantile(endNW, 0.5), p95: quantile(endNW, 0.95) },
    deterministicChange: detChange,
    sources,
  };
}

/**
 * Liquid cash on one day for every path (antithetic pairs adjacent: path 2i and 2i+1 share tape i).
 * Used for goals, which only care about the balance on their target date.
 */
export function liquidOnDay(s: Schedule, a: Assumptions, sc: Scenario, tapes: Tape[], dayIndex: number): Float64Array {
  const cal = buildCalendar(s, a.horizonDays);
  const out = new Float64Array(2 * a.pairs);
  for (let i = 0; i < a.pairs; i++) {
    out[2 * i] = simulatePath(s, a, sc, cal, new Draws(tapes[i], false)).liquid[dayIndex];
    out[2 * i + 1] = simulatePath(s, a, sc, cal, new Draws(tapes[i], true)).liquid[dayIndex];
  }
  return out;
}
