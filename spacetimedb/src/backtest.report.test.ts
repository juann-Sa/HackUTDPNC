// Backtest report over all 100 customers. Skipped unless BT_OUT is set:
//   cd spacetimedb && BT_OUT=../analytics/backtest/backtest_report.json npx vitest run src/backtest.report.test.ts
import { it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { backtestCustomer } from './math/backtest';
import { DEFAULT_ASSUMPTIONS } from './math/forecast';
import { seedFromString } from './math/rng';
const ROOT = process.env.ST360_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
const rd = (n: string): Record<string, string>[] => { const [h, ...l] = readFileSync(join(ROOT, 'data', n), 'utf8').trim().split(/\r?\n/); const c = h.split(','); return l.map(x => { const v = x.split(','); return Object.fromEntries(c.map((k, i) => [k, v[i] ?? ''])); }); };
const cents = (s: string) => { const neg = s.startsWith('-'); const [w, f = ''] = (neg ? s.slice(1) : s).split('.'); const v = Number(w) * 100 + Number((f + '00').slice(0, 2)); return neg ? -v : v; };
it.skipIf(!process.env.BT_OUT)('backtest all customers', () => {
  const TX = rd('transactions.csv'); const AC = rd('accounts.csv');
  const arch = Object.fromEntries(rd('customer_archetypes.csv').map(r => [r.customer_id, r.archetype]));
  const byC = new Map<string, any[]>(); for (const r of TX) { if (!byC.has(r.customer_id)) byC.set(r.customer_id, []); byC.get(r.customer_id)!.push(r); }
  const rows: any[] = [];
  const a = { ...DEFAULT_ASSUMPTIONS, pairs: 250 };
  for (const cid of [...byC.keys()].sort()) {
    const ledger = byC.get(cid)!.map(r => ({ transaction_id: r.transaction_id, account_id: r.account_id, account_type: r.account_type, posted_date: r.posted_date, transaction_type: r.transaction_type, category: r.category, description: r.description, flow_class: r.flow_class, amount_cents: cents(r.amount), balance_change_cents: cents(r.balance_change), balance_after_cents: cents(r.balance_after), transfer_id: r.transfer_id }));
    const accounts = AC.filter(r => r.customer_id === cid).map(r => ({ account_id: r.account_id, account_type: r.account_type, balance_cents: cents(r.balance), opening_balance_cents: cents(r.opening_balance), apr_pct: Number(r.apr_pct), annual_yield_pct: Number(r.annual_yield_pct), monthly_payment_cents: cents(r.monthly_payment) }));
    const b = backtestCustomer(ledger, accounts, '2026-04-30', '2026-10-31', a, seedFromString(cid));
    rows.push({ cid, archetype: arch[cid], coverage90: b.coverage90, coverage90Raw: b.coverage90Raw, endErrorPct: b.endErrorPct, endHalfWidthPct: b.endHalfWidthPct, pinball: b.pinball });
  }
  const mean = (k: string, f = (r: any) => true) => { const xs = rows.filter(f).map(r => r[k]); return xs.reduce((s, x) => s + x, 0) / xs.length; };
  const median = (k: string) => { const xs = rows.map(r => r[k]).sort((x, y) => x - y); return xs[Math.floor(xs.length / 2)]; };
  const byArch = Object.fromEntries([...new Set(rows.map(r => r.archetype))].map(ar => [ar, {
    coverage90: mean('coverage90', r => r.archetype === ar), endErrorPct: mean('endErrorPct', r => r.archetype === ar), endHalfWidthPct: mean('endHalfWidthPct', r => r.archetype === ar) }]));
  const report = { cutoff: '2026-04-30', end: '2026-10-31', customers: rows.length, paths: 2 * a.pairs,
    coverage90_mean: mean('coverage90'), coverage90_raw_mean: mean('coverage90Raw'),
    end_error_pct_median: median('endErrorPct'), end_error_pct_mean: mean('endErrorPct'),
    end_half_width_pct_median: median('endHalfWidthPct'), pinball_mean: mean('pinball'), by_archetype: byArch, per_customer: rows };
  writeFileSync(process.env.BT_OUT!, JSON.stringify(report, null, 1));
}, 600_000);
