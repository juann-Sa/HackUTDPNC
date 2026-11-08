// Spec §1 (book snapshot) and §2 (carry). Pure functions; money in integer cents.

export const ASSET_TYPES = new Set(['checking', 'savings', 'cd', 'ira']);
export const LIQUID_TYPES = new Set(['checking', 'savings']);
export const LOCKED_TYPES = new Set(['cd', 'ira']);
export const DEBT_TYPES = new Set(['credit_card', 'auto_loan', 'personal_loan', 'mortgage']);

/** Months of essential outflow kept as a cash buffer before idle cash counts as "fixable". */
export const BUFFER_MONTHS = 3;
/** APR (%) at or above which a debt is high-cost (actionable); below it is structural. */
export const HIGH_COST_APR = 10;

export type Status = 'good' | 'watch' | 'risk' | 'unknown';

export interface ProfileIn {
  monthly_income_cents: number;
  monthly_non_debt_expenses_cents: number;
  credit_limit_cents: number;
}

export interface AccountIn {
  account_id: string;
  account_type: string;
  balance_cents: number;
  monthly_payment_cents: number;
  apr_pct: number;
  annual_yield_pct: number;
}

export function status(v: number | undefined, good: number, warn: number, higherIsBetter = true): Status {
  if (v === undefined) return 'unknown';
  if (!higherIsBetter) {
    v = -v;
    good = -good;
    warn = -warn;
  }
  return v >= good ? 'good' : v >= warn ? 'watch' : 'risk';
}

const ratio = (a: number, b: number): number | undefined => (b ? a / b : undefined);

export function tierOf(type: string): string {
  if (LIQUID_TYPES.has(type)) return 'liquid';
  if (LOCKED_TYPES.has(type)) return 'locked';
  if (type === 'credit_card') return 'revolving';
  if (type === 'mortgage') return 'secured';
  return 'installment';
}

export function computeSnapshot(p: ProfileIn, accounts: AccountIn[]) {
  const bal = (types: Set<string>) =>
    accounts.filter(a => types.has(a.account_type)).reduce((s, a) => s + a.balance_cents, 0);
  const income = p.monthly_income_cents;
  const debtPay = accounts
    .filter(a => DEBT_TYPES.has(a.account_type))
    .reduce((s, a) => s + a.monthly_payment_cents, 0);
  const outflow = p.monthly_non_debt_expenses_cents + debtPay;
  const liquid = bal(LIQUID_TYPES);
  const locked = bal(LOCKED_TYPES);
  const assets = bal(ASSET_TYPES);
  const debts = bal(DEBT_TYPES);
  const card = accounts.filter(a => a.account_type === 'credit_card').reduce((s, a) => s + a.balance_cents, 0);
  const runway = ratio(liquid, outflow);
  const dti = ratio(debtPay, income);
  const util = ratio(card, p.credit_limit_cents);
  const savingsRate = ratio(income - outflow, income);
  return {
    net_worth_cents: assets - debts,
    liquid_cents: liquid,
    locked_cents: locked,
    total_assets_cents: assets,
    total_debt_cents: debts,
    monthly_income_cents: income,
    monthly_outflow_cents: outflow,
    monthly_debt_payments_cents: debtPay,
    monthly_surplus_cents: income - outflow,
    runway_months: runway,
    debt_to_income: dti,
    utilization: util,
    savings_rate: savingsRate,
    runway_status: status(runway, 6, 3),
    dti_status: status(dti, 0.2, 0.36, false),
    utilization_status: status(util, 0.1, 0.3, false),
    savings_rate_status: status(savingsRate, 0.2, 0.1),
  };
}

/**
 * Carry = Σ asset balance × yield − Σ debt balance × APR (annual, cents).
 * Fixable leak: idle cash above a BUFFER_MONTHS buffer retires high-cost debt,
 * highest APR first (avalanche); saving = amount × (APR − savings yield).
 */
export function computeCarry(accounts: AccountIn[], liquidCents: number, monthlyOutflowCents: number) {
  let earn = 0;
  let cost = 0;
  let structural = 0;
  let highCost = 0;
  const lines = accounts.map(a => {
    const isAsset = ASSET_TYPES.has(a.account_type);
    const rate = isAsset ? a.annual_yield_pct : a.apr_pct;
    const carry = ((isAsset ? 1 : -1) * a.balance_cents * rate) / 100;
    const high = !isAsset && rate >= HIGH_COST_APR;
    if (isAsset) earn += carry;
    else {
      cost -= carry;
      if (high) highCost += carry;
      else structural += carry;
    }
    return {
      account_id: a.account_id,
      account_type: a.account_type,
      side: isAsset ? 'asset' : 'debt',
      tier: tierOf(a.account_type),
      balance_cents: a.balance_cents,
      rate_pct: rate,
      annual_carry_cents: carry,
      high_cost: high,
    };
  });
  const savingsYield = accounts.find(a => a.account_type === 'savings')?.annual_yield_pct ?? 0;
  const idle = Math.max(0, liquidCents - BUFFER_MONTHS * monthlyOutflowCents);
  const targets = accounts
    .filter(a => DEBT_TYPES.has(a.account_type) && a.apr_pct >= HIGH_COST_APR)
    .sort((x, y) => y.apr_pct - x.apr_pct || (x.account_id < y.account_id ? -1 : 1));
  let remaining = idle;
  let leak = 0;
  const moves: { account_id: string; apr_pct: number; amount_cents: number; annual_saving_cents: number }[] = [];
  for (const d of targets) {
    const amount = Math.min(remaining, d.balance_cents);
    if (amount <= 0) break;
    const saving = (amount * (d.apr_pct - savingsYield)) / 100;
    leak += saving;
    remaining -= amount;
    moves.push({ account_id: d.account_id, apr_pct: d.apr_pct, amount_cents: amount, annual_saving_cents: saving });
  }
  return {
    summary: {
      earn_cents: earn,
      cost_cents: cost,
      net_cents: earn - cost,
      structural_cents: structural,
      high_cost_cents: highCost,
      idle_cash_cents: idle,
      fixable_leak_cents: leak,
      buffer_months: BUFFER_MONTHS,
    },
    lines,
    moves,
  };
}
