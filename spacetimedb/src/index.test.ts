// End-to-end check of the module math against the independent Python reference
// (analytics/reference/book_reference.py → reference.json), on all 100 customers.
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';

import spacetime, * as m from './index';
import { type Fact, unverifiedNumbers } from './math/narrate';

const ROOT = process.env.ST360_ROOT ?? fileURLToPath(new URL('../../', import.meta.url));
const DATA = join(ROOT, 'data');
const REF = JSON.parse(readFileSync(join(ROOT, 'analytics', 'reference', 'reference.json'), 'utf8'));

function csv(name: string): Record<string, string>[] {
  const [head, ...lines] = readFileSync(join(DATA, name), 'utf8').trim().split(/\r?\n/);
  const cols = head.split(',');
  return lines.map((l: string) => {
    const v = l.split(',');
    return Object.fromEntries(cols.map((c: string, i: number) => [c, v[i] ?? '']));
  });
}
/** Exact decimal-string → integer cents (no float rounding). */
function cents(s: string): number {
  const neg = s.startsWith('-');
  const [w, f = ''] = (neg ? s.slice(1) : s).split('.');
  const v = Number(w) * 100 + Number((f + '00').slice(0, 2));
  return neg ? -v : v;
}

const auth = (sub: string, id: bigint) =>
  TestAuth.fromJwtPayload(JSON.stringify({ iss: 'st360-test', sub }), new ConnectionId(id));
const owner = auth('owner', 1n);
const stranger = auth('stranger', 2n);

function loadedHarness() {
  const test = createModuleTestHarness(spacetime, m);
  test.withReducerTx(owner, ctx => m.init(ctx, {}));
  const customers = csv('profiles.csv').map(r => ({
    customer_id: r.customer_id,
    monthly_income_cents: cents(r.monthly_income),
    monthly_non_debt_expenses_cents: cents(r.monthly_non_debt_expenses),
    credit_limit_cents: cents(r.credit_limit),
  }));
  const accounts = csv('accounts.csv').map(r => ({
    account_id: r.account_id,
    customer_id: r.customer_id,
    account_type: r.account_type,
    balance_cents: cents(r.balance),
    opening_balance_cents: cents(r.opening_balance),
    monthly_payment_cents: cents(r.monthly_payment),
    apr_pct: Number(r.apr_pct),
    annual_yield_pct: Number(r.annual_yield_pct),
  }));
  const ledger = csv('transactions.csv').map(r => ({
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
  }));
  const statements = csv('monthly_statements.csv').map(r => ({
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
  }));
  test.withReducerTx(owner, ctx => {
    m.load_customers(ctx, { rows: customers });
    m.load_accounts(ctx, { rows: accounts });
    m.load_ledger(ctx, { rows: ledger });
    m.load_statements(ctx, { rows: statements });
  });
  test.withReducerTx(owner, ctx => m.recompute_all(ctx, {}));
  return { test, n: customers.length, ledgerRows: ledger.length };
}

describe('SpaceTime 360 book math', () => {
  const { test, n, ledgerRows } = loadedHarness();
  const ids = Object.keys(REF);

  it('loads all 100 customers and the full ledger', () => {
    expect(n).toBe(100);
    expect([...test.db.ledgerEntry.iter()].length).toBe(ledgerRows);
  });

  it('finds no reconciliation or P&L residual issues', () => {
    expect([...test.db.validationIssue.iter()]).toEqual([]);
  });

  it('matches the Python reference: snapshot (§1)', () => {
    for (const cid of ids) {
      const r = REF[cid].snapshot;
      const s = test.db.bookSnapshot.customer_id.find(cid)!;
      expect(s.net_worth_cents).toBe(r.net_worth);
      expect(s.liquid_cents).toBe(r.liquid);
      expect(s.locked_cents).toBe(r.locked);
      expect(s.total_debt_cents).toBe(r.total_debt);
      expect(s.monthly_outflow_cents).toBe(r.monthly_outflow);
      expect(s.monthly_surplus_cents).toBe(r.monthly_surplus);
      expect(s.runway_months).toBeCloseTo(r.runway_months, 10);
      expect(s.debt_to_income).toBeCloseTo(r.debt_to_income, 10);
      expect(s.utilization).toBeCloseTo(r.utilization, 10);
      expect(s.savings_rate).toBeCloseTo(r.savings_rate, 10);
      expect([s.runway_status, s.dti_status, s.utilization_status, s.savings_rate_status]).toEqual([
        r.status.runway, r.status.dti, r.status.utilization, r.status.savings_rate,
      ]);
      expect(s.as_of).toBe('2026-10-31');
    }
  });

  it('matches the Python reference: carry and avalanche moves (§2)', () => {
    for (const cid of ids) {
      const r = REF[cid].carry;
      const c = test.db.carrySummary.customer_id.find(cid)!;
      for (const [k, v] of [['earn_cents', r.earn], ['cost_cents', r.cost], ['net_cents', r.net],
        ['structural_cents', r.structural], ['high_cost_cents', r.high_cost],
        ['fixable_leak_cents', r.fixable_leak]] as const)
        expect(Math.abs((c as any)[k] - v), `${cid} ${k}`).toBeLessThanOrEqual(1);
      expect(c.idle_cash_cents).toBe(r.idle_cash);
      const moves = [...test.db.carryMove.customer_id.filter(cid)].sort((a, b) => b.apr_pct - a.apr_pct);
      expect(moves.map(x => [x.account_id, x.amount_cents])).toEqual(r.moves.map((x: any) => [x.account_id, x.amount]));
    }
  });

  it('matches the Python reference: monthly P&L to the cent (§3)', () => {
    for (const cid of ids) {
      const rows = [...test.db.pnlMonth.customer_id.filter(cid)].sort((a, b) => (a.month < b.month ? -1 : 1));
      expect(rows.length).toBe(24);
      rows.forEach((p, i) => {
        const r = REF[cid].pnl[i];
        expect(p.month).toBe(r.month);
        expect([p.income_cents, p.spending_cents, p.debt_interest_cents, p.fees_cents, p.asset_interest_cents,
          p.ext_in_cents, p.ext_out_cents, p.delta_net_worth_cents, p.organic_cents, p.residual_cents]).toEqual([
          r.income, r.spending, r.debt_interest, r.fees, r.asset_interest, r.ext_in, r.ext_out,
          r.delta_net_worth, r.organic, 0,
        ]);
      });
    }
  });

  it('builds 730 daily liquid balances ending at the snapshot liquid balance', () => {
    for (const cid of ids) {
      const days = [...test.db.dailyLiquid.customer_id.filter(cid)].sort((a, b) => (a.date < b.date ? -1 : 1));
      expect(days.length).toBe(730);
      expect(days[0].date).toBe('2024-11-01');
      expect(days[days.length - 1].date).toBe('2026-10-31');
      expect(days[days.length - 1].liquid_cents).toBe(REF[cid].snapshot.liquid);
    }
  });

  it('spending by category sums to P&L spending', () => {
    for (const cid of ['C006', 'C002', 'C055']) {
      const total = [...test.db.spendingMonth.customer_id.filter(cid)].reduce((s, r) => s + r.amount_cents, 0);
      const pnl = [...test.db.pnlMonth.customer_id.filter(cid)].reduce((s, r) => s + r.spending_cents, 0);
      expect(total).toBe(pnl);
    }
  });

  it('only the owner can load data', () => {
    expect(() =>
      test.withReducerTx(stranger, ctx => m.reset_data(ctx, {}))
    ).toThrow(/owner/);
  });
});

describe('SpaceTime 360 forecast reducers', () => {
  const { test } = loadedHarness();
  test.withReducerTx(stranger, ctx => m.run_forecast(ctx, { customer_id: 'C006', include_external: false }));

  it('writes seven scenarios with 181 days of bands each', () => {
    const runs = [...test.db.forecastRun.customer_id.filter('C006')].map(r => r.scenario).sort();
    expect(runs).toEqual(['baseline', 'coach', 'habit_coach', 'habit_continue', 'stress_bill', 'stress_job_loss', 'stress_rates']);
    for (const sc of runs) {
      const bands = [...test.db.forecastBand.customer_id.filter('C006')].filter(b => b.scenario === sc);
      expect(bands.length).toBe(181);
      for (const b of bands) expect(b.p5_cents <= b.p50_cents && b.p50_cents <= b.p95_cents).toBe(true);
    }
  });

  it('builds the 360° timeline: 180 days of history, two tight future paths on net cash', () => {
    const rows = [...test.db.timeline360.customer_id.filter('C006')].sort((a, b) => a.day_offset - b.day_offset);
    expect(rows.length).toBe(361);
    expect(rows[0].day_offset).toBe(-180);
    expect(rows.filter(r => r.actual_net_cash_cents !== undefined).length).toBe(181);
    const today = rows.find(r => r.day_offset === 0)!;
    // both paths start exactly at today's actual net cash (moving cash onto debt is neutral)
    expect(today.continue_mid_cents).toBe(today.actual_net_cash_cents);
    expect(today.coach_mid_cents).toBe(today.actual_net_cash_cents);
    const end = rows[rows.length - 1];
    expect(end.coach_mid_cents!).toBeGreaterThan(end.continue_mid_cents!);
    const band = (end.continue_high_cents! - end.continue_low_cents!) / 2;
    // band width in dollars, relative to the cash it describes (net cash itself can be near zero)
    expect(band / today.actual_liquid_cents!).toBeLessThan(0.05);
    writeFileSync('/tmp/st360_timeline.txt', `C006 day 180 net cash: continue ${end.continue_mid_cents} ± ${band.toFixed(0)} | coach ${end.coach_mid_cents} | today ${today.actual_net_cash_cents}`);
  });

  it('coach move equals the carry table fixable leak (same 3-month buffer)', () => {
    const carry = test.db.carrySummary.customer_id.find('C006')!;
    const move = test.db.coachAction.action_id.find('C006|move_cash_to_debt')!;
    expect(move.amount_cents).toBeLessThanOrEqual(carry.idle_cash_cents);
    expect(carry.idle_cash_cents - move.amount_cents).toBeLessThan(10_000);
    expect(Math.abs(move.annual_saving_cents - carry.fixable_leak_cents) / carry.fixable_leak_cents).toBeLessThan(0.01);
    expect(move.p_low_after).toBeLessThanOrEqual(0.05);
  });

  it('expected-shortfall contributions add up to ES95', () => {
    const run = test.db.forecastRun.run_id.find('C006|baseline')!;
    const parts = [...test.db.riskSource.customer_id.filter('C006')].filter(r => r.scenario === 'baseline');
    const sum = parts.reduce((s, r) => s + r.es_contribution_cents, 0);
    expect(Math.abs(sum - run.es95_cents)).toBeLessThanOrEqual(parts.length);
  });

  it('a neutral what-if reproduces the baseline exactly (common random numbers)', () => {
    test.withReducerTx(stranger, ctx =>
      m.run_what_if(ctx, {
        customer_id: 'C006', include_external: false, income_mult: 1, category_mults: [], one_off_cents: 0,
        one_off_day: 0, move_to_debt_cents: 0, job_loss_months: 0, card_apr_bump_pct: 0,
      })
    );
    const base = test.db.forecastRun.run_id.find('C006|baseline')!;
    const wi = test.db.forecastRun.run_id.find('C006|what_if')!;
    expect(wi.p_low).toBe(base.p_low);
    expect(wi.end_liquid_p50_cents).toBe(base.end_liquid_p50_cents);
    test.withReducerTx(stranger, ctx =>
      m.run_what_if(ctx, {
        customer_id: 'C006', include_external: false, income_mult: 1,
        category_mults: [{ category: 'dining', mult: 0.5 }], one_off_cents: 0, one_off_day: 0,
        move_to_debt_cents: 0, job_loss_months: 0, card_apr_bump_pct: 0,
      })
    );
    const cut = test.db.forecastRun.run_id.find('C006|what_if')!;
    expect(cut.end_liquid_p50_cents).toBeGreaterThan(base.end_liquid_p50_cents);
  });
});

describe('AI narration guardrail', () => {
  const facts: Fact[] = [
    { key: 'net_cash_today', text: 'Net cash today (cash minus high-interest debt): $13,557' },
    { key: 'continue_180', text: 'Net cash in 180 days if you continue as you are: about $9,239 (likely between $8,704 and $9,774)' },
    { key: 'p_low', text: 'Chance cash drops below $500 in the next 180 days (including surprises): 0.2%' },
  ];
  it('accepts a reply that only uses numbers from the facts', () => {
    const reply = 'Right now your net cash is $13,557. If you keep going as you are, in about 6 months it is likely around $9,239, somewhere between $8,704 and $9,774. The chance of dropping below $500 is only 0.2%.';
    expect(unverifiedNumbers(reply, facts)).toEqual([]);
  });
  it('rejects invented, rounded or computed numbers', () => {
    expect(unverifiedNumbers('You will lose about $4,318 by spring.', facts)).toEqual(['$4,318']);
    expect(unverifiedNumbers('Net cash is roughly $13,600.', facts)).toEqual(['$13,600']);
    expect(unverifiedNumbers('That is a 32% drop.', facts)).toEqual(['32%']);
  });
  it('the narrate procedure stores a verified explanation (template without an API key)', () => {
    const { test } = loadedHarness();
    test.withReducerTx(stranger, ctx => m.run_forecast(ctx, { customer_id: 'C006', include_external: false }));
    const ctx = test.procedureContext(stranger);
    const text = m.narrate(ctx, { customer_id: 'C006', topic: 'overview' });
    const row = test.db.narration.narration_id.find('C006|overview')!;
    expect(row.text).toBe(text);
    expect(row.source).toBe('template');
    expect(text).toMatch(/Net cash today/);
    expect(() => m.narrate(test.procedureContext(stranger), { customer_id: 'C006', topic: 'gossip' })).toThrow(/Unknown topic/);
    writeFileSync('/tmp/st360_narration.txt', text);
  }, 60_000);
});
