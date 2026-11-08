#!/usr/bin/env node
// Load the synthetic 100-customer dataset (../data) into a SpacetimeDB database and compute results.
// Uses your logged-in `spacetime` CLI, so loads run as the database owner.
//
//   node scripts/load_data.mjs                       # local server, database from spacetime.json
//   node scripts/load_data.mjs --server maincloud     # Maincloud
//   node scripts/load_data.mjs --db spacetime360 --only C006,C002
//   node scripts/load_data.mjs --forecast C006,C002,C055      # customers to run the 180-day forecast for
//   node scripts/load_data.mjs --backtest none                # skip the May-Oct backtest (default: all)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : dflt;
};
const cfg = JSON.parse(readFileSync(join(ROOT, 'spacetime.json'), 'utf8'));
const SERVER = arg('server', cfg.server ?? 'local');
const DB = arg('db', cfg.database);
const ONLY = arg('only', '') ? new Set(arg('only', '').split(',')) : null;
const FORECAST = arg('forecast', 'C006,C002').split(',').filter(Boolean);
const BACKTEST = arg('backtest', 'all'); // 'all', 'none', or a comma-separated list

function csv(name) {
  const [head, ...lines] = readFileSync(join(ROOT, 'data', name), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines
    .map(l => Object.fromEntries(cols.map((c, i) => [c, l.split(',')[i] ?? ''])))
    .filter(r => !ONLY || ONLY.has(r.customer_id));
}
function cents(s) {
  const neg = s.startsWith('-');
  const [w, f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -v : v;
}
// Optional HTTP transport avoids Windows command-line limits for large row batches.
// The token stays in the process environment; data travels through stdin.
const httpCall = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const { server, db, name, args } = JSON.parse(Buffer.concat(chunks).toString());
const response = await fetch(server.replace(/\/$/, '') + '/v1/database/' + db + '/call/' + name, {
  method: 'POST', headers: { Authorization: 'Bearer ' + process.env.ST360_LOAD_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(args)
});
if (!response.ok) { console.error(name + ' failed (' + response.status + '): ' + (await response.text()).slice(0, 300)); process.exit(1); }
`;
function call(reducer, ...args) {
  if (process.env.ST360_LOAD_TOKEN) {
    execFileSync(process.execPath, ['--input-type=module', '-e', httpCall], {
      input: JSON.stringify({ server: SERVER, db: DB, name: reducer, args }),
      stdio: ['pipe', 'ignore', 'inherit'], maxBuffer: 64 * 1024 * 1024,
    });
    return;
  }
  execFileSync('spacetime', ['call', '--server', SERVER, DB, reducer, ...args.map(a => JSON.stringify(a))], {
    stdio: ['ignore', 'ignore', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
}
function batched(reducer, rows, size) {
  for (let i = 0; i < rows.length; i += size) {
    call(reducer, rows.slice(i, i + size));
    process.stdout.write(`\r  ${reducer}: ${Math.min(i + size, rows.length)}/${rows.length}`);
  }
  process.stdout.write('\n');
}

console.log(`Loading into database "${DB}" on server "${SERVER}"${ONLY ? ` (customers ${[...ONLY]})` : ''}`);
const customers = csv('profiles.csv').map(r => ({
  customer_id: r.customer_id,
  monthly_income_cents: cents(r.monthly_income),
  monthly_non_debt_expenses_cents: cents(r.monthly_non_debt_expenses),
  credit_limit_cents: cents(r.credit_limit),
}));
batched('load_customers', customers, 200);
batched('load_accounts', csv('accounts.csv').map(r => ({
  account_id: r.account_id,
  customer_id: r.customer_id,
  account_type: r.account_type,
  balance_cents: cents(r.balance),
  opening_balance_cents: cents(r.opening_balance),
  monthly_payment_cents: cents(r.monthly_payment),
  apr_pct: Number(r.apr_pct),
  annual_yield_pct: Number(r.annual_yield_pct),
})), 400);
batched('load_statements', csv('monthly_statements.csv').map(r => ({
  statement_id: `${r.account_id}|${r.month}`,
  customer_id: r.customer_id,
  account_id: r.account_id,
  account_type: r.account_type,
  month: r.month,
  opening_cents: cents(r.opening_balance),
  increases_cents: cents(r.balance_increases),
  decreases_cents: cents(r.balance_decreases),
  closing_cents: cents(r.closing_balance),
  transaction_count: Number(r.transaction_count),
})), 800);
batched('load_ledger', csv('transactions.csv').map(r => ({
  transaction_id: r.transaction_id,
  customer_id: r.customer_id,
  account_id: r.account_id,
  account_type: r.account_type,
  posted_date: r.posted_date,
  transaction_type: r.transaction_type,
  category: r.category,
  description: r.description,
  amount_cents: cents(r.amount),
  balance_change_cents: cents(r.balance_change),
  balance_after_cents: cents(r.balance_after),
  flow_class: r.flow_class,
  transfer_id: r.transfer_id,
})), 600);
// synthetic Toyota vehicles for the Car loans tab (analytics/model/make_vehicles.py)
const vehicles = csv('vehicles.csv').map(r => ({
  vehicle_id: r.vehicle_id, customer_id: r.customer_id, account_id: r.account_id, make: r.make, model: r.model,
  model_year: Number(r.model_year), mileage: Number(r.mileage), list_price_cents: cents(r.list_price),
  trade_in_estimate_cents: cents(r.trade_in_estimate), new_model_year: Number(r.new_model_year), new_price_cents: cents(r.new_price),
  refi_apr_pct: Number(r.refi_apr_pct), new_car_apr_pct: Number(r.new_car_apr_pct), new_car_term_months: Number(r.new_car_term_months),
}));
batched('load_vehicles', vehicles, 200);
customers.forEach((c, i) => {
  call('recompute_customer', c.customer_id);
  call('generate_180_day_projection', c.customer_id);
  process.stdout.write(`\r  recompute_customer: ${i + 1}/${customers.length}`);
});
process.stdout.write('\n');
for (const cid of FORECAST.filter(c => !ONLY || ONLY.has(c))) {
  call('run_forecast', cid, false);
  console.log(`  run_forecast: ${cid}`);
  if (vehicles.some(v => v.customer_id === cid)) {
    call('run_car_options', cid);
    console.log(`  run_car_options: ${cid}`);
  }
}
const btList = BACKTEST === 'none' ? [] : BACKTEST === 'all' ? customers.map(c => c.customer_id) : BACKTEST.split(',');
btList.forEach((cid, i) => {
  call('run_backtest', cid, '');
  process.stdout.write(`\r  run_backtest: ${i + 1}/${btList.length}`);
});
if (btList.length) {
  call('summarize_backtests');
  process.stdout.write('\n');
}
process.stdout.write('Done. Check: spacetime sql ' + DB + ' "SELECT * FROM validation_issue" --server ' + SERVER + '\n');
