// Spec §3: monthly P&L attribution from the ledger, plus spending by category.
//   ΔNW = income − spending − debt interest − fees + asset interest + (ext in − ext out) + residual
// Loan principal and internal transfers move money between accounts and cancel out of ΔNW.
// residual must be 0 cents; anything else is a data problem and gets reported.
import { ASSET_TYPES } from './book';

export interface LedgerIn {
  posted_date: string;
  account_type: string;
  transaction_type: string;
  category: string;
  flow_class: string;
  amount_cents: number;
  balance_change_cents: number;
}

export interface StatementIn {
  account_type: string;
  month: string;
  opening_cents: number;
  closing_cents: number;
}

export function computePnl(ledger: LedgerIn[], statements: StatementIn[]) {
  const months = [...new Set(statements.map(s => s.month))].sort();
  const open = new Map<string, number>();
  const close = new Map<string, number>();
  for (const s of statements) {
    const sign = ASSET_TYPES.has(s.account_type) ? 1 : -1;
    open.set(s.month, (open.get(s.month) ?? 0) + sign * s.opening_cents);
    close.set(s.month, (close.get(s.month) ?? 0) + sign * s.closing_cents);
  }
  const zero = () => ({ income: 0, spending: 0, debt_interest: 0, fees: 0, asset_interest: 0, ext_in: 0, ext_out: 0 });
  const flows = new Map(months.map(m => [m, zero()]));
  for (const t of ledger) {
    const f = flows.get(t.posted_date.slice(0, 7));
    if (!f) continue;
    const amt = t.amount_cents;
    if (t.transaction_type === 'paycheck') f.income += amt;
    if (t.flow_class === 'expense') f.spending += amt;
    if (t.transaction_type === 'interest_accrual') {
      if (ASSET_TYPES.has(t.account_type)) f.asset_interest += amt;
      else f.debt_interest += amt;
    }
    if (t.transaction_type === 'fee') f.fees += amt;
    if (t.flow_class === 'external_transfer') {
      if (t.balance_change_cents > 0) f.ext_in += amt;
      else f.ext_out += amt;
    }
  }
  return months.map(m => {
    const f = flows.get(m)!;
    const dnw = (close.get(m) ?? 0) - (open.get(m) ?? 0);
    const explained = f.income - f.spending - f.debt_interest - f.fees + f.asset_interest + f.ext_in - f.ext_out;
    return {
      month: m,
      income_cents: f.income,
      spending_cents: f.spending,
      debt_interest_cents: f.debt_interest,
      fees_cents: f.fees,
      asset_interest_cents: f.asset_interest,
      ext_in_cents: f.ext_in,
      ext_out_cents: f.ext_out,
      delta_net_worth_cents: dnw,
      organic_cents: dnw - (f.ext_in - f.ext_out),
      residual_cents: Math.round(dnw - explained),
    };
  });
}

export function computeSpending(ledger: LedgerIn[]) {
  const by = new Map<string, number>();
  for (const t of ledger) {
    if (t.flow_class !== 'expense') continue;
    const key = `${t.posted_date.slice(0, 7)}|${t.category}`;
    by.set(key, (by.get(key) ?? 0) + t.amount_cents);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, amount]) => {
      const [month, category] = key.split('|');
      return { month, category, amount_cents: amount };
    });
}
