// End-to-end check of the module math against the independent Python reference
// (analytics/reference/book_reference.py → reference.json), on all 100 customers.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionId } from 'spacetimedb';
import { createModuleTestHarness, TestAuth } from 'spacetimedb/server/test-utils';

import spacetime, * as m from './index';

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

  it('emits six months of history and six deterministic monthly projections', () => {
    test.withReducerTx(owner, ctx => m.generate_180_day_projection(ctx, { customer_id: 'C001' }));
    const rows = [...test.db.financialProjection.customer_id.filter('C001')];
    const historical = rows.filter(row => row.record_type === 'historical').sort((a, b) => a.month.localeCompare(b.month));
    const projected = rows.filter(row => row.record_type === 'projected').sort((a, b) => a.month.localeCompare(b.month));

    expect(historical).toHaveLength(6);
    expect(historical.map(row => row.month)).toEqual([
      '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10',
    ]);
    for (const row of historical) {
      const monthStatements = [...test.db.statement.customer_id.filter('C001')]
        .filter(statement => statement.month === row.month);
      expect(row.liquid_balance_cents).toBe(
        monthStatements
          .filter(statement => ['checking', 'savings'].includes(statement.account_type))
          .reduce((total, statement) => total + statement.closing_cents, 0)
      );
      expect(row.debt_balance_cents).toBe(
        monthStatements
          .filter(statement => ['credit_card', 'auto_loan', 'personal_loan', 'mortgage'].includes(statement.account_type))
          .reduce((total, statement) => total + statement.closing_cents, 0)
      );
    }
    expect(projected.map(row => row.month)).toEqual([
      '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04',
    ]);
    const profile = test.db.customer.customer_id.find('C001')!;
    const accounts = [...test.db.account.customer_id.filter('C001')];
    const currentLiquidCash = accounts
      .filter(account => ['checking', 'savings'].includes(account.account_type))
      .reduce((total, account) => total + account.balance_cents, 0);
    const debtAccounts = accounts.filter(account =>
      ['credit_card', 'auto_loan', 'personal_loan', 'mortgage'].includes(account.account_type)
    );
    const currentTotalDebt = debtAccounts.reduce((total, account) => total + account.balance_cents, 0);
    const minimumMonthlyPayments = debtAccounts.reduce((total, account) => total + account.monthly_payment_cents, 0);
    const november = projected[0];
    const december = projected[1];
    expect(november.current_liquid_cash_cents).toBe(currentLiquidCash);
    expect(november.current_total_debt_cents).toBe(currentTotalDebt);
    expect(november.total_minimum_monthly_payments_cents).toBe(minimumMonthlyPayments);
    expect(november.holiday_expense_spike).toBe(true);
    expect(november.monthly_expenses_cents).toBe(Math.round(profile.monthly_non_debt_expenses_cents * 1.25));
    expect(november.monthly_debt_payments_cents).toBe(Math.min(minimumMonthlyPayments, currentTotalDebt));
    expect(november.liquid_balance_cents).toBe(
      currentLiquidCash + profile.monthly_income_cents - november.monthly_expenses_cents! - november.monthly_debt_payments_cents!
    );
    expect(november.debt_balance_cents).toBe(currentTotalDebt - november.monthly_debt_payments_cents!);
    expect(december.holiday_expense_spike).toBe(false);
    expect(december.monthly_expenses_cents).toBe(profile.monthly_non_debt_expenses_cents);
    expect(projected.every(row => row.monthly_income_cents === profile.monthly_income_cents)).toBe(true);
  });

  it('only lets the owner upsert external accounts for existing customers', () => {
    const externalAccount = {
      account_id: 'plaid_test_account',
      customer_id: 'C001',
      account_type: 'checking',
      balance_cents: 12345,
      opening_balance_cents: 12345,
      monthly_payment_cents: 0,
      apr_pct: 0,
      annual_yield_pct: 0,
    };

    test.withReducerTx(owner, ctx => m.add_external_account(ctx, { rows: [externalAccount] }));
    expect(test.db.account.account_id.find(externalAccount.account_id)?.balance_cents).toBe(12345);

    expect(() =>
      test.withReducerTx(stranger, ctx => m.add_external_account(ctx, { rows: [externalAccount] }))
    ).toThrow(/owner/);
    expect(() =>
      test.withReducerTx(owner, ctx =>
        m.add_external_account(ctx, { rows: [{ ...externalAccount, customer_id: 'missing-customer' }] })
      )
    ).toThrow(/Unknown customer/);
  });

  it('only the owner can load data', () => {
    expect(() =>
      test.withReducerTx(stranger, ctx => m.reset_data(ctx, {}))
    ).toThrow(/owner/);
  });
});
