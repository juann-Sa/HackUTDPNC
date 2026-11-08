// End-to-end check of the module math against the independent Python reference
// (analytics/reference/book_reference.py → reference.json), on all 100 customers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';

import spacetime, * as m from './index';
import { type Fact, auditReply, unverifiedNumbers } from './math/narrate';

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

  it('emits six historical months and six forecast months for the 180-day projection', () => {
    test.withReducerTx(stranger, ctx => m.generate_180_day_projection(ctx, { customer_id: 'C001' }));
    const rows = [...test.db.financialProjection.customer_id.filter('C001')];
    const historical = rows.filter(row => row.record_type === 'historical');
    const projected = rows
      .filter(row => row.record_type === 'projected')
      .sort((a, b) => a.month.localeCompare(b.month));

    expect(historical).toHaveLength(6);
    expect(projected.map(row => row.month)).toEqual([
      '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
    ]);
    expect(projected[0].holiday_expense_spike).toBe(true);
    expect(projected[0].monthly_expenses_cents).toBe(
      Math.round(test.db.customer.customer_id.find('C001')!.monthly_non_debt_expenses_cents * 1.25)
    );
    expect(projected[1].holiday_expense_spike).toBe(false);
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
  it('accepts honest rounding of a real number', () => {
    expect(unverifiedNumbers('Net cash is roughly $13,600, about $9,200 in six months.', facts)).toEqual([]);
    expect(unverifiedNumbers('Only about 0.2% risk.', facts)).toEqual([]);
  });
  it('rejects invented, computed or loosely approximated numbers', () => {
    expect(unverifiedNumbers('You will lose about $4,318 by spring.', facts)).toEqual(['$4,318']);
    expect(unverifiedNumbers('Net cash is about $14,000.', facts)).toEqual(['$14,000']);
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
    expect(m.narrate(test.procedureContext(stranger), { customer_id: 'C006', topic: 'gossip' })).toMatch(/Unknown topic/);
    expect(m.narrate(test.procedureContext(stranger), { customer_id: 'C999', topic: 'overview' })).toMatch(/No results for C999/);
  }, 60_000);
});

describe('linked outside accounts', () => {
  const { test } = loadedHarness();
  const before = { ...test.db.bookSnapshot.customer_id.find('C006')! };
  const carryBefore = { ...test.db.carrySummary.customer_id.find('C006')! };
  const add = (over: Record<string, unknown> = {}) =>
    test.withReducerTx(stranger, ctx =>
      m.add_external_account(ctx, {
        customer_id: 'C006', institution: 'Other Bank', account_type: 'savings', nickname: 'Rainy day',
        balance_cents: 500_000, apr_pct: 0, annual_yield_pct: 4, monthly_payment_cents: 0, ...over,
      } as any)
    );

  it('folds outside accounts into the book and carry', () => {
    add();
    add({ account_type: 'credit_card', nickname: 'Store card', balance_cents: 200_000, apr_pct: 26, annual_yield_pct: 0, monthly_payment_cents: 6_000 });
    const ext = [...test.db.externalAccount.customer_id.filter('C006')].map(x => x.account_id).sort();
    expect(ext).toEqual(['EXT-C006-1', 'EXT-C006-2']);
    const s = test.db.bookSnapshot.customer_id.find('C006')!;
    expect(s.liquid_cents).toBe(before.liquid_cents + 500_000);
    expect(s.total_debt_cents).toBe(before.total_debt_cents + 200_000);
    expect(s.monthly_debt_payments_cents).toBe(before.monthly_debt_payments_cents + 6_000);
    expect(test.db.bookLine.account_id.find('EXT-C006-2')!.high_cost).toBe(true);
    const c = test.db.carrySummary.customer_id.find('C006')!;
    expect(Math.round(c.earn_cents - carryBefore.earn_cents)).toBe(20_000); // $5,000 at 4%
    expect(Math.round(c.cost_cents - carryBefore.cost_cents)).toBe(52_000); // $2,000 at 26%
    expect([...test.db.validationIssue.customer_id.filter('C006')]).toEqual([]);
  });

  it('includes them in the forecast and keeps the timeline continuous at today', () => {
    test.withReducerTx(stranger, ctx => m.run_forecast(ctx, { customer_id: 'C006', include_external: false }));
    const today = [...test.db.timeline360.customer_id.filter('C006')].find(r => r.day_offset === 0)!;
    expect(today.continue_mid_cents).toBe(today.actual_net_cash_cents);
    expect(today.coach_mid_cents).toBe(today.actual_net_cash_cents);
    const move = test.db.coachAction.action_id.find('C006|move_cash_to_debt');
    expect(move).toBeDefined();
  }, 60_000);

  it('rejects bad input and removes cleanly', () => {
    expect(() => add({ account_type: 'crypto' })).toThrow(/Unsupported account type/);
    expect(() => add({ balance_cents: -5 })).toThrow(/non-negative/);
    expect(() => add({ customer_id: 'C999' })).toThrow(/Unknown customer/);
    test.withReducerTx(stranger, ctx => m.remove_external_account(ctx, { account_id: 'EXT-C006-1' }));
    test.withReducerTx(stranger, ctx => m.remove_external_account(ctx, { account_id: 'EXT-C006-2' }));
    expect(test.db.bookSnapshot.customer_id.find('C006')!.liquid_cents).toBe(before.liquid_cents);
    expect(test.db.bookLine.account_id.find('EXT-C006-2')).toBeFalsy();
  });

  it('upserts Plaid accounts idempotently and restricts writes to the database owner', () => {
    const row = {
      account_id: 'plaid-sandbox-account',
      customer_id: 'C006',
      institution: 'Plaid',
      nickname: 'Checking',
      account_type: 'checking',
      balance_cents: 12345,
      apr_pct: 0,
      annual_yield_pct: 0,
      monthly_payment_cents: 0,
    };

    test.withReducerTx(owner, ctx => m.upsert_plaid_accounts(ctx, { rows: [row] }));
    test.withReducerTx(owner, ctx =>
      m.upsert_plaid_accounts(ctx, { rows: [{ ...row, balance_cents: 54321 }] })
    );
    const plaidRows = [...test.db.externalAccount.customer_id.filter('C006')].filter(account =>
      account.account_id.endsWith('PLAID-plaid-sandbox-account')
    );
    expect(plaidRows).toHaveLength(1);
    expect(plaidRows[0].balance_cents).toBe(54321);
    expect(() =>
      test.withReducerTx(stranger, ctx => m.upsert_plaid_accounts(ctx, { rows: [row] }))
    ).toThrow(/owner/);
  });
});

describe('AI narration: label binding and spelled-out amounts', () => {
  // Facts as gatherFacts writes them for C006, and the real Groq reply from the first live test.
  const facts: Fact[] = [
    { key: 'net_worth', text: 'Net worth (excluding home value): -$143,553' },
    { key: 'cash', text: 'Cash in checking and savings: $29,665' },
    { key: 'runway', text: 'Months of essential bills cash would cover: 5.9' },
    { key: 'dti', text: 'Share of income going to debt payments: 52%' },
    { key: 'utilization', text: 'Credit card utilization: 66%' },
    { key: 'income_6m', text: 'Paychecks over the last 6 months: $25,142' },
    { key: 'spending_6m', text: 'Spending over the last 6 months: $17,302' },
    { key: 'organic_6m', text: 'Change in net worth from your own earning and spending over the last 6 months: $339' },
    { key: 'net_cash_today', text: 'Net cash today (cash minus high-interest debt): $13,557' },
    { key: 'continue_180', text: 'Net cash in 180 days if you continue as you are: about $9,239 (likely between $8,697 and $9,768)' },
    { key: 'coach_180', text: 'Net cash in 180 days if you follow the coach: about $10,870' },
    { key: 'action_move', text: 'Coach suggestion: move $14,500 of spare cash to your highest-interest debt, saving about $1,999 a year; chance of running low goes from 0.5% to 1.5%' },
  ];
  const live =
    "You’ve built up $29,665 in checking and savings, which covers about 5.9 months of essential bills, but after subtracting high‑interest debt your net cash sits at $13,557 and your overall net worth (excluding your home) is –$143,553. " +
    'Over the past six months you earned $25,142, spent $17,302 and only nudged net worth up $339, while 52% of your income goes to debt and credit‑card use sits at 66%. ' +
    'If you keep spending the same, your cash will likely fall to about $9,239 in 180 days, but following the coach’s plan could lift it to about $10,870. ' +
    'The single most useful next step is to move $14,500 of spare cash to your highest‑interest debt, which should save about $1,999 a year.';

  it('catches the real "cash" vs "net cash" slip from the live test', () => {
    const a = auditReply(live, facts);
    expect(a.ok).toBe(false);
    expect(a.problems).toEqual(['$9,239 missing label "net cash"', '$10,870 missing label "net cash"']);
    expect(a.feedback).toMatch(/\$9,239 must be described as "net cash"/);
  });
  it('accepts the same reply once the label is right', () => {
    const fixed = live.replace('your cash will likely fall', 'your net cash will likely fall');
    expect(auditReply(fixed, facts)).toMatchObject({ ok: true, problems: [] });
  });
  it('accepts a range under the same label and rejects spelled-out amounts', () => {
    expect(auditReply('Your net cash will likely land around $9,239, somewhere between $8,697 and $9,768.', facts).ok).toBe(true);
    expect(auditReply('Your net cash is about thirteen thousand dollars.', facts).problems).toContain('spelled-out amount');
    expect(auditReply('Your net worth is $13,557.', facts).problems).toEqual(['$13,557 missing label "net cash"']);
  });
});

describe('backtest reducers', () => {
  const { test } = loadedHarness();
  for (const cid of ['C006', 'C002', 'C055'])
    test.withReducerTx(stranger, ctx => m.run_backtest(ctx, { customer_id: cid, cutoff: '' }));

  it('forecasts May-Oct 2026 from April 30 and scores it day by day', () => {
    const days = [...test.db.backtestDay.customer_id.filter('C006')].sort((a, b) => a.day_index - b.day_index);
    expect(days.length).toBe(184);
    expect(days[0].date).toBe('2026-05-01');
    expect(days[days.length - 1].date).toBe('2026-10-31');
    for (const d of days) expect(d.low_cents <= d.mid_cents && d.mid_cents <= d.high_cents).toBe(true);
    const s = test.db.backtestSummary.customer_id.find('C006')!;
    expect(s.cutoff).toBe('2026-04-30');
    expect(s.coverage90).toBeCloseTo(days.filter(d => d.inside).length / days.length, 10);
  });

  it('summarizes across customers and validates input', () => {
    test.withReducerTx(stranger, ctx => m.summarize_backtests(ctx, {}));
    const o = test.db.backtestOverall.overall_id.find(0)!;
    expect(o.customers).toBe(3);
    expect(o.coverage90_mean).toBeGreaterThan(0.5);
    expect(() => test.withReducerTx(stranger, ctx => m.run_backtest(ctx, { customer_id: 'C006', cutoff: '2024-12-01' }))).toThrow(/Cutoff/);
    expect(() => test.withReducerTx(stranger, ctx => m.run_backtest(ctx, { customer_id: 'C999', cutoff: '' }))).toThrow(/Unknown customer/);
  });
});

describe('coach driven by the risk breakdown, and advanced metrics in narration', () => {
  const { test } = loadedHarness();
  test.withReducerTx(stranger, ctx => m.run_forecast(ctx, { customer_id: 'C006', include_external: false }));
  const actions = [...test.db.coachAction.customer_id.filter('C006')];

  it('targets the biggest driver of the worst case and flags the monthly gap', () => {
    const kinds = actions.map(a => a.kind).sort();
    const drivers = [...test.db.riskSource.customer_id.filter('C006')]
      .filter(r => r.scenario === 'baseline' && r.source !== 'planned_cash_flow')
      .sort((x, y) => y.es_contribution_cents - x.es_contribution_cents);
    const expected: Record<string, string> = { income: 'protect_income', unexpected_bills: 'reserve_for_surprises' };
    const top = drivers[0].source;
    expect(kinds).toContain(expected[top] ?? 'trim_category');
    expect(kinds).toContain('close_monthly_gap');
    const driverAction = actions.find(a => a.driver === top)!;
    expect(driverAction.es_before_cents).toBeGreaterThan(0);
    // the coach move is unchanged: still the carry table's fixable leak
    const carry = test.db.carrySummary.customer_id.find('C006')!;
    const move = actions.find(a => a.kind === 'move_cash_to_debt')!;
    expect(carry.idle_cash_cents - move.amount_cents).toBeLessThan(10_000);
    writeFileSync('/tmp/st360_actions.txt', actions.map(a => `${a.kind} [${a.driver}] ${a.amount_cents} ES ${a.es_before_cents}->${a.es_after_cents} | ${a.detail}`).join('\n'));
  });

  it('the risk explanation now covers worst case, top driver, deepest dip and best lever', () => {
    const text = m.narrate(test.procedureContext(stranger), { customer_id: 'C006', topic: 'risk' });
    expect(text).toMatch(/worst 5% of futures/);
    expect(text).toMatch(/Biggest driver of a bad outcome/);
    expect(text).toMatch(/Deepest dip/);
    expect(text).toMatch(/helps your 180-day cash the most/);
    const coachText = m.narrate(test.procedureContext(stranger), { customer_id: 'C006', topic: 'coach' });
    writeFileSync('/tmp/st360_risk_text.txt', text + '\n\n' + coachText);
  }, 60_000);
});
