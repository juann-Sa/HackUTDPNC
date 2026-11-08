// ─────────────────────────────────────────────────────────────────────────────
// SpaceTime 360 schema
// Money is stored as integer cents in f64 columns (exact below 2^53 cents).
// Server-side names are snake_case; generated client bindings expose camelCase.
// Tables are public for the hackathon demo (synthetic data only). A production
// version would expose per-customer rows through views keyed on ctx.sender.
// ─────────────────────────────────────────────────────────────────────────────
import { schema, table, t } from 'spacetimedb/server';

// Who may load data: the identity that published the module (set in init).
export const admin = table({ name: 'admin' }, { identity: t.identity().primaryKey() });

// ---------- source data (loaded from the synthetic CSVs) ----------
export const customer = table(
  { name: 'customer', public: true },
  {
    customer_id: t.string().primaryKey(),
    monthly_income_cents: t.f64(),
    monthly_non_debt_expenses_cents: t.f64(),
    credit_limit_cents: t.f64(),
  }
);

export const account = table(
  { name: 'account', public: true },
  {
    account_id: t.string().primaryKey(),
    customer_id: t.string().index('btree'),
    account_type: t.string(),
    balance_cents: t.f64(),
    opening_balance_cents: t.f64(),
    monthly_payment_cents: t.f64(),
    apr_pct: t.f64(),
    annual_yield_pct: t.f64(),
  }
);

export const ledgerEntry = table(
  { name: 'ledger_entry', public: true },
  {
    transaction_id: t.string().primaryKey(),
    customer_id: t.string().index('btree'),
    account_id: t.string(),
    account_type: t.string(),
    posted_date: t.string(), // YYYY-MM-DD
    transaction_type: t.string(),
    category: t.string(),
    description: t.string(),
    amount_cents: t.f64(),
    balance_change_cents: t.f64(),
    balance_after_cents: t.f64(),
    flow_class: t.string(),
    transfer_id: t.string(),
  }
);

export const statement = table(
  { name: 'statement', public: true },
  {
    statement_id: t.string().primaryKey(), // account_id|YYYY-MM
    customer_id: t.string().index('btree'),
    account_id: t.string(),
    account_type: t.string(),
    month: t.string(),
    opening_cents: t.f64(),
    increases_cents: t.f64(),
    decreases_cents: t.f64(),
    closing_cents: t.f64(),
    transaction_count: t.u32(),
  }
);

export const financialProjection = table(
  { name: 'financial_projection', public: true },
  {
    projection_id: t.string().primaryKey(), // customer_id|record_type|YYYY-MM
    customer_id: t.string().index('btree'),
    month: t.string(),
    record_type: t.string(), // historical | projected
    current_liquid_cash_cents: t.f64(),
    current_total_debt_cents: t.f64(),
    total_minimum_monthly_payments_cents: t.f64(),
    liquid_balance_cents: t.f64(),
    debt_balance_cents: t.f64(),
    monthly_income_cents: t.option(t.f64()),
    monthly_expenses_cents: t.option(t.f64()),
    monthly_debt_payments_cents: t.option(t.f64()),
    holiday_expense_spike: t.bool(),
  }
);

// ---------- results (written by recompute reducers; clients subscribe) ----------
export const bookSnapshot = table(
  { name: 'book_snapshot', public: true },
  {
    customer_id: t.string().primaryKey(),
    as_of: t.string(),
    net_worth_cents: t.f64(),
    liquid_cents: t.f64(),
    locked_cents: t.f64(),
    total_assets_cents: t.f64(),
    total_debt_cents: t.f64(),
    monthly_income_cents: t.f64(),
    monthly_outflow_cents: t.f64(),
    monthly_debt_payments_cents: t.f64(),
    monthly_surplus_cents: t.f64(),
    runway_months: t.option(t.f64()),
    debt_to_income: t.option(t.f64()),
    utilization: t.option(t.f64()),
    savings_rate: t.option(t.f64()),
    runway_status: t.string(),
    dti_status: t.string(),
    utilization_status: t.string(),
    savings_rate_status: t.string(),
  }
);

export const bookLine = table(
  { name: 'book_line', public: true },
  {
    account_id: t.string().primaryKey(),
    customer_id: t.string().index('btree'),
    account_type: t.string(),
    side: t.string(), // asset | debt
    tier: t.string(), // liquid | locked | revolving | installment | secured
    balance_cents: t.f64(),
    rate_pct: t.f64(), // yield for assets, APR for debts
    annual_carry_cents: t.f64(), // + earns, - costs
    high_cost: t.bool(),
  }
);

export const carrySummary = table(
  { name: 'carry_summary', public: true },
  {
    customer_id: t.string().primaryKey(),
    earn_cents: t.f64(),
    cost_cents: t.f64(),
    net_cents: t.f64(),
    structural_cents: t.f64(),
    high_cost_cents: t.f64(),
    idle_cash_cents: t.f64(),
    fixable_leak_cents: t.f64(),
    buffer_months: t.f64(),
  }
);

export const carryMove = table(
  { name: 'carry_move', public: true },
  {
    move_id: t.string().primaryKey(), // customer_id|account_id
    customer_id: t.string().index('btree'),
    account_id: t.string(),
    apr_pct: t.f64(),
    amount_cents: t.f64(),
    annual_saving_cents: t.f64(),
  }
);

export const pnlMonth = table(
  { name: 'pnl_month', public: true },
  {
    pnl_id: t.string().primaryKey(), // customer_id|YYYY-MM
    customer_id: t.string().index('btree'),
    month: t.string(),
    income_cents: t.f64(),
    spending_cents: t.f64(),
    debt_interest_cents: t.f64(),
    fees_cents: t.f64(),
    asset_interest_cents: t.f64(),
    ext_in_cents: t.f64(),
    ext_out_cents: t.f64(),
    delta_net_worth_cents: t.f64(),
    organic_cents: t.f64(),
    residual_cents: t.f64(),
  }
);

export const spendingMonth = table(
  { name: 'spending_month', public: true },
  {
    spending_id: t.string().primaryKey(), // customer_id|YYYY-MM|category
    customer_id: t.string().index('btree'),
    month: t.string(),
    category: t.string(),
    amount_cents: t.f64(),
  }
);

export const dailyLiquid = table(
  { name: 'daily_liquid', public: true },
  {
    daily_id: t.string().primaryKey(), // customer_id|YYYY-MM-DD
    customer_id: t.string().index('btree'),
    date: t.string(),
    checking_cents: t.f64(),
    savings_cents: t.f64(),
    liquid_cents: t.f64(),
  }
);

export const validationIssue = table(
  { name: 'validation_issue', public: true },
  {
    issue_id: t.u64().primaryKey().autoInc(),
    customer_id: t.string().index('btree'),
    kind: t.string(),
    detail: t.string(),
  }
);

const spacetimedb = schema({
  admin,
  customer,
  account,
  ledgerEntry,
  statement,
  financialProjection,
  bookSnapshot,
  bookLine,
  carrySummary,
  carryMove,
  pnlMonth,
  spendingMonth,
  dailyLiquid,
  validationIssue,
});
export default spacetimedb;
