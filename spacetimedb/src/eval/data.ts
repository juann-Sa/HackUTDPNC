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
export function loadCustomer(cid: string): { schedule: Schedule; outflowCents: number; incomeCents: number; debtPaymentsCents: number; context: string } {
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
  const debtPaymentsCents = ac.filter(r => DEBTS.has(r.account_type)).reduce((s, r) => s + cents(r.monthly_payment), 0);
  const outflowCents = cents(prof.monthly_non_debt_expenses) + debtPaymentsCents;
  return { schedule, outflowCents, incomeCents: cents(prof.monthly_income), debtPaymentsCents, context: dataContext(prof, ac, tx) };
}

const usd = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What a Level 1 "just give the LLM the data" coach would see: profile, accounts, last 6 months of totals. */
function dataContext(prof: Record<string, string>, ac: Record<string, string>[], tx: Record<string, string>[]): string {
  const months = [...new Set(tx.map(r => r.posted_date.slice(0, 7)))].sort().slice(-6);
  const lines = [
    `Customer ${prof.customer_id}, data as of ${AS_OF}.`,
    `Monthly income: ${usd(cents(prof.monthly_income))}. Monthly non-debt expenses: ${usd(cents(prof.monthly_non_debt_expenses))}. Credit limit: ${usd(cents(prof.credit_limit))}.`,
    'Accounts:',
    ...ac.map(r => `- ${r.account_type}: balance ${usd(cents(r.balance))}` + (DEBTS.has(r.account_type) ? `, APR ${r.apr_pct}%, monthly payment ${usd(cents(r.monthly_payment))}` : `, yield ${r.annual_yield_pct}%`)),
    'Last 6 months (income / spending):',
    ...months.map(m => {
      const rs = tx.filter(r => r.posted_date.startsWith(m));
      const inc = rs.filter(r => r.flow_class === 'income').reduce((s, r) => s + cents(r.amount), 0);
      const sp = rs.filter(r => r.flow_class === 'expense').reduce((s, r) => s + cents(r.amount), 0);
      return `- ${m}: ${usd(inc)} / ${usd(sp)}`;
    }),
  ];
  return lines.join('\n');
}
