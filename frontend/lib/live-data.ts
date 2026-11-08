// Turns the SpacetimeDB rows for one customer into what each dashboard widget shows.
// Pure functions: no fetching here (see components/live-data-provider.tsx).
import type { AccountData, AccountType, OptionalAccountType } from "./account-data";
import type { ConnectedBank } from "./bank-data";
import type { CashFlowPoint, Payment, TimeRange } from "./mock-data";

export interface AccountRow { account_id: string; account_type: string; balance_cents: number; opening_balance_cents: number; monthly_payment_cents: number; apr_pct: number; annual_yield_pct: number }
export interface ExternalRow { account_id: string; institution: string; nickname: string; account_type: string; balance_cents: number }
export interface LedgerRow { posted_date: string; account_id: string; account_type: string; transaction_type: string; category: string; description: string; amount_cents: number; flow_class: string }
export interface StatementRow { account_id: string; month: string; closing_cents: number }
export interface PnlRow { month: string; income_cents: number; spending_cents: number; delta_net_worth_cents: number }
export interface SnapshotRow { as_of: string; net_worth_cents: number; liquid_cents: number; total_assets_cents: number; total_debt_cents: number; monthly_outflow_cents: number; runway_months: number | null; utilization: number | null }
export interface PayoffRow { account_id: string; account_type: string; apr_pct: number; payoff_months: number | null; payoff_month: string | null; coach_payoff_months: number | null; coach_payoff_month: string | null; snowball_payoff_month?: string | null }
export interface PlanRow { consumer_free_month: string | null; coach_consumer_free_month: string | null; interest_saved_cents: number; snowball_consumer_free_month?: string | null; snowball_extra_interest_cents?: number }
export interface DangerRow { date: string; p_below: number; reasons: string }
export interface QaRow { qa_id: number | string; question: string; interpretation: string; supported: boolean; verdict: string; answer: string; source: string }
export interface TimelineRow { day_offset: number; date: string; actual_net_cash_cents: number | null; actual_liquid_cents: number | null; continue_low_cents: number | null; continue_mid_cents: number | null; continue_high_cents: number | null; coach_low_cents: number | null; coach_mid_cents: number | null; coach_high_cents: number | null }
export interface WhatifRow { day_offset: number; date: string; low_cents: number; mid_cents: number; high_cents: number; label: string }
export interface CoachActionRow { kind: string; amount_cents: number; fraction: number; annual_saving_cents: number; p_low_before: number; p_low_after: number; detail: string; driver: string; es_before_cents: number; es_after_cents: number }
export interface ForecastRunRow { scenario: string; label: string; p_low: number; threshold_cents: number; end_liquid_p5_cents: number; end_liquid_p50_cents: number; end_liquid_p95_cents: number; horizon_days: number }
export interface GoalRow { goal_id: string; name: string; kind: string; target_cents: number; target_date: string }
export interface GoalResultRow { goal_id: string; days_to_goal: number; p_success: number; low_cents: number; mid_cents: number; high_cents: number; needed_80_cents: number | null; needed_95_cents: number | null; p_with_needed_80: number | null; needed_share_of_extras: number | null }
export interface CustomerRow { customer_id: string; credit_limit_cents: number }

export interface CustomerData {
  customer: CustomerRow[];
  account: AccountRow[];
  external_account: ExternalRow[];
  book_snapshot: SnapshotRow[];
  ledger_entry: LedgerRow[];
  statement: StatementRow[];
  pnl_month: PnlRow[];
  debt_payoff: PayoffRow[];
  debt_plan: PlanRow[];
  danger_day: DangerRow[];
  qa?: QaRow[];
  timeline_360?: TimelineRow[];
  timeline_whatif?: WhatifRow[];
  coach_action?: CoachActionRow[];
  forecast_run?: ForecastRunRow[];
  goal?: GoalRow[];
  goal_result?: GoalResultRow[];
}

const BUFFER_MONTHS = 3; // same cushion the backend coach keeps
const IRA_LIMIT_2026 = 7_500;
const LOANS = ["auto_loan", "personal_loan", "mortgage"];
const LIQUID = ["checking", "savings"];

const dollars = (cents: number) => cents / 100;
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(dollars(cents));
const pct = (x: number, digits = 1) => `${(100 * x).toFixed(digits)}%`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string | null | undefined) => (ym ? `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : "Not at this pace");
/** Payoff month, "Right away" when the plan's cash move clears it today. */
const payoffLabel = (months: number | null, ym: string | null) => (months === 0 ? "Right away" : monthLabel(ym));
const prettyType = (t: string) => ({ auto_loan: "Auto loan", personal_loan: "Personal loan", mortgage: "Mortgage", credit_card: "Credit card" })[t] ?? t;

/** Last day the data covers (the book's as-of date). */
export const asOfDate = (d: CustomerData) => d.book_snapshot[0]?.as_of ?? d.ledger_entry.reduce((m, r) => (r.posted_date > m ? r.posted_date : m), "");

// ---------- total balance card ----------
export function banksFor(d: CustomerData): ConnectedBank[] {
  const pnc: ConnectedBank = {
    id: "pnc",
    name: "PNC",
    accounts: d.account.filter(a => LIQUID.includes(a.account_type)).map(a => ({ id: a.account_id, kind: a.account_type as "checking" | "savings", balance: dollars(a.balance_cents), eligible: true })),
  };
  const outside = new Map<string, ConnectedBank>();
  for (const x of d.external_account) {
    if (!LIQUID.includes(x.account_type)) continue;
    const id = `ext-${x.institution.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const bank = outside.get(id) ?? { id, name: x.institution, accounts: [] };
    bank.accounts.push({ id: x.account_id, kind: x.account_type as "checking" | "savings", balance: dollars(x.balance_cents), eligible: true });
    outside.set(id, bank);
  }
  return [pnc, ...outside.values()];
}

// ---------- estimated credit score ----------
/** A transparent estimate, not a bureau score: built only from what this data shows. Starts at 700, then
 *  card utilization (the biggest factor customers control): <10% +60, <30% +30, <50% 0, <75% −40, else −80;
 *  a card payment in every month of history +40 (each month without one −25); both a card and an installment
 *  loan (credit mix) +10. Clamped to 300–850; bands follow the common FICO ranges. */
export function estimateCreditScore(d: CustomerData): { score: number; band: string; missedMonths: number; months: number } | null {
  const util = d.book_snapshot[0]?.utilization;
  if (util == null) return null;
  const months = [...new Set(d.ledger_entry.map(e => e.posted_date.slice(0, 7)))];
  const paid = new Set(d.ledger_entry.filter(e => e.account_type === 'credit_card' && e.category === 'debt_payment').map(e => e.posted_date.slice(0, 7)));
  const missed = months.filter(m => !paid.has(m)).length;
  let s = 700;
  s += util < 0.1 ? 60 : util < 0.3 ? 30 : util < 0.5 ? 0 : util < 0.75 ? -40 : -80;
  s += missed === 0 ? 40 : -25 * missed;
  if (d.account.some(a => a.account_type === 'credit_card') && d.account.some(a => LOANS.includes(a.account_type))) s += 10;
  const score = Math.max(300, Math.min(850, Math.round(s)));
  const band = score >= 800 ? 'Exceptional' : score >= 740 ? 'Very good' : score >= 670 ? 'Good' : score >= 580 ? 'Fair' : 'Poor';
  return { score, band, missedMonths: missed, months: months.length };
}

// ---------- account tabs ----------
function closingBefore(d: CustomerData, accountIds: string[], monthsBack: number): number | undefined {
  const months = [...new Set(d.statement.map(s => s.month))].sort();
  const m = months[months.length - 1 - monthsBack];
  if (!m) return undefined;
  return d.statement.filter(s => s.month === m && accountIds.includes(s.account_id)).reduce((t, s) => t + s.closing_cents, 0);
}
function changeVsLastMonth(d: CustomerData, rows: AccountRow[]): string | undefined {
  const prev = closingBefore(d, rows.map(r => r.account_id), 1);
  const now = rows.reduce((t, r) => t + r.balance_cents, 0);
  if (!prev) return undefined;
  const c = (now - prev) / prev;
  return `${c >= 0 ? "+" : "−"}${pct(Math.abs(c))} from previous month`;
}

export function accountTabsFor(d: CustomerData): { data: Record<AccountType, AccountData>; available: OptionalAccountType[] } {
  const of = (t: string) => d.account.filter(a => a.account_type === t);
  const sum = (rows: AccountRow[]) => rows.reduce((t, r) => t + r.balance_cents, 0);
  const snap = d.book_snapshot[0];
  const asOf = asOfDate(d);
  const payoff = new Map(d.debt_payoff.map(p => [p.account_id, p]));

  const savings = of("savings");
  const liquid = snap?.liquid_cents ?? sum([...savings, ...of("checking")]);
  const cushionTarget = BUFFER_MONTHS * (snap?.monthly_outflow_cents ?? 0);
  const cushion = cushionTarget > 0 ? Math.min(1, liquid / cushionTarget) : 1;

  const card = of("credit_card");
  const cardBal = sum(card);
  const limit = d.customer[0]?.credit_limit_cents ?? 0;
  const cardPay = card[0] && payoff.get(card[0].account_id);
  const credit = estimateCreditScore(d);

  const ira = of("ira");
  const year = asOf.slice(0, 4);
  const iraYtd = d.ledger_entry.filter(e => e.account_type === "ira" && e.category === "investment_contribution" && e.posted_date.startsWith(year)).reduce((t, e) => t + e.amount_cents, 0);

  const loans = d.account.filter(a => LOANS.includes(a.account_type));
  const opened = loans.reduce((t, a) => t + a.opening_balance_cents, 0);
  const repaid = opened > 0 ? Math.max(0, (opened - sum(loans)) / opened) : 0;
  const plan = d.debt_plan[0];

  const cds = of("cd");
  const cdInterest12 = d.ledger_entry.filter(e => e.account_type === "cd" && e.transaction_type === "interest_accrual" && e.posted_date > `${Number(year) - 1}${asOf.slice(4)}`).reduce((t, e) => t + e.amount_cents, 0);

  const nw12 = d.pnl_month.slice().sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-12).reduce((t, r) => t + r.delta_net_worth_cents, 0);

  const data: Record<AccountType, AccountData> = {
    savings: {
      name: "Savings",
      primary: { label: "Savings balance", value: money(sum(savings)) },
      change: changeVsLastMonth(d, savings),
      metrics: [
        { label: "Interest rate", value: `${(savings[0]?.annual_yield_pct ?? 0).toFixed(2)}% APY` },
        { label: "Cash runway", value: snap?.runway_months != null ? `${snap.runway_months.toFixed(1)} months of bills` : "—" },
      ],
      progress: { label: `Cash cushion (${BUFFER_MONTHS} months of bills)`, value: Math.round(100 * cushion), detail: `${money(liquid)} of ${money(cushionTarget)} cushion` },
    },
    credit: {
      name: "Credit",
      primary: credit
        ? { label: "Estimated credit score", value: `${credit.score} · ${credit.band}` }
        : { label: "Estimated credit score", value: "—" },
      change: credit
        ? `Estimate from card use and ${credit.missedMonths === 0 ? `${credit.months} months of on-time card payments` : `${credit.missedMonths} months without a card payment`}, not a bureau score`
        : undefined,
      metrics: [
        { label: "Card balance", value: money(cardBal) },
        { label: "Available credit", value: money(Math.max(0, limit - cardBal)) },
        { label: "APR", value: `${(card[0]?.apr_pct ?? 0).toFixed(1)}%` },
        ...(cardPay ? [{ label: "Card paid off", value: cardPay.payoff_month ? monthLabel(cardPay.payoff_month) : `Not at this pace (plan: ${payoffLabel(cardPay.coach_payoff_months, cardPay.coach_payoff_month)})` }] : []),
      ],
      progress: snap?.utilization != null ? { label: "Credit utilization", value: Math.round(100 * snap.utilization), detail: `${pct(snap.utilization, 0)} of credit limit used` } : undefined,
    },
    ira: {
      name: "IRA",
      primary: { label: "IRA balance", value: money(sum(ira)) },
      change: changeVsLastMonth(d, ira),
      metrics: [
        { label: `${year} contributions`, value: `${money(iraYtd)} / ${money(IRA_LIMIT_2026 * 100)}` },
        { label: "Growth rate", value: `${(ira[0]?.annual_yield_pct ?? 0).toFixed(2)}% a year` },
      ],
      progress: { label: "Contribution limit used", value: Math.min(100, Math.round(iraYtd / IRA_LIMIT_2026)), detail: `${money(iraYtd)} of the ${year} IRA limit` },
    },
    loan: {
      name: "Loans",
      primary: { label: "Remaining loan debt", value: money(sum(loans)) },
      change: plan ? `Debt-free except mortgage: ${monthLabel(plan.consumer_free_month)} → ${monthLabel(plan.coach_consumer_free_month)} with the plan` : undefined,
      metrics: loans.map(l => {
        const p = payoff.get(l.account_id);
        return { label: `${prettyType(l.account_type)} · ${l.apr_pct}% APR · ${money(l.balance_cents)}`, value: p ? `Paid off ${payoffLabel(p.payoff_months, p.payoff_month)} (plan: ${payoffLabel(p.coach_payoff_months, p.coach_payoff_month)})` : money(l.monthly_payment_cents) + "/mo" };
      }).concat(plan && plan.interest_saved_cents > 0 ? [{ label: "Interest the plan saves", value: money(plan.interest_saved_cents) }] : [])
        .concat(plan && plan.snowball_extra_interest_cents != null && (plan.snowball_consumer_free_month !== undefined) ? [{
          label: "Smallest-first (snowball)",
          value: `Debt-free ${monthLabel(plan.snowball_consumer_free_month)}, ${Math.abs(plan.snowball_extra_interest_cents) < 100 ? "same interest" : `${money(Math.abs(plan.snowball_extra_interest_cents))} ${plan.snowball_extra_interest_cents > 0 ? "more" : "less"} interest`}`,
        }] : []),
      progress: opened > 0 ? { label: "Principal repaid (past 2 years)", value: Math.round(100 * repaid), detail: `${pct(repaid, 0)} of loan balances repaid since the history began` } : undefined,
    },
    investment: {
      name: "Net worth",
      primary: { label: "Net worth", value: money(snap?.net_worth_cents ?? 0) },
      change: nw12 ? `${nw12 >= 0 ? "+" : "−"}${money(Math.abs(nw12))} over the past 12 months` : undefined,
      metrics: [
        { label: "Total assets", value: money(snap?.total_assets_cents ?? 0) },
        { label: "Total debt", value: money(snap?.total_debt_cents ?? 0) },
      ],
    },
    cds: {
      name: "CDs",
      primary: { label: "CD balance", value: money(sum(cds)) },
      metrics: [
        { label: "APY", value: `${(cds[0]?.annual_yield_pct ?? 0).toFixed(2)}%` },
        { label: "Interest earned (12 months)", value: money(cdInterest12) },
      ],
    },
  };
  const available: OptionalAccountType[] = [];
  if (ira.length) available.push("ira");
  if (loans.length) available.push("loan");
  available.push("investment");
  if (cds.length) available.push("cds");
  return { data, available };
}

// ---------- cash flow chart ----------
const addDays = (iso: string, n: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export function cashFlowFor(d: CustomerData, range: TimeRange): CashFlowPoint[] {
  const asOf = asOfDate(d);
  if (!asOf) return [];
  if (range === "1Y" || range === "ALL") {
    const rows = d.pnl_month.slice().sort((a, b) => (a.month < b.month ? -1 : 1));
    return (range === "1Y" ? rows.slice(-12) : rows).map(r => ({ date: `${r.month}-15`, income: dollars(r.income_cents), spending: dollars(r.spending_cents) }));
  }
  const days = { "1W": 7, "1M": 30, "3M": 91 }[range];
  const bucket = range === "3M" ? 7 : 1;
  const start = addDays(asOf, -days + 1);
  const points: CashFlowPoint[] = [];
  for (let i = 0; i < days; i += bucket) points.push({ date: addDays(start, i), income: 0, spending: 0 });
  for (const e of d.ledger_entry) {
    if (e.posted_date < start || e.posted_date > asOf) continue;
    const idx = Math.floor((Date.parse(e.posted_date) - Date.parse(start)) / 86_400_000 / bucket);
    const p = points[idx];
    if (!p) continue;
    if (e.flow_class === "income") p.income += dollars(e.amount_cents);
    else if (e.flow_class === "expense") p.spending += dollars(e.amount_cents);
  }
  return points.map(p => ({ ...p, income: Math.round(p.income), spending: Math.round(p.spending) }));
}

// ---------- upcoming payments ----------
export interface LivePayment extends Payment { expected: boolean; risk?: string }

const BILL = (e: LedgerRow) =>
  e.account_type === "checking" && (e.category === "housing" || e.category === "utilities" || e.category === "debt_payment");
function billName(e: LedgerRow, accounts: AccountRow[]): string {
  if (e.category === "housing") return "Rent / housing";
  if (e.category === "utilities") return "Utilities";
  const t = accounts.find(a => e.description.toLowerCase().includes(prettyType(a.account_type).toLowerCase()))?.account_type
    ?? ["credit_card", "auto_loan", "personal_loan", "mortgage"].find(k => e.description.toLowerCase().includes(k.replace("_", " ")));
  return t ? `${prettyType(t)} payment` : "Loan payment";
}

/** month is 0-based like Date#getMonth. Actual bills inside the data window, expected ones after it. */
export function paymentsFor(d: CustomerData, month: number, year: number): LivePayment[] {
  const ym = `${year}-${String(month + 1).padStart(2, "0")}`;
  const asOf = asOfDate(d);
  const lastMonth = asOf.slice(0, 7);
  const expected = ym > lastMonth;
  const source = expected ? lastMonth : ym;
  const danger = new Map(d.danger_day.filter(x => x.p_below >= 0.1).map(x => [x.date, x]));
  const lastDay = new Date(year, month + 1, 0).getDate();
  return d.ledger_entry
    .filter(e => e.posted_date.startsWith(source) && BILL(e))
    .sort((a, b) => (a.posted_date < b.posted_date ? -1 : 1))
    .map((e, i) => {
      const day = Math.min(Number(e.posted_date.slice(8, 10)), lastDay);
      const date = `${ym}-${String(day).padStart(2, "0")}`;
      const risk = expected ? danger.get(date) : undefined;
      return {
        id: `${ym}-${i}-${e.category}`,
        name: billName(e, d.account),
        day,
        amount: dollars(e.amount_cents),
        expected,
        risk: risk ? `${Math.round(100 * risk.p_below)}% chance checking runs low this day` : undefined,
      };
    });
}

// ---------- 360° timeline (Health page) ----------
export interface TimelinePoint {
  day: number; date: string;
  actual: number | null; // dollars: cash minus high-interest debt (net cash)
  continueMid: number | null; continueBand: [number, number] | null;
  coachMid: number | null; coachBand: [number, number] | null;
  whatifMid: number | null;
  cushion: number | null; // months of bills that net cash covers (actual in the past, "if nothing changes" ahead)
}

export function timelineFor(d: CustomerData): { points: TimelinePoint[]; whatifLabel: string | null; monthlyBills: number } {
  const bills = d.book_snapshot[0]?.monthly_outflow_cents ?? 0;
  const wi = new Map((d.timeline_whatif ?? []).map(w => [w.day_offset, w]));
  const D = (c: number | null | undefined) => (c == null ? null : c / 100);
  const points = (d.timeline_360 ?? []).slice().sort((a, b) => a.day_offset - b.day_offset).map(r => {
    const w = wi.get(r.day_offset);
    const now = r.actual_net_cash_cents ?? r.continue_mid_cents;
    return {
      day: r.day_offset, date: r.date,
      actual: D(r.actual_net_cash_cents),
      continueMid: D(r.continue_mid_cents),
      continueBand: r.continue_low_cents != null && r.continue_high_cents != null ? [r.continue_low_cents / 100, r.continue_high_cents / 100] as [number, number] : null,
      coachMid: D(r.coach_mid_cents),
      coachBand: r.coach_low_cents != null && r.coach_high_cents != null ? [r.coach_low_cents / 100, r.coach_high_cents / 100] as [number, number] : null,
      whatifMid: w && r.day_offset >= 0 ? w.mid_cents / 100 : null,
      cushion: now != null && bills > 0 ? now / bills : null,
    };
  });
  // join the future lines to today's actual so the chart has no gap at day 0
  const today = points.find(p => p.day === 0);
  if (today && today.actual != null) {
    today.continueMid ??= today.actual; today.coachMid ??= today.actual;
    if (wi.size) today.whatifMid ??= today.actual;
  }
  return { points, whatifLabel: (d.timeline_whatif ?? [])[0]?.label ?? null, monthlyBills: bills / 100 };
}

// ---------- Future page ----------
export interface FutureMoments {
  today: { date: string; cents: number } | null;
  low: { date: string; day: number; cents: number; lowCents: number } | null;
  recovery: { date: string; day: number } | null; // first day after the low back at today's level
  /** stretches of consecutive risky days (≥1% chance checking < $100), worst first, at most 4 */
  riskyDays: { start: string; end: string; days: number; pBelow: number; reasons: string }[];
  stress: { label: string; pLow: number; endCents: number; thresholdCents: number }[];
}

export function futureFor(d: CustomerData): FutureMoments {
  const t = (d.timeline_360 ?? []).slice().sort((a, b) => a.day_offset - b.day_offset);
  const t0 = t.find(r => r.day_offset === 0);
  const fut = t.filter(r => r.day_offset > 0 && r.continue_mid_cents != null);
  const todayCents = t0?.actual_net_cash_cents ?? null;
  let low: FutureMoments['low'] = null;
  for (const r of fut) if (!low || r.continue_mid_cents! < low.cents) low = { date: r.date, day: r.day_offset, cents: r.continue_mid_cents!, lowCents: r.continue_low_cents ?? r.continue_mid_cents! };
  let recovery: FutureMoments['recovery'] = null;
  if (low && todayCents != null && low.cents < todayCents) {
    const back = fut.find(r => r.day_offset > low!.day && r.continue_mid_cents! >= todayCents);
    if (back) recovery = { date: back.date, day: back.day_offset };
  }
  // flag days at 5%+ when there are any (else 1%+), so a long mildly-risky period doesn't swamp the real spikes
  const all = d.danger_day ?? [];
  const cut = all.some(x => x.p_below >= 0.05) ? 0.05 : 0.01;
  const risky = all.filter(x => x.p_below >= cut).sort((a, b) => (a.date < b.date ? -1 : 1));
  const counts = new Map<string, Map<string, number>>();
  const stretches: FutureMoments['riskyDays'] = [];
  const nextDay = (iso: string) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
  for (const x of risky) {
    const s = stretches[stretches.length - 1];
    const reasons = x.reasons ? x.reasons.split(', ') : [];
    if (s && nextDay(s.end) === x.date) {
      s.end = x.date; s.days++; s.pBelow = Math.max(s.pBelow, x.p_below);
    } else stretches.push({ start: x.date, end: x.date, days: 1, pBelow: x.p_below, reasons: '' });
    const key = stretches[stretches.length - 1].start;
    const c = counts.get(key) ?? new Map<string, number>();
    for (const r of reasons) c.set(r, (c.get(r) ?? 0) + 1);
    counts.set(key, c);
  }
  for (const s of stretches) s.reasons = [...(counts.get(s.start) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]).join(', ');
  const riskyDays = stretches.sort((a, b) => b.pBelow - a.pBelow).slice(0, 4).sort((a, b) => (a.start < b.start ? -1 : 1));
  const stress = (d.forecast_run ?? []).filter(r => r.scenario.startsWith('stress_')).map(r => ({ label: r.label, pLow: r.p_low, endCents: r.end_liquid_p50_cents, thresholdCents: r.threshold_cents }));
  return { today: t0 && todayCents != null ? { date: t0.date, cents: todayCents } : null, low, recovery, riskyDays, stress };
}

export const prettyDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
