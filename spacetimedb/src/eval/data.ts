// Loads one synthetic customer straight from the CSVs (no database) for the comparison harness.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSchedule, type Schedule } from '../math/schedule';

export const ROOT = process.env.ST360_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
export const AS_OF = '2026-10-31';
const DEBTS = new Set(['credit_card', 'auto_loan', 'personal_loan', 'mortgage']);

function csv(name: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(join(ROOT, 'data', name), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map(l => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i] ?? ''])); });
}
function cents(s: string): number {
  const neg = s.startsWith('-');
  const [w, f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -v : v;
}

/** Schedule plus monthly outflow (non-debt expenses + debt payments, the book's definition). */
export function loadCustomer(cid: string): { schedule: Schedule; outflowCents: number } {
  const tx = csv('transactions.csv').filter(r => r.customer_id === cid);
  const ac = csv('accounts.csv').filter(r => r.customer_id === cid);
  const prof = csv('profiles.csv').find(r => r.customer_id === cid);
  if (!prof || !tx.length) throw new Error(`No data for ${cid}`);
  const schedule = buildSchedule(
    tx.map(r => ({
      transaction_id: r.transaction_id, account_id: r.account_id, account_type: r.account_type, posted_date: r.posted_date,
      transaction_type: r.transaction_type, category: r.category, description: r.description, flow_class: r.flow_class,
      amount_cents: cents(r.amount), balance_change_cents: cents(r.balance_change), balance_after_cents: cents(r.balance_after), transfer_id: r.transfer_id,
    })),
    ac.map(r => ({ account_id: r.account_id, account_type: r.account_type, balance_cents: cents(r.balance), apr_pct: Number(r.apr_pct), annual_yield_pct: Number(r.annual_yield_pct), monthly_payment_cents: cents(r.monthly_payment) })),
    AS_OF, 180
  );
  const outflowCents = cents(prof.monthly_non_debt_expenses) + ac.filter(r => DEBTS.has(r.account_type)).reduce((s, r) => s + cents(r.monthly_payment), 0);
  return { schedule, outflowCents };
}
