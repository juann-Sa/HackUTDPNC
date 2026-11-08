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

/** End-of-day total balance of a chosen set of accounts (e.g. high-cost debts), same rules as above. */
export function computeDailyAccountTotal(
  ledger: (DailyLedgerIn & { account_id: string })[],
  openings: (OpeningIn & { account_id: string })[],
  accountIds: Set<string>,
  start: string,
  end: string
) {
  const bal = new Map<string, number>();
  for (const o of openings) if (accountIds.has(o.account_id)) bal.set(o.account_id, o.opening_balance_cents);
  const entries = ledger
    .filter(t => accountIds.has(t.account_id))
    .sort((a, b) =>
      a.posted_date < b.posted_date ? -1 : a.posted_date > b.posted_date ? 1 : a.transaction_id < b.transaction_id ? -1 : 1
    );
  const out = new Map<string, number>();
  let i = 0;
  for (let d = dayNumber(start), last = dayNumber(end); d <= last; d++) {
    const iso = isoFromDayNumber(d);
    while (i < entries.length && entries[i].posted_date <= iso) {
      const e = entries[i++];
      bal.set(e.account_id, e.balance_after_cents);
    }
    out.set(iso, [...bal.values()].reduce((s, v) => s + v, 0));
  }
  return out;
}
