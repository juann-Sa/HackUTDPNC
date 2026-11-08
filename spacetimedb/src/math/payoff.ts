// Debt payoff dates: month-by-month amortization of every debt under two plans.
//   current: today's payments (a card pays its interest plus its usual paydown; if the balance
//            isn't shrinking it never pays off at this rate)
//   coach:   the recommended cash move applied highest-APR first, and every paid-off debt's payment
//            rolled into the highest-APR debt still open (avalanche)
import type { Schedule } from './schedule';

const MAX_MONTHS = 480;
const HIGH_COST_APR = 10;

export interface DebtIn {
  id: string;
  type: string;
  balance: number;
  aprPct: number;
  /** cents per month that reduce the balance after interest is added (loans: scheduled payment). */
  payment: number;
  isCard: boolean;
  /** card only: principal reduction per month beyond interest at today's habits */
  paydown: number;
}

export interface DebtPayoff {
  id: string;
  type: string;
  balance: number;
  aprPct: number;
  monthlyPayment: number;
  months: number | undefined; // months until paid off (undefined: not within 40 years at this rate)
  interest: number; // interest paid until payoff (or over 40 years)
}

export interface PayoffPlan {
  debts: DebtPayoff[];
  consumerMonths: number | undefined; // all non-mortgage debts paid off
  allMonths: number | undefined;
  totalInterest: number;
}

export function debtsFromSchedule(s: Schedule): DebtIn[] {
  const out: DebtIn[] = [];
  if (s.card && s.card.balance > 0)
    out.push({ id: s.card.accountId, type: 'credit_card', balance: s.card.balance, aprPct: s.card.aprPct, payment: 0, isCard: true, paydown: s.card.paydown });
  for (const l of s.loans)
    if (l.balance > 0) out.push({ id: l.accountId, type: l.type, balance: l.balance, aprPct: l.aprPct, payment: l.payment, isCard: false, paydown: 0 });
  return out;
}

export function simulatePayoff(input: DebtIn[], moveCents: number, rollover: boolean): PayoffPlan {
  const debts = input.map(d => ({ ...d, bal: d.balance, months: undefined as number | undefined, interest: 0, extra: 0 }));
  // one-time move: highest-APR high-cost debts first
  let move = moveCents;
  for (const d of [...debts].filter(x => x.aprPct >= HIGH_COST_APR).sort((a, b) => b.aprPct - a.aprPct)) {
    const amt = Math.min(move, d.bal);
    d.bal -= amt;
    move -= amt;
    if (d.bal <= 0.5) d.months = 0;
  }
  const baseCard = (d: (typeof debts)[number]) => (d.isCard ? (d.bal * d.aprPct) / 1200 + d.paydown : d.payment);
  // fixed monthly budget for each debt's own payment, frozen at today's level (cards: interest + paydown today)
  const budget = debts.map(d => (d.isCard ? Math.max(0, (d.balance * d.aprPct) / 1200 + d.paydown) : d.payment));
  for (let m = 1; m <= MAX_MONTHS; m++) {
    let freed = 0;
    for (let i = 0; i < debts.length; i++) {
      const d = debts[i];
      if (d.months !== undefined) {
        if (rollover) freed += budget[i];
        continue;
      }
      const interest = (d.bal * d.aprPct) / 1200;
      const pay = Math.min(d.isCard ? Math.max(0, baseCard(d)) + d.extra : d.payment + d.extra, d.bal + interest);
      d.interest += interest;
      d.bal += interest - pay;
      if (d.bal <= 0.5) {
        d.bal = 0;
        d.months = m;
      }
    }
    // roll freed payments into the highest-APR open debt for next month
    for (const d of debts) d.extra = 0;
    if (rollover && freed > 0) {
      const target = debts.filter(d => d.months === undefined).sort((a, b) => b.aprPct - a.aprPct)[0];
      if (target) target.extra = freed;
    }
    if (debts.every(d => d.months !== undefined)) break;
  }
  const consumer = debts.filter(d => d.type !== 'mortgage');
  const maxOf = (xs: typeof debts) => (xs.some(d => d.months === undefined) ? undefined : xs.reduce((p, d) => Math.max(p, d.months!), 0));
  return {
    debts: debts.map(d => ({
      id: d.id, type: d.type, balance: d.balance, aprPct: d.aprPct,
      monthlyPayment: d.isCard ? Math.max(0, (d.balance * d.aprPct) / 1200 + d.paydown) : d.payment,
      months: d.months, interest: d.interest,
    })),
    consumerMonths: consumer.length ? maxOf(consumer) : 0,
    allMonths: maxOf(debts),
    totalInterest: debts.reduce((p, d) => p + d.interest, 0),
  };
}

/** YYYY-MM after adding months to an ISO date. */
export function addMonths(iso: string, months: number): string {
  let y = Number(iso.slice(0, 4));
  let m = Number(iso.slice(5, 7)) + months;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}
