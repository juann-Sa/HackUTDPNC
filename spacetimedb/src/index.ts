// ─────────────────────────────────────────────────────────────────────────────
// SpaceTime 360 module: loaders, recompute reducers, validation.
// Reducers never return data: every result lands in a public table that the
// frontend subscribes to (see schema.ts).
// ─────────────────────────────────────────────────────────────────────────────
import { t, SenderError, type InferSchema, type ProcedureCtx, type ReducerCtx } from 'spacetimedb/server';
import spacetimedb, { account, customer, ledgerEntry, statement } from './schema';
import { computeCarry, computeSnapshot } from './math/book';
import { computePnl, computeSpending } from './math/pnl';
import { computeDailyAccountTotal, computeDailyLiquid } from './math/daily';
import { dayNumber, isoFromDayNumber } from './math/dates';
import { BUFFER_MONTHS, DEBT_TYPES, HIGH_COST_APR } from './math/book';
import { SHRINK_K, buildSchedule } from './math/schedule';
import { type Assumptions, DEFAULT_ASSUMPTIONS, type ForecastResult, type Scenario, habitAssumptions, makeTapes, runForecast } from './math/forecast';
import { RISK_CAP, analyze, sourceLabel } from './math/coach';
import { seedFromString } from './math/rng';
import { type Fact, SYSTEM_PROMPT, auditReply, pct, templateText, usd, userPrompt } from './math/narrate';
import { backtestCustomer } from './math/backtest';
import { GOAL_KINDS, MAX_GOAL_DAYS, evaluateGoal } from './math/goals';
import { ANSWER_ASK, ANSWER_TOPIC, PARSE_PROMPT, TOPIC_LABELS, evaluateQuestion, parseScenario } from './math/ask';
import { addMonths, debtsFromSchedule, simulatePayoff } from './math/payoff';

export default spacetimedb;

type Ctx = ReducerCtx<InferSchema<typeof spacetimedb>>;
const round = (x: number) => Math.round(x);

function assertAdmin(ctx: Ctx) {
  if (!ctx.db.admin.identity.find(ctx.sender)) {
    throw new SenderError('Only the database owner can load or reset data');
  }
}

// The publisher becomes the admin.
export const init = spacetimedb.init(ctx => {
  ctx.db.admin.insert({ identity: ctx.sender });
});

// ---------- loaders (idempotent upserts, owner only) ----------
export const load_customers = spacetimedb.reducer({ rows: t.array(customer.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.customer.customer_id.find(r.customer_id)) ctx.db.customer.customer_id.update(r);
    else ctx.db.customer.insert(r);
  }
});

export const load_accounts = spacetimedb.reducer({ rows: t.array(account.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.account.account_id.find(r.account_id)) ctx.db.account.account_id.update(r);
    else ctx.db.account.insert(r);
  }
});

export const load_ledger = spacetimedb.reducer({ rows: t.array(ledgerEntry.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.ledgerEntry.transaction_id.find(r.transaction_id)) ctx.db.ledgerEntry.transaction_id.update(r);
    else ctx.db.ledgerEntry.insert(r);
  }
});

export const load_statements = spacetimedb.reducer({ rows: t.array(statement.rowType) }, (ctx, { rows }) => {
  assertAdmin(ctx);
  for (const r of rows) {
    if (ctx.db.statement.statement_id.find(r.statement_id)) ctx.db.statement.statement_id.update(r);
    else ctx.db.statement.insert(r);
  }
});

function clearResults(ctx: Ctx, cid: string) {
  if (ctx.db.bookSnapshot.customer_id.find(cid)) ctx.db.bookSnapshot.customer_id.delete(cid);
  if (ctx.db.carrySummary.customer_id.find(cid)) ctx.db.carrySummary.customer_id.delete(cid);
  for (const r of [...ctx.db.bookLine.customer_id.filter(cid)]) ctx.db.bookLine.account_id.delete(r.account_id);
  for (const r of [...ctx.db.carryMove.customer_id.filter(cid)]) ctx.db.carryMove.move_id.delete(r.move_id);
  for (const r of [...ctx.db.pnlMonth.customer_id.filter(cid)]) ctx.db.pnlMonth.pnl_id.delete(r.pnl_id);
  for (const r of [...ctx.db.spendingMonth.customer_id.filter(cid)]) ctx.db.spendingMonth.spending_id.delete(r.spending_id);
  for (const r of [...ctx.db.dailyLiquid.customer_id.filter(cid)]) ctx.db.dailyLiquid.daily_id.delete(r.daily_id);
  for (const r of [...ctx.db.validationIssue.customer_id.filter(cid)]) ctx.db.validationIssue.issue_id.delete(r.issue_id);
}

export const reset_data = spacetimedb.reducer(ctx => {
  assertAdmin(ctx);
  for (const c of [...ctx.db.customer.iter()]) clearResults(ctx, c.customer_id);
  for (const r of [...ctx.db.ledgerEntry.iter()]) ctx.db.ledgerEntry.transaction_id.delete(r.transaction_id);
  for (const r of [...ctx.db.statement.iter()]) ctx.db.statement.statement_id.delete(r.statement_id);
  for (const r of [...ctx.db.externalAccount.iter()]) ctx.db.externalAccount.account_id.delete(r.account_id);
  for (const r of [...ctx.db.account.iter()]) ctx.db.account.account_id.delete(r.account_id);
  for (const r of [...ctx.db.customer.iter()]) ctx.db.customer.customer_id.delete(r.customer_id);
});

// ---------- validation: refuse to trust numbers from data that doesn't reconcile ----------
function validate(ctx: Ctx, cid: string, stmts: { account_id: string; month: string; opening_cents: number; increases_cents: number; decreases_cents: number; closing_cents: number }[], balances: Map<string, number>) {
  const issue = (kind: string, detail: string) =>
    ctx.db.validationIssue.insert({ issue_id: 0n, customer_id: cid, kind, detail });
  const byAccount = new Map<string, typeof stmts>();
  for (const s of stmts) {
    if (round(s.opening_cents + s.increases_cents - s.decreases_cents - s.closing_cents) !== 0)
      issue('statement_unbalanced', `${s.account_id} ${s.month}`);
    byAccount.set(s.account_id, [...(byAccount.get(s.account_id) ?? []), s]);
  }
  for (const [acct, list] of byAccount) {
    list.sort((a, b) => (a.month < b.month ? -1 : 1));
    for (let i = 1; i < list.length; i++)
      if (round(list[i].opening_cents - list[i - 1].closing_cents) !== 0)
        issue('statement_chain_break', `${acct} ${list[i].month}`);
    const last = list[list.length - 1];
    if (round(last.closing_cents - (balances.get(acct) ?? 0)) !== 0)
      issue('closing_mismatch', `${acct}: statement ${last.closing_cents} vs account ${balances.get(acct)}`);
  }
}

// ---------- linked outside accounts ("connect to other banks") ----------
const EXTERNAL_TYPES = new Set(['checking', 'savings', 'cd', 'ira', 'credit_card', 'auto_loan', 'personal_loan', 'mortgage']);
const MAX_EXTERNAL = 10;

function externalAccountsOf(ctx: Ctx, cid: string) {
  return [...ctx.db.externalAccount.customer_id.filter(cid)]
    .sort((a, b) => (a.account_id < b.account_id ? -1 : 1))
    .map(x => ({ ...x, opening_balance_cents: x.balance_cents }));
}

/** Link an account held at another bank; the book recomputes right away. Call run_forecast to refresh the forecast. */
export const add_external_account = spacetimedb.reducer(
  {
    customer_id: t.string(),
    institution: t.string(),
    account_type: t.string(),
    nickname: t.string(),
    balance_cents: t.f64(),
    apr_pct: t.f64(),
    annual_yield_pct: t.f64(),
    monthly_payment_cents: t.f64(),
  },
  (ctx, a) => {
    if (!ctx.db.customer.customer_id.find(a.customer_id)) throw new SenderError(`Unknown customer ${a.customer_id}`);
    if (!EXTERNAL_TYPES.has(a.account_type)) throw new SenderError(`Unsupported account type ${a.account_type}`);
    const institution = a.institution.trim();
    if (!institution || institution.length > 60) throw new SenderError('Institution name must be 1-60 characters');
    if (a.nickname.length > 60) throw new SenderError('Nickname must be at most 60 characters');
    const finite = [a.balance_cents, a.apr_pct, a.annual_yield_pct, a.monthly_payment_cents].every(Number.isFinite);
    if (!finite || a.balance_cents < 0 || a.monthly_payment_cents < 0) throw new SenderError('Balances and payments must be non-negative numbers');
    if (a.apr_pct < 0 || a.apr_pct > 100 || a.annual_yield_pct < 0 || a.annual_yield_pct > 100) throw new SenderError('Rates must be between 0 and 100 percent');
    const existing = [...ctx.db.externalAccount.customer_id.filter(a.customer_id)];
    if (existing.length >= MAX_EXTERNAL) throw new SenderError(`At most ${MAX_EXTERNAL} linked accounts per customer`);
    const n = 1 + existing.reduce((m, x) => Math.max(m, Number(x.account_id.split('-').pop()) || 0), 0);
    ctx.db.externalAccount.insert({
      account_id: `EXT-${a.customer_id}-${n}`,
      customer_id: a.customer_id,
      institution,
      nickname: a.nickname.trim(),
      account_type: a.account_type,
      balance_cents: Math.round(a.balance_cents),
      apr_pct: a.apr_pct,
      annual_yield_pct: a.annual_yield_pct,
      monthly_payment_cents: Math.round(a.monthly_payment_cents),
      added_at: ctx.timestamp,
    });
    recomputeCustomer(ctx, a.customer_id);
  }
);

export const remove_external_account = spacetimedb.reducer({ account_id: t.string() }, (ctx, { account_id }) => {
  const x = ctx.db.externalAccount.account_id.find(account_id);
  if (!x) throw new SenderError(`Unknown linked account ${account_id}`);
  ctx.db.externalAccount.account_id.delete(account_id);
  recomputeCustomer(ctx, x.customer_id);
});

// ---------- recompute ----------
function recomputeCustomer(ctx: Ctx, cid: string) {
  const prof = ctx.db.customer.customer_id.find(cid);
  if (!prof) throw new SenderError(`Unknown customer ${cid}`);
  const accts = [...ctx.db.account.customer_id.filter(cid)].sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
  const external = externalAccountsOf(ctx, cid);
  const allAccts = [...accts, ...external];
  const ledger = [...ctx.db.ledgerEntry.customer_id.filter(cid)];
  const stmts = [...ctx.db.statement.customer_id.filter(cid)];
  clearResults(ctx, cid);

  validate(ctx, cid, stmts, new Map(accts.map(a => [a.account_id, a.balance_cents])));

  // §1 book snapshot
  const months = [...new Set(stmts.map(s => s.month))].sort();
  const lastMonth = months[months.length - 1] ?? '';
  const [ly, lm] = lastMonth.split('-').map(Number);
  const nextMonthStart = lastMonth ? `${lm === 12 ? ly + 1 : ly}-${String(lm === 12 ? 1 : lm + 1).padStart(2, '0')}-01` : '';
  const asOf = lastMonth ? isoFromDayNumber(dayNumber(nextMonthStart) - 1) : '';
  const snap = computeSnapshot(prof, allAccts);
  ctx.db.bookSnapshot.insert({ customer_id: cid, as_of: asOf, ...snap });

  // §2 carry
  const carry = computeCarry(allAccts, snap.liquid_cents, snap.monthly_outflow_cents);
  for (const l of carry.lines) ctx.db.bookLine.insert({ customer_id: cid, ...l, annual_carry_cents: round(l.annual_carry_cents) });
  const s = carry.summary;
  ctx.db.carrySummary.insert({
    customer_id: cid,
    earn_cents: round(s.earn_cents),
    cost_cents: round(s.cost_cents),
    net_cents: round(s.net_cents),
    structural_cents: round(s.structural_cents),
    high_cost_cents: round(s.high_cost_cents),
    idle_cash_cents: s.idle_cash_cents,
    fixable_leak_cents: round(s.fixable_leak_cents),
    buffer_months: s.buffer_months,
  });
  for (const m of carry.moves)
    ctx.db.carryMove.insert({ move_id: `${cid}|${m.account_id}`, customer_id: cid, ...m, annual_saving_cents: round(m.annual_saving_cents) });

  // §3 P&L attribution + spending by category
  for (const p of computePnl(ledger, stmts)) {
    ctx.db.pnlMonth.insert({ pnl_id: `${cid}|${p.month}`, customer_id: cid, ...p });
    if (p.residual_cents !== 0)
      ctx.db.validationIssue.insert({ issue_id: 0n, customer_id: cid, kind: 'pnl_residual', detail: `${p.month}: ${p.residual_cents} cents unexplained` });
  }
  for (const sp of computeSpending(ledger))
    ctx.db.spendingMonth.insert({ spending_id: `${cid}|${sp.month}|${sp.category}`, customer_id: cid, ...sp });

  // daily liquid balance for the Past view
  if (months.length) {
    for (const d of computeDailyLiquid(ledger, accts, `${months[0]}-01`, asOf))
      ctx.db.dailyLiquid.insert({ daily_id: `${cid}|${d.date}`, customer_id: cid, ...d });
  }
}

export const recompute_customer = spacetimedb.reducer({ customer_id: t.string() }, (ctx, { customer_id }) => {
  recomputeCustomer(ctx, customer_id);
});

export const recompute_all = spacetimedb.reducer(ctx => {
  assertAdmin(ctx);
  for (const c of [...ctx.db.customer.iter()]) recomputeCustomer(ctx, c.customer_id);
});

// ─────────────────────────────────────────────────────────────────────────────
// Forecast (spec §4–§9): 180-day Monte Carlo, stress tests, sensitivities, coach.
// ─────────────────────────────────────────────────────────────────────────────
function scheduleFor(ctx: Ctx, cid: string, horizonDays = DEFAULT_ASSUMPTIONS.horizonDays) {
  const prof = ctx.db.customer.customer_id.find(cid);
  if (!prof) throw new SenderError(`Unknown customer ${cid}`);
  const accts = [...ctx.db.account.customer_id.filter(cid)].sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
  const ledger = [...ctx.db.ledgerEntry.customer_id.filter(cid)];
  if (!ledger.length) throw new SenderError(`No ledger for ${cid}`);
  const asOf = ledger.reduce((m, t) => (t.posted_date > m ? t.posted_date : m), '');
  const external = externalAccountsOf(ctx, cid);
  const snap = computeSnapshot(prof, [...accts, ...external]);
  return { schedule: buildSchedule(ledger, accts, asOf, horizonDays, external), snap, asOf };
}

function clearScenario(ctx: Ctx, cid: string, scenario: string) {
  for (const r of [...ctx.db.forecastBand.customer_id.filter(cid)])
    if (r.scenario === scenario) ctx.db.forecastBand.band_id.delete(r.band_id);
  for (const r of [...ctx.db.riskSource.customer_id.filter(cid)])
    if (r.scenario === scenario) ctx.db.riskSource.risk_id.delete(r.risk_id);
  const run = ctx.db.forecastRun.run_id.find(`${cid}|${scenario}`);
  if (run) ctx.db.forecastRun.run_id.delete(run.run_id);
}

function writeForecast(ctx: Ctx, cid: string, f: ForecastResult, a: Assumptions) {
  const scenario = f.scenario.id;
  clearScenario(ctx, cid, scenario);
  ctx.db.forecastRun.insert({
    run_id: `${cid}|${scenario}`,
    customer_id: cid,
    scenario,
    label: f.scenario.label,
    include_external: f.scenario.includeExternal,
    paths: 2 * a.pairs,
    horizon_days: a.horizonDays,
    start_date: f.dates[0],
    threshold_cents: a.thresholdCents,
    p_low: f.pLow,
    p_low_se: f.pLowSe,
    var95_cents: round(f.var95),
    es95_cents: round(f.es95),
    mdd_p50_cents: round(f.mddP50),
    mdd_p95_cents: round(f.mddP95),
    end_liquid_p5_cents: round(f.endLiquid.p5),
    end_liquid_p50_cents: round(f.endLiquid.p50),
    end_liquid_p95_cents: round(f.endLiquid.p95),
    end_net_worth_p5_cents: round(f.endNetWorth.p5),
    end_net_worth_p50_cents: round(f.endNetWorth.p50),
    end_net_worth_p95_cents: round(f.endNetWorth.p95),
    planned_change_cents: round(f.deterministicChange),
  });
  f.bands.forEach((b, i) =>
    ctx.db.forecastBand.insert({
      band_id: `${cid}|${scenario}|${i}`,
      customer_id: cid,
      scenario,
      day_index: i,
      date: f.dates[i],
      p5_cents: round(b.p5),
      p25_cents: round(b.p25),
      p50_cents: round(b.p50),
      p75_cents: round(b.p75),
      p95_cents: round(b.p95),
    })
  );
  for (const src of f.sources)
    ctx.db.riskSource.insert({
      risk_id: `${cid}|${scenario}|${src.source}`,
      customer_id: cid,
      scenario,
      source: src.source,
      var_share: src.varShare,
      es_contribution_cents: round(src.esContribution),
    });
}

const PAST_DAYS = 180;

function writeTimeline(ctx: Ctx, cid: string, cont: ForecastResult, coach: ForecastResult) {
  for (const r of [...ctx.db.timeline360.customer_id.filter(cid)]) ctx.db.timeline360.timeline_id.delete(r.timeline_id);
  const asOfDn = dayNumber(cont.dates[0]);
  const start = isoFromDayNumber(asOfDn - PAST_DAYS);
  const accts = [...ctx.db.account.customer_id.filter(cid)];
  const highCost = new Set(
    accts.filter(a => DEBT_TYPES.has(a.account_type) && a.apr_pct >= HIGH_COST_APR).map(a => a.account_id)
  );
  const ledger = [...ctx.db.ledgerEntry.customer_id.filter(cid)];
  const firstDate = ledger.reduce((m, t) => (t.posted_date < m ? t.posted_date : m), cont.dates[0]);
  const debt = computeDailyAccountTotal(ledger, accts, highCost, firstDate, cont.dates[0]);
  const liquid = new Map<string, number>();
  for (const d of ctx.db.dailyLiquid.customer_id.filter(cid)) liquid.set(d.date, d.liquid_cents);
  // Linked outside accounts have no history here: shown flat at today's balance.
  const ext = externalAccountsOf(ctx, cid);
  const extLiquid = ext.filter(a => a.account_type === 'checking' || a.account_type === 'savings').reduce((s, a) => s + a.balance_cents, 0);
  const extHighCost = ext.filter(a => DEBT_TYPES.has(a.account_type) && a.apr_pct >= HIGH_COST_APR).reduce((s, a) => s + a.balance_cents, 0);
  for (let off = -PAST_DAYS; off <= cont.bands.length - 1; off++) {
    const date = isoFromDayNumber(asOfDn + off);
    const bankPast = off <= 0 && date >= start ? liquid.get(date) : undefined;
    const past = bankPast !== undefined ? bankPast + extLiquid : undefined;
    const c = off >= 0 ? cont.netCashBands[off] : undefined;
    const k = off >= 0 ? coach.netCashBands[off] : undefined;
    ctx.db.timeline360.insert({
      timeline_id: `${cid}|${off}`,
      customer_id: cid,
      day_offset: off,
      date,
      actual_net_cash_cents: past !== undefined ? round(past - (debt.get(date) ?? 0) - extHighCost) : undefined,
      actual_liquid_cents: past,
      continue_low_cents: c ? round(c.p5) : undefined,
      continue_mid_cents: c ? round(c.p50) : undefined,
      continue_high_cents: c ? round(c.p95) : undefined,
      coach_low_cents: k ? round(k.p5) : undefined,
      coach_mid_cents: k ? round(k.p50) : undefined,
      coach_high_cents: k ? round(k.p95) : undefined,
    });
  }
}

/** Full forward analysis for one customer: baseline, coach path, stresses, sensitivities, frontier. */
export const run_forecast = spacetimedb.reducer(
  { customer_id: t.string(), include_external: t.bool() },
  (ctx, { customer_id: cid, include_external }) => {
    const { schedule, snap } = scheduleFor(ctx, cid);
    const a = DEFAULT_ASSUMPTIONS;
    const seed = seedFromString(cid);
    const an = analyze(schedule, a, seed, include_external, snap.monthly_outflow_cents);
    for (const f of [an.baseline, an.coach, ...an.stresses]) writeForecast(ctx, cid, f, a);

    // Debt payoff: today's payments vs the coach's move plus rolled-over payments.
    const move = an.actions.find(x => x.kind === 'move_cash_to_debt')?.amountCents ?? 0;
    const debts = debtsFromSchedule(schedule);
    const now = simulatePayoff(debts, 0, false);
    const plan = simulatePayoff(debts, move, true);
    const snow = simulatePayoff(debts, move, true, 'snowball');
    const asOfIso = schedule.asOf;
    const monthOf = (n: number | undefined) => (n === undefined ? undefined : addMonths(asOfIso, n));
    for (const r of [...ctx.db.debtPayoff.customer_id.filter(cid)]) ctx.db.debtPayoff.account_id.delete(r.account_id);
    now.debts.forEach((d, i) => {
      const c = plan.debts[i];
      ctx.db.debtPayoff.insert({
        account_id: d.id, customer_id: cid, account_type: d.type, balance_cents: d.balance, apr_pct: d.aprPct,
        monthly_payment_cents: round(d.monthlyPayment), payoff_months: d.months, payoff_month: monthOf(d.months),
        interest_cents: round(d.interest), coach_payoff_months: c.months, coach_payoff_month: monthOf(c.months),
        coach_interest_cents: round(c.interest),
        snowball_payoff_months: snow.debts[i].months, snowball_payoff_month: monthOf(snow.debts[i].months),
      });
    });
    if (ctx.db.debtPlan.customer_id.find(cid)) ctx.db.debtPlan.customer_id.delete(cid);
    ctx.db.debtPlan.insert({
      customer_id: cid,
      consumer_free_month: monthOf(now.consumerMonths),
      coach_consumer_free_month: monthOf(plan.consumerMonths),
      all_free_month: monthOf(now.allMonths),
      coach_all_free_month: monthOf(plan.allMonths),
      total_interest_cents: round(now.totalInterest),
      coach_total_interest_cents: round(plan.totalInterest),
      interest_saved_cents: round(now.totalInterest - plan.totalInterest),
      coach_move_cents: move,
      snowball_consumer_free_month: monthOf(snow.consumerMonths),
      snowball_total_interest_cents: round(snow.totalInterest),
      snowball_extra_interest_cents: round(snow.totalInterest - plan.totalInterest),
    });

    // Danger days from the baseline (life events included).
    for (const r of [...ctx.db.dangerDay.customer_id.filter(cid)]) ctx.db.dangerDay.danger_id.delete(r.danger_id);
    an.baseline.danger.forEach((d, i) =>
      ctx.db.dangerDay.insert({
        danger_id: `${cid}|${d.date}`, customer_id: cid, date: d.date, day_index: i + 1, threshold_cents: a.dangerThresholdCents,
        p_below: d.pBelow, p_negative: d.pNegative, checking_low_cents: round(d.checkingP10), reasons: d.reasons,
      })
    );

    // Habit view: the two lines on the 360° chart, same random draws, life events off.
    const h = habitAssumptions(a);
    const tapes = makeTapes(seed, h, schedule.months.length + 1);
    const habitContinue = runForecast(schedule, h, { ...an.baseline.scenario, id: 'habit_continue', label: 'If you continue like this' }, tapes);
    const habitCoach = runForecast(schedule, h, { ...an.coach.scenario, id: 'habit_coach', label: 'If you follow the coach' }, tapes);
    writeForecast(ctx, cid, habitContinue, h);
    writeForecast(ctx, cid, habitCoach, h);
    writeTimeline(ctx, cid, habitContinue, habitCoach);

    for (const r of [...ctx.db.sensitivity.customer_id.filter(cid)]) ctx.db.sensitivity.sensitivity_id.delete(r.sensitivity_id);
    for (const r of an.sensitivities)
      ctx.db.sensitivity.insert({
        sensitivity_id: `${cid}|${r.lever}`, customer_id: cid, lever: r.lever, label: r.label,
        delta_p_low: r.deltaPLow, delta_end_p50_cents: round(r.deltaEndP50),
      });
    for (const r of [...ctx.db.frontierPoint.customer_id.filter(cid)]) ctx.db.frontierPoint.frontier_id.delete(r.frontier_id);
    an.frontier.forEach((p, i) =>
      ctx.db.frontierPoint.insert({
        frontier_id: `${cid}|${i}`, customer_id: cid, move_cents: p.moveCents, p_low: p.pLow,
        annual_saving_cents: round(p.annualSavingCents), recommended: p.recommended,
      })
    );
    for (const r of [...ctx.db.coachAction.customer_id.filter(cid)]) ctx.db.coachAction.action_id.delete(r.action_id);
    for (const x of an.actions)
      ctx.db.coachAction.insert({
        action_id: `${cid}|${x.kind}`, customer_id: cid, kind: x.kind, amount_cents: x.amountCents, fraction: x.fraction,
        annual_saving_cents: round(x.annualSavingCents), p_low_before: x.pLowBefore, p_low_after: x.pLowAfter, detail: x.detail,
        driver: x.driver, es_before_cents: round(x.esBefore), es_after_cents: round(x.esAfter),
      });
    const existing = ctx.db.forecastAssumption.customer_id.find(cid);
    if (existing) ctx.db.forecastAssumption.customer_id.delete(cid);
    ctx.db.forecastAssumption.insert({
      customer_id: cid,
      sigma_shared: schedule.sigmaShared,
      sigma_idio: schedule.sigmaIdio,
      phi: schedule.phi,
      income_sigma: schedule.incomeSigma,
      shrink_k: SHRINK_K,
      student_t_nu: a.nu,
      jumps_per_year: a.jumpsPerYear,
      jump_median_cents: a.jumpMedianCents,
      p_job_loss_monthly: a.pEmployedToJobLoss,
      p_rehire_monthly: a.pJobLossToEmployed,
      ira_mu: a.iraMu,
      ira_sigma: a.iraSigma,
      risk_cap: RISK_CAP,
      buffer_months: BUFFER_MONTHS,
      seed,
    });
  }
);

function writeWhatifLine(ctx: Ctx, cid: string, f: ForecastResult, label: string) {
  for (const r of [...ctx.db.timelineWhatif.customer_id.filter(cid)]) ctx.db.timelineWhatif.whatif_id.delete(r.whatif_id);
  f.netCashBands.forEach((b, i) =>
    ctx.db.timelineWhatif.insert({
      whatif_id: `${cid}|${i}`, customer_id: cid, day_offset: i, date: f.dates[i],
      low_cents: round(b.p5), mid_cents: round(b.p50), high_cents: round(b.p95), label,
    })
  );
}

const CategoryMult = t.object('CategoryMult', { category: t.string(), mult: t.f64() });

/** What-if simulator: one custom scenario on the same random draws as the baseline (shared live). */
export const run_what_if = spacetimedb.reducer(
  {
    customer_id: t.string(),
    include_external: t.bool(),
    income_mult: t.f64(),
    category_mults: t.array(CategoryMult),
    one_off_cents: t.f64(),
    one_off_day: t.u32(),
    move_to_debt_cents: t.f64(),
    job_loss_months: t.u32(),
    card_apr_bump_pct: t.f64(),
  },
  (ctx, args) => {
    const { schedule } = scheduleFor(ctx, args.customer_id);
    const a = DEFAULT_ASSUMPTIONS;
    const tapes = makeTapes(seedFromString(args.customer_id), a, schedule.months.length + 1);
    const sc: Scenario = {
      id: 'what_if',
      label: 'What if',
      includeExternal: args.include_external,
      incomeMult: args.income_mult,
      categoryMult: Object.fromEntries(args.category_mults.map(c => [c.category, c.mult])),
      oneOff: args.one_off_cents > 0 ? { dayIndex: Math.min(args.one_off_day, a.horizonDays - 1), cents: args.one_off_cents } : undefined,
      moveToDebtCents: args.move_to_debt_cents,
      jobLossMonths: args.job_loss_months,
      cardAprBumpPct: args.card_apr_bump_pct,
    };
    writeForecast(ctx, args.customer_id, runForecast(schedule, a, sc, tapes), a);
    // third line on the 360° chart: same habit view and net-cash measure as the other two lines
    const h = habitAssumptions(a);
    writeWhatifLine(ctx, args.customer_id, runForecast(schedule, h, sc, makeTapes(seedFromString(args.customer_id), h, schedule.months.length + 1)), 'Your what-if');
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// AI narration: Groq explains stored numbers; it never computes them.
// ─────────────────────────────────────────────────────────────────────────────
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

function gatherFacts(ctx: Ctx, cid: string): Fact[] {
  const f: Fact[] = [];
  const add = (key: string, text: string) => f.push({ key, text });
  const snap = ctx.db.bookSnapshot.customer_id.find(cid);
  if (!snap) throw new SenderError(`No results for ${cid}; run recompute_customer first`);
  add('net_worth', `Net worth (excluding home value): ${usd(snap.net_worth_cents)}`);
  add('cash', `Cash in checking and savings: ${usd(snap.liquid_cents)}`);
  if (snap.runway_months !== undefined) add('runway', `Months of essential bills cash would cover: ${snap.runway_months.toFixed(1)}`);
  if (snap.debt_to_income !== undefined) add('dti', `Share of income going to debt payments: ${pct(snap.debt_to_income, 0)}`);
  if (snap.utilization !== undefined) add('utilization', `Credit card utilization: ${pct(snap.utilization, 0)}`);

  const carry = ctx.db.carrySummary.customer_id.find(cid);
  if (carry) {
    add('carry', `Yearly interest earned on savings: ${usd(carry.earn_cents)}; yearly interest paid on debt: ${usd(carry.cost_cents)}`);
    if (carry.fixable_leak_cents > 0) add('fixable_leak', `Interest that could be saved each year by using spare cash on expensive debt: ${usd(carry.fixable_leak_cents)}`);
  }

  const pnl = [...ctx.db.pnlMonth.customer_id.filter(cid)].sort((a, b) => (a.month < b.month ? -1 : 1)).slice(-6);
  if (pnl.length) {
    const s = (k: keyof (typeof pnl)[number]) => pnl.reduce((p, r) => p + (r[k] as number), 0);
    add('income_6m', `Paychecks over the last 6 months: ${usd(s('income_cents'))}`);
    add('spending_6m', `Spending over the last 6 months: ${usd(s('spending_cents'))}`);
    add('debt_interest_6m', `Debt interest over the last 6 months: ${usd(s('debt_interest_cents'))}`);
    const ext = s('ext_in_cents') - s('ext_out_cents');
    if (Math.abs(ext) > 10_000) add('external_6m', `Money moved in from accounts outside this bank over the last 6 months: ${usd(ext)}`);
    add('organic_6m', `Change in net worth from your own earning and spending over the last 6 months: ${usd(s('organic_cents'))}`);
  }

  const tl = [...ctx.db.timeline360.customer_id.filter(cid)];
  const today = tl.find(r => r.day_offset === 0);
  const end = tl.reduce<(typeof tl)[number] | undefined>((m, r) => (!m || r.day_offset > m.day_offset ? r : m), undefined);
  if (today?.actual_net_cash_cents !== undefined) add('net_cash_today', `Net cash today (cash minus high-interest debt): ${usd(today.actual_net_cash_cents)}`);
  if (end?.continue_mid_cents !== undefined && end.continue_low_cents !== undefined && end.continue_high_cents !== undefined) {
    add('continue_180', `Net cash in 180 days if you continue as you are: about ${usd(end.continue_mid_cents)} (likely between ${usd(end.continue_low_cents)} and ${usd(end.continue_high_cents)})`);
    const band = (end.continue_high_cents - end.continue_low_cents) / 2;
    if (today?.actual_liquid_cents) add('band_note', `Forecast margin for normal ups and downs: plus or minus ${usd(band)}, about ${pct(band / today.actual_liquid_cents)} of your cash`);
  }
  if (end?.coach_mid_cents !== undefined) {
    add('coach_180', `Net cash in 180 days if you follow the coach: about ${usd(end.coach_mid_cents)}`);
    if (end.continue_mid_cents !== undefined) add('coach_gain', `Difference from following the coach after 180 days: ${usd(end.coach_mid_cents - end.continue_mid_cents)}`);
  }
  const base = ctx.db.forecastRun.run_id.find(`${cid}|baseline`);
  if (base) add('p_low', `Chance cash drops below ${usd(base.threshold_cents)} in the next 180 days (including surprises): ${pct(base.p_low)}`);
  const job = ctx.db.forecastRun.run_id.find(`${cid}|stress_job_loss`);
  if (job) add('stress_job_loss', `That chance if income stopped for 3 months: ${pct(job.p_low)}`);
  const bill = ctx.db.forecastRun.run_id.find(`${cid}|stress_bill`);
  if (bill) add('stress_bill', `That chance after a surprise $3,000 bill: ${pct(bill.p_low)}`);
  // advanced risk metrics, in plain words
  if (base) {
    add('es_worst', `In the worst 5% of futures, your cash falls by an average of ${usd(base.es95_cents)} over 180 days`);
    add('dip', `Deepest dip in cash you would likely see (only a 1-in-20 chance of worse): ${usd(base.mdd_p95_cents)}`);
  }
  const drivers = [...ctx.db.riskSource.customer_id.filter(cid)]
    .filter(r => r.scenario === 'baseline' && r.source !== 'planned_cash_flow' && r.es_contribution_cents > 0)
    .sort((x, y) => y.es_contribution_cents - x.es_contribution_cents);
  const uncertainTotal = drivers.reduce((p, r) => p + r.es_contribution_cents, 0);
  if (drivers.length && uncertainTotal > 0)
    add('top_risk', `Biggest driver of a bad outcome: ${sourceLabel(drivers[0].source)} (${pct(drivers[0].es_contribution_cents / uncertainTotal, 0)} of the uncertain part of the worst case)`);
  const lever = [...ctx.db.sensitivity.customer_id.filter(cid)]
    .filter(r => r.lever.startsWith('spend:') && !['spend:housing', 'spend:utilities'].includes(r.lever) && r.delta_end_p50_cents > 0)
    .sort((x, y) => y.delta_end_p50_cents - x.delta_end_p50_cents)[0];
  if (lever) add('top_lever', `Spending change that helps your 180-day cash the most: ${lever.label} (about ${usd(lever.delta_end_p50_cents)} more cash)`);

  const worst = (a: { es_before_cents: number; es_after_cents: number }) =>
    a.es_before_cents > 0 && Math.round(a.es_after_cents) !== Math.round(a.es_before_cents)
      ? `; average worst-case loss goes from ${usd(a.es_before_cents)} to ${usd(a.es_after_cents)}`
      : '';
  for (const a of ctx.db.coachAction.customer_id.filter(cid)) {
    if (a.kind === 'move_cash_to_debt')
      add('action_move', `Coach suggestion: move ${usd(a.amount_cents)} of spare cash to your highest-interest debt, saving about ${usd(a.annual_saving_cents)} a year; chance of running low goes from ${pct(a.p_low_before)} to ${pct(a.p_low_after)}`);
    else if (a.kind === 'trim_category')
      add('action_trim_category', `Coach suggestion: trim ${sourceLabel(a.driver)} by ${pct(a.fraction, 0)} (${usd(a.amount_cents)} a month), because it is your biggest swing factor${worst(a)}`);
    else if (a.kind === 'protect_income')
      add('action_protect_income', a.fraction > 0
        ? `Coach suggestion: a drop in income is your biggest risk, so keep a cash cushion and trim extras by ${pct(a.fraction, 0)} (${usd(a.amount_cents)} a month)${worst(a)}`
        : `Coach note: a drop in income is your biggest risk, which is why the coach always leaves a cash cushion of a few months of bills`);
    else if (a.kind === 'reserve_for_surprises')
      add('action_reserve', `Coach suggestion: keep about ${usd(a.amount_cents)} set aside for surprise bills, your biggest risk${worst(a)}`);
    else if (a.kind === 'close_monthly_gap')
      add('action_gap', `Coach finding: ${a.detail.replace(/\.$/, '')}${worst(a)}`);
    else
      add('action_trim', `Coach suggestion: trim dining, shopping and other extras by ${pct(a.fraction, 0)} (${usd(a.amount_cents)} a month, ${usd(a.annual_saving_cents)} a year)`);
  }
  const longDate = (iso: string) => {
    const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${M[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
  };
  for (const g of ctx.db.goal.customer_id.filter(cid)) {
    const r = ctx.db.goalResult.goal_id.find(g.goal_id);
    if (!r) continue;
    const what = g.kind === 'save_extra' ? `save an extra ${usd(g.target_cents)}` : `have ${usd(g.target_cents)} in cash`;
    const plan =
      r.p_success >= 0.8
        ? ''
        : r.needed_80_cents !== undefined
          ? `; keeping about ${usd(r.needed_80_cents)} more each month raises the chance to ${pct(r.p_with_needed_80 ?? 0.8, 0)}` +
            (r.needed_share_of_extras !== undefined && r.needed_share_of_extras > 1
              ? ', which is more than your whole monthly spending on dining, shopping and other extras, so a later date or smaller target is more realistic'
              : r.needed_share_of_extras !== undefined
                ? ` (about ${pct(r.needed_share_of_extras, 0)} of what you spend on dining, shopping and other extras)`
                : '')
          : '; saving more alone would not get there in time';
    add('goal', `Goal "${g.name}" (${what} by ${longDate(g.target_date)}): chance of reaching it ${pct(r.p_success, 0)}${plan}`);
  }
  const dangers = [...ctx.db.dangerDay.customer_id.filter(cid)].sort((x, y) => x.day_index - y.day_index);
  if (dangers.length) {
    const next = dangers.find(d => d.p_below >= 0.1);
    const M = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const when = (iso: string) => `${M[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`;
    if (next)
      add('danger', `Next day your checking could dip below ${usd(next.threshold_cents)}: ${when(next.date)} (${pct(next.p_below, 0)} chance)${next.reasons ? `, when ${next.reasons} come out` : ''}`);
    else add('danger', `No day in the next 180 has more than a 10% chance of checking dipping below ${usd(dangers[0].threshold_cents)}`);
  }
  const dp = ctx.db.debtPlan.customer_id.find(cid);
  if (dp) {
    const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mon = (ym: string | undefined) => (ym ? `${MN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}` : 'not at the current pace');
    add('debt_free', `Debt other than the mortgage paid off by: ${mon(dp.consumer_free_month)} at today's payments; ${mon(dp.coach_consumer_free_month)} with the coach's plan (spare cash to the highest-rate debt, then rolling each paid-off payment into the next)`);
    const stuck = [...ctx.db.debtPayoff.customer_id.filter(cid)].filter(d => d.payoff_months === undefined && d.account_type !== 'mortgage');
    if (dp.interest_saved_cents > 0)
      add('interest_saved', `Interest saved over the life of your debts with the coach's plan: ${usd(dp.interest_saved_cents)}${stuck.length ? ' (a balance that never shrinks is counted for up to 40 years)' : ''}`);
    const extra = dp.snowball_extra_interest_cents;
    const vs = Math.abs(extra) < 100 ? "about the same interest as the coach's plan" : extra > 0 ? `${usd(extra)} more interest than the coach's plan` : `${usd(-extra)} less interest than the coach's plan`;
    add('snowball', `Paying the smallest balance first (snowball) instead: debt other than the mortgage paid off by ${mon(dp.snowball_consumer_free_month)}, with ${vs}`);
    if (stuck.length) add('debt_stuck', `Not shrinking at today's payments: ${stuck.map(d => d.account_type.replace('_', ' ')).join(', ')}`);
  }
  return f;
}

const TOPICS = new Set(['overview', 'past', 'future', 'coach', 'risk', 'goals']);

/** Explain a customer's numbers in plain language. Falls back to a template if the AI reply fails the number check. */
type PCtx = ProcedureCtx<InferSchema<typeof spacetimedb>>;
type Msg = { role: string; content: string };

function groqEnv(ctx: PCtx) {
  const env = (k: 'GROQ_API_KEY' | 'GROQ_MODEL') => {
    try {
      return ctx.env.get(k) ?? null;
    } catch {
      return null; // environment unavailable (e.g. unit tests): callers fall back to templates
    }
  };
  return { key: env('GROQ_API_KEY'), model: env('GROQ_MODEL') || DEFAULT_MODEL };
}

/** One Groq chat completion. Returns the reply text, or an error description. */
function groqChat(ctx: PCtx, key: string, model: string, messages: Msg[], json = false): { text: string; error: string } {
  try {
    const res = ctx.http.fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, temperature: 0.2, max_completion_tokens: 700, reasoning_effort: 'low', messages,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (res.status !== 200) return { text: '', error: `groq http ${res.status}` };
    const out: string = (JSON.parse(res.text()).choices?.[0]?.message?.content ?? '').trim();
    return out ? { text: out, error: '' } : { text: '', error: 'empty reply' };
  } catch (e) {
    return { text: '', error: `groq error: ${String(e).slice(0, 200)}` };
  }
}

/** Ask Groq to explain `facts`; every number and label is audited, one corrective retry, else the fallback. */
function explainWithAudit(ctx: PCtx, facts: Fact[], ask: string, fallback: string) {
  const { key, model } = groqEnv(ctx);
  if (!key) return { text: fallback, source: 'template', model: 'template', rejected: 'no GROQ_API_KEY set' };
  const messages: Msg[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `${ask}\n\nFacts:\n${facts.map(f => `- ${f.text}`).join('\n')}` },
  ];
  let rejected = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = groqChat(ctx, key, model, messages);
    if (r.error) return { text: fallback, source: 'template', model: 'template', rejected: r.error };
    const audit = auditReply(r.text, facts);
    if (audit.ok) return { text: r.text, source: 'groq', model, rejected: attempt ? `fixed on retry (${rejected})` : '' };
    rejected = `attempt ${attempt + 1}: ${audit.problems.slice(0, 5).join('; ')}`;
    messages.push({ role: 'assistant', content: r.text }, { role: 'user', content: audit.feedback });
  }
  return { text: fallback, source: 'template', model: 'template', rejected };
}

export const narrate = spacetimedb.procedure(
  { customer_id: t.string(), topic: t.string() },
  t.string(),
  (ctx, { customer_id: cid, topic }) => {
    // Procedures report thrown errors as fatal (HTTP 500), so problems come back as readable text.
    if (!TOPICS.has(topic)) return `Unknown topic "${topic}". Use one of: ${[...TOPICS].join(', ')}.`;
    let facts: Fact[];
    try {
      facts = ctx.withTx(tx => gatherFacts(tx, cid));
    } catch (e) {
      return `No results for ${cid} yet. Load the data and call recompute_customer (and run_forecast) first.`;
    }
    const prompt = userPrompt(topic, facts);
    const r = explainWithAudit(ctx, facts, prompt.slice(0, prompt.indexOf('\n\nFacts:')), templateText(topic, facts));
    ctx.withTx(tx => {
      const id = `${cid}|${topic}`;
      if (tx.db.narration.narration_id.find(id)) tx.db.narration.narration_id.delete(id);
      tx.db.narration.insert({
        narration_id: id, customer_id: cid, topic, text: r.text, source: r.source,
        model: r.model, rejected_reason: r.rejected, created_at: tx.timestamp,
      });
    });
    return r.text;
  }
);

// ─────────────────────────────────────────────────────────────────────────────
// Backtest (spec §10): forecast a period we already know from data before it.
// ─────────────────────────────────────────────────────────────────────────────
const BACKTEST_MONTHS = 6;

/** Last day of the month BACKTEST_MONTHS before the as-of month (2026-10-31 → 2026-04-30). */
function defaultCutoff(asOf: string): string {
  let y = Number(asOf.slice(0, 4));
  let m = Number(asOf.slice(5, 7)) - BACKTEST_MONTHS + 1;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return isoFromDayNumber(dayNumber(`${y}-${String(m).padStart(2, '0')}-01`) - 1);
}

export const run_backtest = spacetimedb.reducer(
  { customer_id: t.string(), cutoff: t.string() },
  (ctx, { customer_id: cid, cutoff }) => {
    if (!ctx.db.customer.customer_id.find(cid)) throw new SenderError(`Unknown customer ${cid}`);
    const ledger = [...ctx.db.ledgerEntry.customer_id.filter(cid)];
    if (!ledger.length) throw new SenderError(`No ledger for ${cid}`);
    const first = ledger.reduce((m, x) => (x.posted_date < m ? x.posted_date : m), ledger[0].posted_date);
    const asOf = ledger.reduce((m, x) => (x.posted_date > m ? x.posted_date : m), '');
    const cut = cutoff || defaultCutoff(asOf);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cut) || dayNumber(cut) - dayNumber(first) < 180 || dayNumber(asOf) - dayNumber(cut) < 30)
      throw new SenderError('Cutoff must be YYYY-MM-DD with at least 180 days of history before it and 30 days after it');
    const accts = [...ctx.db.account.customer_id.filter(cid)].sort((a, b) => (a.account_id < b.account_id ? -1 : 1));
    const a = DEFAULT_ASSUMPTIONS;
    const r = backtestCustomer(ledger, accts, cut, asOf, a, seedFromString(cid));

    for (const row of [...ctx.db.backtestDay.customer_id.filter(cid)]) ctx.db.backtestDay.backtest_day_id.delete(row.backtest_day_id);
    for (const d of r.days)
      ctx.db.backtestDay.insert({
        backtest_day_id: `${cid}|${d.dayIndex}`,
        customer_id: cid,
        day_index: d.dayIndex,
        date: d.date,
        actual_cents: round(d.actual),
        actual_raw_cents: round(d.actualRaw),
        low_cents: round(d.p5),
        mid_cents: round(d.p50),
        high_cents: round(d.p95),
        inside: d.inside,
      });
    if (ctx.db.backtestSummary.customer_id.find(cid)) ctx.db.backtestSummary.customer_id.delete(cid);
    ctx.db.backtestSummary.insert({
      customer_id: cid,
      cutoff: r.cutoff,
      end: r.end,
      paths: 2 * a.pairs,
      coverage90: r.coverage90,
      coverage90_raw: r.coverage90Raw,
      end_error_pct: r.endErrorPct,
      end_half_width_pct: r.endHalfWidthPct,
      pinball: r.pinball,
    });
  }
);

/** Roll every customer's backtest into one headline row (overall_id = 0). */
export const summarize_backtests = spacetimedb.reducer(ctx => {
  const rows = [...ctx.db.backtestSummary.iter()];
  if (!rows.length) throw new SenderError('No backtests yet; call run_backtest first');
  const mean = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const median = (f: (r: (typeof rows)[number]) => number) => {
    const xs = rows.map(f).sort((x, y) => x - y);
    return xs[Math.floor(xs.length / 2)];
  };
  if (ctx.db.backtestOverall.overall_id.find(0)) ctx.db.backtestOverall.overall_id.delete(0);
  ctx.db.backtestOverall.insert({
    overall_id: 0,
    customers: rows.length,
    cutoff: rows[0].cutoff,
    end: rows[0].end,
    coverage90_mean: mean(r => r.coverage90),
    coverage90_raw_mean: mean(r => r.coverage90_raw),
    end_error_pct_median: median(r => r.end_error_pct),
    end_half_width_pct_median: median(r => r.end_half_width_pct),
    share_customers_coverage_80: mean(r => (r.coverage90 >= 0.8 ? 1 : 0)),
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Goals: chance of reaching a money target by a date, and what it would take.
// ─────────────────────────────────────────────────────────────────────────────
const MAX_GOALS = 10;

function evaluateOne(ctx: Ctx, g: { goal_id: string; customer_id: string; kind: string; target_cents: number; target_date: string }) {
  const latest = [...ctx.db.ledgerEntry.customer_id.filter(g.customer_id)].reduce((m, x) => (x.posted_date > m ? x.posted_date : m), '');
  const days = dayNumber(g.target_date) - dayNumber(latest);
  if (days < 1 || days > MAX_GOAL_DAYS) {
    if (ctx.db.goalResult.goal_id.find(g.goal_id)) ctx.db.goalResult.goal_id.delete(g.goal_id);
    return;
  }
  const { schedule, asOf } = scheduleFor(ctx, g.customer_id, days);
  const r = evaluateGoal(schedule, DEFAULT_ASSUMPTIONS, seedFromString(g.goal_id), { kind: g.kind, targetCents: g.target_cents, targetDate: g.target_date }, false);
  if (ctx.db.goalResult.goal_id.find(g.goal_id)) ctx.db.goalResult.goal_id.delete(g.goal_id);
  ctx.db.goalResult.insert({
    goal_id: g.goal_id,
    customer_id: g.customer_id,
    as_of: asOf,
    days_to_goal: r.dayIndex,
    p_success: r.pSuccess,
    p_success_se: r.pSuccessSe,
    low_cents: round(r.low),
    mid_cents: round(r.mid),
    high_cents: round(r.high),
    needed_80_cents: r.needed80,
    needed_95_cents: r.needed95,
    p_with_needed_80: r.pWith80,
    needed_share_of_extras: r.neededShareOfExtras,
  });
}

/** Add a money goal and compute its chances right away. */
export const add_goal = spacetimedb.reducer(
  { customer_id: t.string(), name: t.string(), kind: t.string(), target_cents: t.f64(), target_date: t.string() },
  (ctx, a) => {
    if (!ctx.db.customer.customer_id.find(a.customer_id)) throw new SenderError(`Unknown customer ${a.customer_id}`);
    const name = a.name.trim();
    if (!name || name.length > 60) throw new SenderError('Goal name must be 1-60 characters');
    if (!GOAL_KINDS.has(a.kind)) throw new SenderError('Goal kind must be save_extra or reach_balance');
    if (!Number.isFinite(a.target_cents) || a.target_cents <= 0) throw new SenderError('Target must be a positive amount');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.target_date)) throw new SenderError('Target date must be YYYY-MM-DD');
    const latest = [...ctx.db.ledgerEntry.customer_id.filter(a.customer_id)].reduce((m, x) => (x.posted_date > m ? x.posted_date : m), '');
    const days = dayNumber(a.target_date) - dayNumber(latest);
    if (days < 7 || days > MAX_GOAL_DAYS) throw new SenderError(`Target date must be between 7 and ${MAX_GOAL_DAYS} days after ${latest}`);
    const existing = [...ctx.db.goal.customer_id.filter(a.customer_id)];
    if (existing.length >= MAX_GOALS) throw new SenderError(`At most ${MAX_GOALS} goals per customer`);
    const n = 1 + existing.reduce((m, x) => Math.max(m, Number(x.goal_id.split('-').pop()) || 0), 0);
    const row = ctx.db.goal.insert({
      goal_id: `G-${a.customer_id}-${n}`,
      customer_id: a.customer_id,
      name,
      kind: a.kind,
      target_cents: Math.round(a.target_cents),
      target_date: a.target_date,
      created_at: ctx.timestamp,
    });
    evaluateOne(ctx, row);
  }
);

export const remove_goal = spacetimedb.reducer({ goal_id: t.string() }, (ctx, { goal_id }) => {
  if (!ctx.db.goal.goal_id.find(goal_id)) throw new SenderError(`Unknown goal ${goal_id}`);
  ctx.db.goal.goal_id.delete(goal_id);
  if (ctx.db.goalResult.goal_id.find(goal_id)) ctx.db.goalResult.goal_id.delete(goal_id);
});

/** Re-run every goal for a customer (after linking accounts, new data, etc.). */
export const evaluate_goals = spacetimedb.reducer({ customer_id: t.string() }, (ctx, { customer_id }) => {
  for (const g of [...ctx.db.goal.customer_id.filter(customer_id)]) evaluateOne(ctx, g);
});

// ─────────────────────────────────────────────────────────────────────────────
// Free-form questions: Groq translates, the engine computes, Groq explains, code audits.
// ─────────────────────────────────────────────────────────────────────────────
export const ask = spacetimedb.procedure(
  { customer_id: t.string(), question: t.string() },
  t.string(),
  (ctx, { customer_id: cid, question }) => {
    const q = question.trim().slice(0, 300);
    if (!q) return 'Please type a question.';
    let prep: { schedule: ReturnType<typeof scheduleFor>['schedule']; outflow: number; asOf: string; income: number; debtPayments: number };
    try {
      prep = ctx.withTx(tx => {
        const { schedule, snap, asOf } = scheduleFor(tx, cid);
        return { schedule, outflow: snap.monthly_outflow_cents, asOf, income: snap.monthly_income_cents, debtPayments: snap.monthly_debt_payments_cents };
      });
    } catch {
      return `No data for ${cid} yet.`;
    }
    const { key, model } = groqEnv(ctx);
    const record = (row: { interpretation: string; supported: boolean; verdict: string; answer: string; source: string; rejected: string }) =>
      ctx.withTx(tx =>
        tx.db.qa.insert({
          qa_id: 0n, customer_id: cid, question: q, interpretation: row.interpretation, supported: row.supported,
          verdict: row.verdict, answer: row.answer, source: row.source, rejected_reason: row.rejected, created_at: tx.timestamp,
        })
      );
    if (!key) {
      const msg = 'Questions need the AI connection (GROQ_API_KEY). Use the what-if controls instead.';
      record({ interpretation: '', supported: false, verdict: '', answer: msg, source: 'template', rejected: 'no GROQ_API_KEY set' });
      return msg;
    }

    // 1) translate the question into a bounded scenario
    const parsed = groqChat(ctx, key, model, [
      { role: 'system', content: `${PARSE_PROMPT} Today is ${prep.asOf}.` },
      { role: 'user', content: q },
    ], true);
    const p = parseScenario(parsed.text);
    // 1b) router: a question about where they stand (not a what-if) goes to the matching summary's facts
    if (!parsed.error && !p.supported && p.topic !== 'none') {
      let facts: Fact[];
      try {
        facts = ctx.withTx(tx => gatherFacts(tx, cid));
      } catch {
        return `No forecast for ${cid} yet. Run run_forecast first.`;
      }
      const r = explainWithAudit(ctx, facts, ANSWER_TOPIC(q), templateText(p.topic, facts));
      record({ interpretation: `A question about ${TOPIC_LABELS[p.topic]}`, supported: true, verdict: '', answer: r.text, source: r.source, rejected: r.rejected });
      return r.text;
    }
    if (parsed.error || !p.supported) {
      const msg = 'I can answer questions about your accounts, where your money is headed, debt payoff and risk, and "what if" questions about income, spending, a purchase or loan, paying down debt, or losing your job. That one is outside what I can check.';
      record({ interpretation: p.summary, supported: false, verdict: '', answer: msg, source: 'template', rejected: parsed.error });
      return msg;
    }

    // 2) run it against the baseline on the same random draws, 3) facts for the answer
    const ev = evaluateQuestion(prep.schedule, prep.outflow, p, seedFromString(cid), DEFAULT_ASSUMPTIONS, { incomeCents: prep.income, debtPaymentsCents: prep.debtPayments });
    const r = explainWithAudit(ctx, ev.facts, `${ANSWER_ASK} The question was: "${q}"`, ev.fallback);

    // 4) store: the what-if forecast, the third chart line, and the Q&A
    ctx.withTx(tx => {
      writeForecast(tx, cid, ev.whatIf, DEFAULT_ASSUMPTIONS);
      writeWhatifLine(tx, cid, ev.habit, ev.interpretation.slice(0, 80));
    });
    record({ interpretation: ev.interpretation, supported: true, verdict: ev.verdict, answer: r.text, source: r.source, rejected: r.rejected });
    return r.text;
  }
);
