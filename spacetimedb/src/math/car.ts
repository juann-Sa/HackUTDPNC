// Car-loan options ("What's your next move?"): the customer's current Toyota loan and four alternatives,
// each run through the same 180-day cash forecast on the same random draws (so differences come from the
// choice, not luck), plus deterministic amortization for payments, interest and payoff dates.
//
//   keep        – today's payment until the loan is paid off
//   extra       – pay $100 more each month (all of it reduces principal)
//   refinance   – the synthetic refinance offer rate, same remaining term (lower payment, less interest)
//   payoff      – pay the balance today from cash
//   trade_in    – trade the car in toward this year's model; trade-in equity is the down payment
//                 (negative equity is rolled into the new loan); new loan at the synthetic new-car rate
//
// Best move (fixed rule, not the AI): among keep / extra / refinance / payoff, the option that saves the most
// interest while the verdict is no worse than keeping the loan and cash still covers 3+ months of bills.
// Trade-in is shown as an upgrade, never as the money-saving pick.
import { EMERGENCY_MONTHS, verdict, type Verdict } from './ask';
import { type Assumptions, type LoanChange, type NewLoan, type Scenario, amortizedPayment, makeTapes, runForecast } from './forecast';
import { addMonths } from './payoff';
import type { Schedule } from './schedule';

export const EXTRA_MONTHLY_CENTS = 10_000;
const MAX_MONTHS = 480;

export interface Vehicle {
  accountId: string; model: string; modelYear: number; mileage: number;
  tradeInCents: number; newModelYear: number; newPriceCents: number;
  refiAprPct: number; newCarAprPct: number; newCarTermMonths: number;
}

export interface CarOption {
  kind: 'keep' | 'extra' | 'refinance' | 'payoff' | 'trade_in';
  label: string;
  detail: string;
  monthlyPaymentCents: number;
  paymentChangeCents: number; // vs keep
  upfrontCashCents: number;
  interestCents: number; // interest from today until this loan is paid off
  interestSavedCents: number; // vs keep (trade-in: n/a → 0)
  payoffMonths: number | undefined;
  payoffMonth: string | undefined; // YYYY-MM
  pLow: number; // chance cash drops below the threshold in the next 180 days
  endCashP50Cents: number;
  cushionMonths: number; // cash right after the change ÷ monthly bills (incl. the new car payment)
  dtiAfter: number; // debt payments ÷ income after the change
  verdict: Verdict;
  isBest: boolean;
}

/** Months and interest to pay off `balance` at `aprPct` with a fixed monthly `payment`. */
export function amortize(balance: number, aprPct: number, payment: number): { months: number | undefined; interest: number } {
  let b = balance, interest = 0;
  for (let m = 1; m <= MAX_MONTHS; m++) {
    const i = (b * aprPct) / 1200;
    if (payment <= i && b > 0.5) return { months: undefined, interest: interest + i * (MAX_MONTHS - m + 1) };
    interest += i;
    b += i - Math.min(payment, b + i);
    if (b <= 0.5) return { months: m, interest };
  }
  return { months: undefined, interest };
}

const RANK: Record<Verdict, number> = { comfortable: 0, tight: 1, risky: 2 };

export function carOptions(
  s: Schedule, v: Vehicle, a: Assumptions, seed: number, asOf: string,
  book: { outflowCents: number; incomeCents: number; debtPaymentsCents: number },
): CarOption[] {
  const loan = s.loans.find(l => l.accountId === v.accountId);
  if (!loan || loan.balance <= 0) return [];
  const tapes = makeTapes(seed, a, s.months.length + 1);
  const bal = loan.balance, apr = loan.aprPct, pay = loan.payment;
  const keepAm = amortize(bal, apr, pay);
  const remaining = Math.max(12, Math.min(84, keepAm.months ?? 84)); // refinance term: what's left, capped at 84 months
  const refiPay = Math.round(amortizedPayment(bal, v.refiAprPct, remaining));
  const equity = v.tradeInCents - bal;
  const newPrincipal = Math.max(0, v.newPriceCents - equity);
  const newPay = Math.round(amortizedPayment(newPrincipal, v.newCarAprPct, v.newCarTermMonths));
  const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

  type Spec = { kind: CarOption['kind']; label: string; detail: string; pay: number; upfront: number; am: { months: number | undefined; interest: number }; changes: LoanChange[]; newLoan?: NewLoan };
  const specs: Spec[] = [
    { kind: 'keep', label: 'Keep your loan as is', detail: `${usd(pay)} a month at ${apr}%`, pay, upfront: 0, am: keepAm, changes: [] },
    {
      kind: 'extra', label: `Pay ${usd(EXTRA_MONTHLY_CENTS)} more a month`, detail: `${usd(pay + EXTRA_MONTHLY_CENTS)} a month, all extra goes to principal`,
      pay: pay + EXTRA_MONTHLY_CENTS, upfront: 0, am: amortize(bal, apr, pay + EXTRA_MONTHLY_CENTS),
      changes: [{ accountId: v.accountId, dayIndex: 0, kind: 'extra', extraCents: EXTRA_MONTHLY_CENTS }],
    },
  ];
  if (v.refiAprPct < apr)
    specs.push({
      kind: 'refinance', label: `Refinance at ${v.refiAprPct}%`, detail: `${remaining} months at ${v.refiAprPct}% instead of ${apr}%: ${usd(refiPay)} a month (sample offer; terms over 84 months aren't offered)`,
      pay: refiPay, upfront: 0, am: amortize(bal, v.refiAprPct, refiPay),
      changes: [{ accountId: v.accountId, dayIndex: 0, kind: 'refi', aprPct: v.refiAprPct, paymentCents: refiPay }],
    });
  specs.push(
    {
      kind: 'payoff', label: 'Pay it off now from savings', detail: `${usd(bal)} from cash today, no more car payment`,
      pay: 0, upfront: bal, am: { months: 0, interest: 0 },
      changes: [{ accountId: v.accountId, dayIndex: 0, kind: 'payoff_cash' }],
    },
    {
      kind: 'trade_in', label: `Trade in for a ${v.newModelYear} ${v.model}`,
      detail: `Trade-in about ${usd(v.tradeInCents)} (estimate) ${equity >= 0 ? `leaves ${usd(equity)} of equity as the down payment` : `is ${usd(-equity)} less than you owe, rolled into the new loan`}; ${usd(newPrincipal)} at ${v.newCarAprPct}% for ${v.newCarTermMonths} months`,
      pay: newPay, upfront: 0, am: amortize(newPrincipal, v.newCarAprPct, newPay),
      changes: [{ accountId: v.accountId, dayIndex: 0, kind: 'close' }],
      newLoan: { dayIndex: 0, downCents: 0, principalCents: newPrincipal, aprPct: v.newCarAprPct, paymentCents: newPay, label: `new ${v.model}` },
    },
  );

  const out: CarOption[] = specs.map(sp => {
    const sc: Scenario = { id: `car_${sp.kind}`, label: sp.label, includeExternal: false, loanChanges: sp.changes, newLoan: sp.newLoan };
    const f = runForecast(s, a, sc, tapes);
    const bills = book.outflowCents - pay + sp.pay;
    const cushion = f.bands[Math.min(1, f.bands.length - 1)].p50 / Math.max(bills, 1);
    return {
      kind: sp.kind, label: sp.label, detail: sp.detail,
      monthlyPaymentCents: sp.pay, paymentChangeCents: sp.pay - pay, upfrontCashCents: sp.upfront,
      interestCents: Math.round(sp.am.interest), interestSavedCents: sp.kind === 'trade_in' ? 0 : Math.round(keepAm.interest - sp.am.interest),
      payoffMonths: sp.am.months, payoffMonth: sp.am.months === undefined ? undefined : addMonths(asOf, sp.am.months),
      pLow: f.pLow, endCashP50Cents: Math.round(f.endLiquid.p50), cushionMonths: cushion,
      dtiAfter: book.incomeCents > 0 ? (book.debtPaymentsCents - pay + sp.pay) / book.incomeCents : 0,
      verdict: verdict(f.pLow, f.endLiquid.p50, bills, cushion),
      isBest: false,
    };
  });
  const keep = out.find(o => o.kind === 'keep')!;
  const best = out
    .filter(o => o.kind !== 'trade_in' && RANK[o.verdict] <= RANK[keep.verdict] && (o.kind === 'keep' || o.cushionMonths >= EMERGENCY_MONTHS))
    .sort((x, y) => y.interestSavedCents - x.interestSavedCents)[0] ?? keep;
  best.isBest = true;
  return out;
}
