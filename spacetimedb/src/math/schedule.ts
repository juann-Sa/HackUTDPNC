// Spec §4 inputs: turn a customer's ledger into a forward cash-flow schedule.
// Liquid = checking + savings. Every liquid-account entry is classified into a stream:
//   income (paychecks) · cash spending by category · card payment · loan payment ·
//   contribution to CD/IRA · savings interest · external (outside-bank) transfer.
// Transfers between checking and savings cancel inside "liquid" and are ignored.
// Card purchases hit the card balance; cash moves when the card is paid.
import { CATEGORIES, type Category, EVENT_NAMES, popLogFactor } from './calendar';
import { dayNumber, isoFromDayNumber } from './dates';

export interface LedgerRow {
  transaction_id: string;
  account_id: string;
  account_type: string;
  posted_date: string;
  transaction_type: string;
  category: string;
  description: string;
  flow_class: string;
  amount_cents: number;
  balance_change_cents: number;
  balance_after_cents: number;
  transfer_id: string;
}

export interface AccountRow {
  account_id: string;
  account_type: string;
  balance_cents: number;
  apr_pct: number;
  annual_yield_pct: number;
  monthly_payment_cents: number;
}

/** Shrinkage constant k for personal seasonality, w = n/(n+k); tuned in held-out-customer validation. */
export const SHRINK_K = 0.5;
const FLOW_MONTHS = 6; // look-back for recurring flows
const LEVEL_MONTHS = 12; // look-back for spending level

export interface Schedule {
  asOf: string;
  startLiquid: number;
  savingsBalance: number;
  savingsYieldPct: number;
  /** Paychecks: day of month → average cents per month. */
  income: { day: number; cents: number }[];
  incomeSigma: number;
  /** Baseline spend per category for each forecast month (cents), with channel split and posting days. */
  spend: Record<Category, { base: number[]; cardShare: number; cashDay: number; cardDay: number }>;
  sigmaShared: number;
  sigmaIdio: number;
  phi: number;
  card: { accountId: string; balance: number; aprPct: number; payDay: number; paydown: number; feesPerMonth: number } | null;
  loans: { accountId: string; type: string; balance: number; aprPct: number; payment: number; day: number; feePerMonth: number }[];
  locked: { accountId: string; type: string; balance: number; yieldPct: number; contribution: number; day: number }[];
  external: { inPerMonth: number; outPerMonth: number; inDay: number; outDay: number };
  /** Forecast months covered by the horizon: year, month (1..12). */
  months: { y: number; m: number }[];
  /** Diagnostics for "how we calculated this". */
  seasonal: Record<Category, { level: number; own: number[]; w: number[] }>;
}

const ym = (iso: string) => iso.slice(0, 7);
const mode = (xs: number[], dflt: number) => {
  const c = new Map<number, number>();
  for (const x of xs) c.set(x, (c.get(x) ?? 0) + 1);
  let best = dflt;
  let n = 0;
  for (const [k, v] of c) if (v > n || (v === n && k < best)) [best, n] = [k, v];
  return best;
};
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const variance = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};
const counterpart = (transferId: string) => transferId.split('-')[2] ?? '';

/**
 * @param external accounts at other banks (no ledger here): their cash counts as liquid, their debts as
 *        scheduled payments on the 15th, their CDs/IRAs as locked savings with no new contributions.
 */
export function buildSchedule(
  ledger: LedgerRow[],
  accounts: AccountRow[],
  asOf: string,
  horizonDays: number,
  external: AccountRow[] = []
): Schedule {
  const allMonths = [...new Set(ledger.map(t => ym(t.posted_date)))].sort();
  const flowMonths = new Set(allMonths.slice(-FLOW_MONTHS));
  const nFlow = Math.max(flowMonths.size, 1);
  const liquidTypes = new Set(['checking', 'savings']);
  const acct = (type: string) => accounts.filter(a => a.account_type === type);

  // ---------- recurring cash streams (last FLOW_MONTHS) ----------
  const incomeByDay = new Map<number, number>();
  const incomeByMonth = new Map<string, number>();
  let extIn = 0;
  let extOut = 0;
  const extInDays: number[] = [];
  const extOutDays: number[] = [];
  for (const t of ledger) {
    if (!liquidTypes.has(t.account_type)) continue;
    const day = Number(t.posted_date.slice(8, 10));
    const month = ym(t.posted_date);
    if (t.transaction_type === 'paycheck') {
      incomeByMonth.set(month, (incomeByMonth.get(month) ?? 0) + t.amount_cents);
      if (flowMonths.has(month)) incomeByDay.set(day, (incomeByDay.get(day) ?? 0) + t.amount_cents / nFlow);
    }
    if (t.flow_class === 'external_transfer' && flowMonths.has(month)) {
      if (t.balance_change_cents > 0) {
        extIn += t.amount_cents / nFlow;
        extInDays.push(day);
      } else {
        extOut += t.amount_cents / nFlow;
        extOutDays.push(day);
      }
    }
  }
  const incMonthly = allMonths.slice(-LEVEL_MONTHS).map(m => incomeByMonth.get(m) ?? 0).filter(x => x > 0);
  const incLog = incMonthly.map(x => Math.log(x));
  const incomeSigma = Math.max(0.005, Math.sqrt(variance(incLog.map((x, i) => x - (i ? incLog[i - 1] : x)).slice(1)) / 2));

  // ---------- card ----------
  const cardAcct = acct('credit_card')[0];
  let card: Schedule['card'] = null;
  if (cardAcct) {
    const rows = ledger.filter(t => t.account_id === cardAcct.account_id && flowMonths.has(ym(t.posted_date)));
    const sum = (f: (t: LedgerRow) => boolean) => rows.filter(f).reduce((s, t) => s + t.amount_cents, 0);
    const pays = rows.filter(t => t.transaction_type === 'payment');
    const paydown =
      (sum(t => t.transaction_type === 'payment') - sum(t => t.flow_class === 'expense') -
        sum(t => t.transaction_type === 'interest_accrual') - sum(t => t.transaction_type === 'fee')) / nFlow;
    card = {
      accountId: cardAcct.account_id,
      balance: cardAcct.balance_cents,
      aprPct: cardAcct.apr_pct,
      payDay: mode(pays.map(t => Number(t.posted_date.slice(8, 10))), 28),
      paydown,
      feesPerMonth: sum(t => t.transaction_type === 'fee') / nFlow,
    };
  }

  // ---------- loans and locked savings ----------
  const loans: Schedule['loans'] = [];
  for (const a of accounts.filter(a => ['auto_loan', 'personal_loan', 'mortgage'].includes(a.account_type))) {
    const rows = ledger.filter(t => t.account_id === a.account_id && flowMonths.has(ym(t.posted_date)));
    const pays = rows.filter(t => t.transaction_type === 'payment');
    loans.push({
      accountId: a.account_id,
      type: a.account_type,
      balance: a.balance_cents,
      aprPct: a.apr_pct,
      payment: mean(pays.map(t => t.amount_cents)) || a.monthly_payment_cents,
      day: mode(pays.map(t => Number(t.posted_date.slice(8, 10))), 21),
      feePerMonth: rows.filter(t => t.transaction_type === 'fee').reduce((s, t) => s + t.amount_cents, 0) / nFlow,
    });
  }
  const locked: Schedule['locked'] = [];
  for (const a of accounts.filter(a => a.account_type === 'cd' || a.account_type === 'ira')) {
    const contrib = ledger.filter(
      t => liquidTypes.has(t.account_type) && t.flow_class === 'internal_transfer' &&
        counterpart(t.transfer_id) === a.account_type && t.balance_change_cents < 0 && flowMonths.has(ym(t.posted_date))
    );
    locked.push({
      accountId: a.account_id,
      type: a.account_type,
      balance: a.balance_cents,
      yieldPct: a.annual_yield_pct,
      contribution: contrib.reduce((s, t) => s + t.amount_cents, 0) / nFlow,
      day: mode(contrib.map(t => Number(t.posted_date.slice(8, 10))), 5),
    });
  }

  // ---------- forecast months ----------
  const startDn = dayNumber(asOf) + 1;
  const months: { y: number; m: number }[] = [];
  for (let d = startDn; d < startDn + horizonDays; d++) {
    const iso = isoFromDayNumber(d);
    const y = Number(iso.slice(0, 4));
    const m = Number(iso.slice(5, 7));
    if (!months.length || months[months.length - 1].m !== m) months.push({ y, m });
  }

  // ---------- spending baseline: level × population season × shrunk personal season ----------
  const catMonth = new Map<string, number>(); // `${cat}|${YYYY-MM}` → cents (cash + card)
  const cardAmt = new Map<string, number>();
  const totAmt = new Map<string, number>();
  const cashDays = new Map<string, number[]>();
  const cardDays = new Map<string, number[]>();
  const levelMonths = new Set(allMonths.slice(-LEVEL_MONTHS));
  for (const t of ledger) {
    if (t.flow_class !== 'expense') continue;
    const k = `${t.category}|${ym(t.posted_date)}`;
    catMonth.set(k, (catMonth.get(k) ?? 0) + t.amount_cents);
    if (levelMonths.has(ym(t.posted_date))) {
      totAmt.set(t.category, (totAmt.get(t.category) ?? 0) + t.amount_cents);
      if (t.account_type === 'credit_card') cardAmt.set(t.category, (cardAmt.get(t.category) ?? 0) + t.amount_cents);
    }
    if (!EVENT_NAMES.has(t.description)) {
      const day = Number(t.posted_date.slice(8, 10));
      const bucket = t.account_type === 'credit_card' ? cardDays : cashDays;
      bucket.set(t.category, [...(bucket.get(t.category) ?? []), day]);
    }
  }
  const spend = {} as Schedule['spend'];
  const seasonal = {} as Schedule['seasonal'];
  const residualsByMonth = new Map<string, number[]>(); // month → residuals across categories
  const idioResiduals: number[][] = [];
  for (const cat of CATEGORIES) {
    const hist = allMonths
      .map(mo => ({ mo, moy: Number(mo.slice(5, 7)), v: catMonth.get(`${cat}|${mo}`) ?? 0 }))
      .filter(h => h.v > 0);
    if (!hist.length) {
      spend[cat] = { base: months.map(() => 0), cardShare: 0, cashDay: 15, cardDay: 15 };
      seasonal[cat] = { level: 0, own: Array(12).fill(0), w: Array(12).fill(0) };
      continue;
    }
    const d = hist.map(h => Math.log(h.v) - popLogFactor(cat, h.moy));
    const recent = d.slice(-LEVEL_MONTHS);
    const level = mean(recent);
    const own = Array(12).fill(0);
    const w = Array(12).fill(0);
    for (let mo = 1; mo <= 12; mo++) {
      const xs = hist.map((h, i) => (h.moy === mo ? d[i] - level : NaN)).filter(x => !Number.isNaN(x));
      if (xs.length) {
        own[mo - 1] = mean(xs);
        w[mo - 1] = xs.length / (xs.length + SHRINK_K);
      }
    }
    // leave-one-out residuals: own effect from the other year's same month only
    const res: number[] = [];
    hist.forEach((h, i) => {
      const j = hist.findIndex((g, jj) => jj !== i && g.moy === h.moy);
      const ownLoo = j >= 0 ? (1 / (1 + SHRINK_K)) * (d[j] - level) : 0;
      const r = d[i] - level - ownLoo;
      res.push(r);
      residualsByMonth.set(h.mo, [...(residualsByMonth.get(h.mo) ?? []), r]);
    });
    idioResiduals.push(res);
    const base = months.map(({ m }) => Math.exp(level + popLogFactor(cat, m) + w[m - 1] * own[m - 1]));
    spend[cat] = {
      base,
      cardShare: (cardAmt.get(cat) ?? 0) / Math.max(totAmt.get(cat) ?? 1, 1),
      cashDay: mode(cashDays.get(cat) ?? [], 15),
      cardDay: mode(cardDays.get(cat) ?? [], 15),
    };
    seasonal[cat] = { level, own, w };
  }
  // Noise: shared household factor + idiosyncratic per category (Student-t later).
  // LOO residual variance ≈ σ²(1 + w₁²) with w₁ = 1/(1+k); divide that out.
  const inflate = 1 + (1 / (1 + SHRINK_K)) ** 2;
  const monthsSorted = [...residualsByMonth.keys()].sort();
  const sharedSeries = monthsSorted.map(mo => mean(residualsByMonth.get(mo)!));
  const sigmaShared = Math.max(0.01, Math.sqrt(variance(sharedSeries) / inflate));
  const idioVar = mean(
    monthsSorted.map(mo => variance(residualsByMonth.get(mo)!))
  );
  const sigmaIdio = Math.max(0.005, Math.sqrt(idioVar / inflate));
  let phi = 0;
  if (sharedSeries.length > 3) {
    const a = sharedSeries.slice(0, -1);
    const b = sharedSeries.slice(1);
    const ma = mean(a);
    const mb = mean(b);
    const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i] - mb), 0);
    const va = a.reduce((s, x) => s + (x - ma) ** 2, 0);
    phi = va > 0 ? Math.min(0.8, Math.max(0, cov / va)) : 0;
  }

  const savings = acct('savings')[0];
  for (const x of external) {
    if (['credit_card', 'auto_loan', 'personal_loan', 'mortgage'].includes(x.account_type))
      loans.push({ accountId: x.account_id, type: x.account_type, balance: x.balance_cents, aprPct: x.apr_pct, payment: x.monthly_payment_cents, day: 15, feePerMonth: 0 });
    else if (x.account_type === 'cd' || x.account_type === 'ira')
      locked.push({ accountId: x.account_id, type: x.account_type, balance: x.balance_cents, yieldPct: x.annual_yield_pct, contribution: 0, day: 5 });
  }
  const startLiquid = [...accounts, ...external].filter(a => liquidTypes.has(a.account_type)).reduce((s, a) => s + a.balance_cents, 0);
  return {
    asOf,
    startLiquid,
    savingsBalance: savings?.balance_cents ?? 0,
    savingsYieldPct: savings?.annual_yield_pct ?? 0,
    income: [...incomeByDay.entries()].sort((x, y) => x[0] - y[0]).map(([day, cents]) => ({ day, cents })),
    incomeSigma,
    spend,
    sigmaShared,
    sigmaIdio,
    phi,
    card,
    loans,
    locked,
    external: { inPerMonth: extIn, outPerMonth: extOut, inDay: mode(extInDays, 1), outDay: mode(extOutDays, 31) },
    months,
    seasonal,
  };
}
