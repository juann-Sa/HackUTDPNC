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

/**
 * Accounts at other banks the customer links by hand ("connect to other banks").
 * Kept apart from `account` because they have no ledger here; they join the book snapshot,
 * carry and forecast, but not the ledger reconciliation.
 */
export const externalAccount = table(
  { name: 'external_account', public: true },
  {
    account_id: t.string().primaryKey(), // EXT-<customer_id>-<n>
    customer_id: t.string().index('btree'),
    institution: t.string(),
    nickname: t.string(),
    account_type: t.string(), // checking | savings | cd | ira | credit_card | auto_loan | personal_loan | mortgage
    balance_cents: t.f64(),
    apr_pct: t.f64(),
    annual_yield_pct: t.f64(),
    monthly_payment_cents: t.f64(),
    added_at: t.timestamp(),
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


// ---------- forecast results (run_forecast / run_what_if) ----------
// scenario ids: baseline | coach | stress_job_loss | stress_bill | stress_rates | what_if
export const forecastRun = table(
  { name: 'forecast_run', public: true },
  {
    run_id: t.string().primaryKey(), // customer_id|scenario
    customer_id: t.string().index('btree'),
    scenario: t.string(),
    label: t.string(),
    include_external: t.bool(),
    paths: t.u32(),
    horizon_days: t.u32(),
    start_date: t.string(),
    threshold_cents: t.f64(),
    p_low: t.f64(), // chance liquid cash dips below threshold within the horizon
    p_low_se: t.f64(),
    var95_cents: t.f64(), // 5th-percentile loss of liquid cash over the horizon
    es95_cents: t.f64(), // average loss in the worst 5% of futures
    mdd_p50_cents: t.f64(),
    mdd_p95_cents: t.f64(),
    end_liquid_p5_cents: t.f64(),
    end_liquid_p50_cents: t.f64(),
    end_liquid_p95_cents: t.f64(),
    end_net_worth_p5_cents: t.f64(),
    end_net_worth_p50_cents: t.f64(),
    end_net_worth_p95_cents: t.f64(),
    planned_change_cents: t.f64(), // change with no surprises
  }
);

export const forecastBand = table(
  { name: 'forecast_band', public: true },
  {
    band_id: t.string().primaryKey(), // customer_id|scenario|day_index
    customer_id: t.string().index('btree'),
    scenario: t.string(),
    day_index: t.u32(),
    date: t.string(),
    p5_cents: t.f64(),
    p25_cents: t.f64(),
    p50_cents: t.f64(),
    p75_cents: t.f64(),
    p95_cents: t.f64(),
  }
);

export const riskSource = table(
  { name: 'risk_source', public: true },
  {
    risk_id: t.string().primaryKey(), // customer_id|scenario|source
    customer_id: t.string().index('btree'),
    scenario: t.string(),
    source: t.string(), // planned_cash_flow | income | spend:<category> | unexpected_bills | card_and_other
    var_share: t.f64(),
    es_contribution_cents: t.f64(), // sums to es95 across sources
  }
);

export const sensitivity = table(
  { name: 'sensitivity', public: true },
  {
    sensitivity_id: t.string().primaryKey(), // customer_id|lever
    customer_id: t.string().index('btree'),
    lever: t.string(),
    label: t.string(),
    delta_p_low: t.f64(),
    delta_end_p50_cents: t.f64(),
  }
);

export const frontierPoint = table(
  { name: 'frontier_point', public: true },
  {
    frontier_id: t.string().primaryKey(), // customer_id|index
    customer_id: t.string().index('btree'),
    move_cents: t.f64(),
    p_low: t.f64(),
    annual_saving_cents: t.f64(),
    recommended: t.bool(),
  }
);

export const coachAction = table(
  { name: 'coach_action', public: true },
  {
    action_id: t.string().primaryKey(), // customer_id|kind
    customer_id: t.string().index('btree'),
    kind: t.string(),
    amount_cents: t.f64(),
    fraction: t.f64(),
    annual_saving_cents: t.f64(),
    p_low_before: t.f64(),
    p_low_after: t.f64(),
    detail: t.string(),
    driver: t.string().default(''), // risk source this action targets ('' if none)
    es_before_cents: t.f64().default(0), // average loss of cash in the worst 5% of futures, before
    es_after_cents: t.f64().default(0), // and after this action
  }
);

/**
 * One row per day from 180 days back to 180 days ahead: the 360° chart.
 * Plotted metric is NET CASH = checking + savings − high-cost debt (APR ≥ 10%), so paying down
 * expensive debt with cash is neutral on day 0 and the coach line wins only through real savings.
 * Past rows: actual values. Future rows: two paths with habit bands (normal variation only,
 * 5th–95th percentile): "continue" = if nothing changes, "coach" = following the coach.
 */
export const timeline360 = table(
  { name: 'timeline_360', public: true },
  {
    timeline_id: t.string().primaryKey(), // customer_id|day_offset
    customer_id: t.string().index('btree'),
    day_offset: t.i32(), // -180 .. 180, 0 = as-of date
    date: t.string(),
    actual_net_cash_cents: t.option(t.f64()),
    actual_liquid_cents: t.option(t.f64()),
    continue_low_cents: t.option(t.f64()),
    continue_mid_cents: t.option(t.f64()),
    continue_high_cents: t.option(t.f64()),
    coach_low_cents: t.option(t.f64()),
    coach_mid_cents: t.option(t.f64()),
    coach_high_cents: t.option(t.f64()),
  }
);

/** Every number the forecast rests on, for the "how we calculated this" panel. */
export const forecastAssumption = table(
  { name: 'forecast_assumption', public: true },
  {
    customer_id: t.string().primaryKey(),
    sigma_shared: t.f64(),
    sigma_idio: t.f64(),
    phi: t.f64(),
    income_sigma: t.f64(),
    shrink_k: t.f64(),
    student_t_nu: t.f64(),
    jumps_per_year: t.f64(),
    jump_median_cents: t.f64(),
    p_job_loss_monthly: t.f64(),
    p_rehire_monthly: t.f64(),
    ira_mu: t.f64(),
    ira_sigma: t.f64(),
    risk_cap: t.f64(),
    buffer_months: t.f64(),
    seed: t.u32(),
  }
);

// ---------- backtest: what we would have predicted vs what actually happened ----------
export const backtestDay = table(
  { name: 'backtest_day', public: true },
  {
    backtest_day_id: t.string().primaryKey(), // customer_id|day_index
    customer_id: t.string().index('btree'),
    day_index: t.u32(), // 1 = first day after the cutoff
    date: t.string(),
    actual_cents: t.f64(), // organic: cash without the synthetic outside-account top-ups
    actual_raw_cents: t.f64(),
    low_cents: t.f64(), // 5th percentile forecast made at the cutoff
    mid_cents: t.f64(),
    high_cents: t.f64(),
    inside: t.bool(),
  }
);

export const backtestSummary = table(
  { name: 'backtest_summary', public: true },
  {
    customer_id: t.string().primaryKey(),
    cutoff: t.string(),
    end: t.string(),
    paths: t.u32(),
    coverage90: t.f64(), // share of days inside the 90% band (target ≈ 0.90)
    coverage90_raw: t.f64(),
    end_error_pct: t.f64(), // |forecast median − actual| on the last day, share of cash at the cutoff
    end_half_width_pct: t.f64(),
    pinball: t.f64(),
  }
);

export const backtestOverall = table(
  { name: 'backtest_overall', public: true },
  {
    overall_id: t.u32().primaryKey(), // always 0
    customers: t.u32(),
    cutoff: t.string(),
    end: t.string(),
    coverage90_mean: t.f64(),
    coverage90_raw_mean: t.f64(),
    end_error_pct_median: t.f64(),
    end_half_width_pct_median: t.f64(),
    share_customers_coverage_80: t.f64(),
  }
);

// ---------- goals: chance of reaching a money target by a date ----------
export const goal = table(
  { name: 'goal', public: true },
  {
    goal_id: t.string().primaryKey(), // G-<customer_id>-<n>
    customer_id: t.string().index('btree'),
    name: t.string(),
    kind: t.string(), // save_extra | reach_balance
    target_cents: t.f64(),
    target_date: t.string(), // YYYY-MM-DD, at most 365 days ahead
    created_at: t.timestamp(),
  }
);

export const goalResult = table(
  { name: 'goal_result', public: true },
  {
    goal_id: t.string().primaryKey(),
    customer_id: t.string().index('btree'),
    as_of: t.string(),
    days_to_goal: t.u32(),
    p_success: t.f64(), // chance of reaching the goal (includes surprise bills and job-loss risk)
    p_success_se: t.f64(),
    low_cents: t.f64(), // goal metric on the date: 5th / 50th / 95th percentile
    mid_cents: t.f64(),
    high_cents: t.f64(),
    needed_80_cents: t.option(t.f64()), // extra per month for an 80% chance (none: saving alone can't get there)
    needed_95_cents: t.option(t.f64()),
    p_with_needed_80: t.option(t.f64()),
    needed_share_of_extras: t.option(t.f64()), // needed_80 as a share of dining + shopping + other each month
  }
);

/** AI explanations; every number is checked against the stored results before it is shown. */
export const narration = table(
  { name: 'narration', public: true },
  {
    narration_id: t.string().primaryKey(), // customer_id|topic
    customer_id: t.string().index('btree'),
    topic: t.string(), // overview | past | future | coach | risk
    text: t.string(),
    source: t.string(), // groq | template
    model: t.string(),
    rejected_reason: t.string(), // why an AI reply was replaced by the template ('' if not)
    created_at: t.timestamp(),
  }
);

const spacetimedb = schema({
  admin,
  customer,
  account,
  ledgerEntry,
  statement,
  externalAccount,
  bookSnapshot,
  bookLine,
  carrySummary,
  carryMove,
  pnlMonth,
  spendingMonth,
  dailyLiquid,
  validationIssue,
  forecastRun,
  forecastBand,
  riskSource,
  sensitivity,
  frontierPoint,
  coachAction,
  forecastAssumption,
  timeline360,
  narration,
  backtestDay,
  backtestSummary,
  backtestOverall,
  goal,
  goalResult,
},
{
  // Secrets come from the publisher's shell at publish time, never from the repo:
  //   GROQ_API_KEY=... spacetime publish spacetime360 --env-only
  env: {
    GROQ_API_KEY: t.option(t.string()),
    GROQ_MODEL: t.option(t.string()),
  },
});
export default spacetimedb;
