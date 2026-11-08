// End-of-day liquid balance (checking + savings) for every calendar day in the history,
// rebuilt from running balances; days without activity carry the previous balance forward.
import { dayNumber, isoFromDayNumber } from './dates';

export interface DailyLedgerIn {
  transaction_id: string;
  account_type: string;
  posted_date: string;
  balance_after_cents: number;
}

export interface OpeningIn {
  account_type: string;
  opening_balance_cents: number;
}

export function computeDailyLiquid(ledger: DailyLedgerIn[], openings: OpeningIn[], start: string, end: string) {
  let checking = openings.filter(o => o.account_type === 'checking').reduce((s, o) => s + o.opening_balance_cents, 0);
  let savings = openings.filter(o => o.account_type === 'savings').reduce((s, o) => s + o.opening_balance_cents, 0);
  const entries = ledger
    .filter(t => t.account_type === 'checking' || t.account_type === 'savings')
    .sort((a, b) =>
      a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : a.transaction_id < b.transaction_id ? -1 : 1
    );
  const out: { date: string; checking_cents: number; savings_cents: number; liquid_cents: number }[] = [];
  let i = 0;
  for (let d = dayNumber(start), last = dayNumber(end); d <= last; d++) {
    const iso = isoFromDayNumber(d);
    while (i < entries.length && entries[i].posted_date <= iso) {
      const e = entries[i++];
      if (e.account_type === 'checking') checking = e.balance_after_cents;
      else savings = e.balance_after_cents;
    }
    out.push({ date: iso, checking_cents: checking, savings_cents: savings, liquid_cents: checking + savings });
  }
  return out;
}
